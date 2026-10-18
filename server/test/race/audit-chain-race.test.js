/**
 * CONCORRÊNCIA — a trilha de auditoria não pode bifurcar sob escrita simultânea.
 *
 * O `logAction` lia a cabeça da cadeia com `SELECT … ORDER BY seq DESC LIMIT 1
 * FOR UPDATE` e achava que isso serializava. Não serializa: no fim do índice
 * não existe "próxima" linha, então o InnoDB não pega o gap lock que impediria
 * um INSERT concorrente. Duas requisições simultâneas liam a MESMA cabeça e as
 * duas gravavam — a trilha ganhava duas linhas penduradas no mesmo elo, e o
 * verificador acusava adulteração onde só houve corrida.
 *
 * Este arquivo dispara 24 gravações de verdade ao mesmo tempo (não em
 * sequência, que seria trivial) e exige que elas encadeiem uma a uma.
 *
 * POR QUE ESTE ARQUIVO ESTÁ EM test/race/ E NÃO EM test/
 * Precisa de concorrência real E de um banco descartável:
 *
 * 1. Concorrência — um dublê com conexão única não reproduz nada, e o pool do
 *    mysql2 segura o event loop (o processo termina os testes e não sai).
 *
 * 2. Banco descartável — a primeira versão escrevia as 24 linhas na `audit_log`
 *    do banco de DESENVOLVIMENTO. Como `audit_log` é append-only por trigger,
 *    elas nunca mais saíam: a máquina acumulou 100 linhas de
 *    `concurrency_probe`, e ninguém percebia porque o teste "passava". O
 *    mecanismo de banco próprio + require.cache é o mesmo do booking-race.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SERVER = path.resolve(__dirname, '..', '..');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const mysql = require(require.resolve('mysql2/promise', { paths: [SERVER] }));
const { rewriteSchemaForDb } = require('../../../scripts/db-setup');

const ATOR = '00000000-0000-4000-8000-00000000c0de';
const PARALELAS = Number(process.env.RACE_PARALLEL) || 24;

// O nome NÃO pode começar com `saude_race_`: o booking-race varre
// `saude\_race\_%` para limpar órfãos, e como os dois arquivos rodam em
// PARALELO (`node --test` lança um processo por arquivo), ele derrubava este
// banco no meio do teste — "Unknown database" numa execução que tinha passado
// sozinha minutos antes.
const DB = `saude_auditrace_${process.pid}`;
const CFG = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  charset: 'utf8mb4',
};

function novaConexao(comBanco) {
  return mysql.createConnection({
    ...CFG,
    database: comBanco ? DB : undefined,
    dateStrings: true,
    multipleStatements: true,
  });
}

// Conexões em voo, para o teardown. `criadas` é o que o app retirou do db
// falso; `abertas` são as do próprio teste.
const criadas = new Set();
const abertas = new Set();
let principal = null;

function soltar(conn) {
  abertas.delete(conn);
  const p = conn.end();
  if (p && typeof p.catch === 'function') p.catch(() => {});
}

// O db que o app e o audit.js vão enxergar.
const appDb = {
  query: (...a) => principal.query(...a),
  getConnection: async () => {
    const c = await novaConexao(true);
    criadas.add(c);
    c.release = () => soltar(c);
    return c;
  },
  end: async () => {},
};

let audit;

// Rede de segurança: se algum await travar na saída, o processo ainda encerra.
// unref() não impede o disparo — só não segura o event loop sozinho.
const rede = setTimeout(() => process.exit(process.exitCode ?? 0), 20000);
rede.unref();

test.before(async () => {
  const passo = (m) => { if (process.env.RACE_DEBUG) console.log('  [before]', m); };

  passo('criando banco descartável');
  const admin = await novaConexao(false);
  abertas.add(admin);

  // Varredura do que sobrou de execuções anteriores, que podem ter morrido
  // antes do teardown rodar.
  const [sobras] = await admin.query(
    "SELECT schema_name AS n FROM information_schema.schemata WHERE schema_name LIKE 'saude\\_auditrace\\_%'"
  );
  for (const { n } of sobras) {
    await admin.query(`DROP DATABASE IF EXISTS \`${n}\``).catch(() => {});
  }

  await admin.query(`DROP DATABASE IF EXISTS \`${DB}\``);
  await admin.query(`CREATE DATABASE \`${DB}\` CHARACTER SET utf8mb4`);
  await admin.query(rewriteSchemaForDb(fs.readFileSync(path.join(SERVER, 'schema.sql'), 'utf8'), DB));
  soltar(admin);

  principal = await novaConexao(true);
  abertas.add(principal);

  // O ator da auditoria precisa existir: audit_log.actor_id é FK.
  await principal.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, account_status)
     VALUES (?, 'Ator Concorrência', 'ator-concorrencia@caps.local', 'x', 'admin', 'ativo')
     ON DUPLICATE KEY UPDATE full_name = VALUES(full_name)`,
    [ATOR]
  );

  // Injeta o db antes de qualquer módulo do app carregá-lo.
  const caminhoDb = require.resolve('../../src/db');
  require.cache[caminhoDb] = {
    id: caminhoDb, filename: caminhoDb, loaded: true, exports: appDb,
  };
  audit = require('../../src/utils/audit');
  passo('pronto');
});

test.after(async () => {
  for (const c of [...criadas]) soltar(c);
  criadas.clear();
  for (const c of [...abertas]) soltar(c);
  abertas.clear();
  principal = null;

  const admin = await novaConexao(false);
  await admin.query(`DROP DATABASE IF EXISTS \`${DB}\``).catch(() => {});
  soltar(admin);
});

test(`${PARALELAS} gravações simultâneas não quebram a cadeia`, async () => {
  const [[antes]] = await principal.query(
    'SELECT entry_hash AS h FROM audit_log ORDER BY seq DESC LIMIT 1'
  );
  const headAntes = antes ? antes.h : 'GENESIS';

  // Todas partem de verdade ao mesmo tempo: sem isso, o event loop entrega
  // uma por uma e o teste "passa" sem nunca ter havido corrida.
  const barra = crypto.randomBytes(6).toString('hex'); // entity_id é VARCHAR(36)
  const idDe = (i) => `p${i}-${barra}`;
  const inicio = Promise.resolve();
  const escritas = Array.from({ length: PARALELAS }, (_, i) =>
    inicio.then(() => audit.logAction(ATOR, 'create', 'concurrency_probe', idDe(i), `escrita ${i}`))
  );
  await Promise.all(escritas);

  // A prova é o ENCADEAMENTO deste lote: a primeira depende da cabeça que
  // existia antes, e cada seguinte da anterior. Duas linhas no mesmo elo
  // significa que duas requisições leram a mesma cabeça.
  const [probes] = await principal.query(
    'SELECT entry_hash, prev_hash FROM audit_log WHERE entity_id LIKE ? ORDER BY seq ASC',
    [`p%-${barra}`]
  );

  assert.equal(probes.length, PARALELAS, `todas as ${PARALELAS} escritas têm de estar na tabela`);
  assert.equal(
    probes[0].prev_hash,
    headAntes,
    'a primeira escrita do lote encadeia na cabeça que existia antes dele'
  );
  for (let i = 1; i < probes.length; i += 1) {
    assert.equal(
      probes[i].prev_hash,
      probes[i - 1].entry_hash,
      `escrita ${i} não encadeia na ${i - 1}: duas requisições leram a mesma cabeça`
    );
  }

  // E a cabeça final é a última do lote — nada entrou por fora.
  const [[depois]] = await principal.query(
    'SELECT entry_hash AS h FROM audit_log ORDER BY seq DESC LIMIT 1'
  );
  assert.equal(depois.h, probes[probes.length - 1].entry_hash, 'a cabeça final deve ser a última escrita');
});

test('o mutex é devolvido: outra escrita consegue entrar depois', async () => {
  // Se o GET_LOCK ficasse preso na conexão, tudo depois disso empilharia atrás
  // de um lock que ninguém tem — e o sintoma seria "a auditoria parou".
  const [[antes]] = await principal.query(
    'SELECT entry_hash AS h FROM audit_log ORDER BY seq DESC LIMIT 1'
  );
  const marca = `pos-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  await audit.logAction(ATOR, 'create', 'concurrency_probe', marca, 'depois');
  const [depois] = await principal.query(
    'SELECT prev_hash, entry_hash FROM audit_log WHERE entity_id = ?', [marca]
  );
  assert.equal(depois.length, 1, 'a escrita posterior tem de ter entrado');
  assert.equal(depois[0].prev_hash, antes.h, 'ela tem de encadear na cabeça anterior');
});