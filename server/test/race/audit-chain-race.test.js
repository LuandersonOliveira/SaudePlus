/**
 * A trilha de auditoria não pode ser corrompida por requisições simultâneas.
 *
 * O que rola sem o mutex: `SELECT ... ORDER BY seq DESC LIMIT 1 FOR UPDATE`
 * não serializa nada no fim do índice (não há linha seguinte para travar em
 * gap). Duas requisições simultâneas leem a MESMA cabeça e as duas inserem —
 * a trilha ganha duas linhas penduradas no mesmo elo, e o verificador acusa
 * adulteração onde só houve concorrência. Foi assim que apareceu na base:
 * linhas 374 e 376 ausentes (auto_increment queimado por transação que rolou
 * back) e a 375 apontando para a 370.
 *
 * Este teste roda N gravações AO MESMO TEMPO, em conexões diferentes, e exige
 * que a cadeia continue íntegra. Ele vai para test/race/ porque precisa de
 * concorrência real — mesmo princípio do teste de booking.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

// O .env precisa vir antes do pool: este arquivo não sobe o app, então o
// dotenv que o app.js faz não acontece.
const SERVER = path.resolve(__dirname, '..', '..');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const pool = require('../../src/db');
const { logAction, verifyChain } = require('../../src/utils/audit');

const ATOR = '00000000-0000-4000-8000-00000000c0de';
const PARALELAS = Number(process.env.RACE_PARALLEL) || 24;

async function garantirAtor() {
  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, account_status)
     VALUES (?, 'Ator Concorrência', 'ator-concorrencia@caps.local', 'x', 'admin', 'ativo')
     ON DUPLICATE KEY UPDATE full_name = VALUES(full_name)`,
    [ATOR]
  );
}

test.before(async () => {
  await garantirAtor();
});

test.after(async () => {
  await pool.end().catch(() => {});
});

test(`${PARALELAS} gravações simultâneas não quebram a cadeia`, async () => {
  const [[antes]] = await pool.query('SELECT entry_hash AS h FROM audit_log ORDER BY seq DESC LIMIT 1');
  const headAntes = antes ? antes.h : 'GENESIS';

  // Todas partem de verdade ao mesmo tempo: sem isso, o event loop entrega
  // uma por uma e o teste "passa" sem nunca ter havido corrida.
  const barra = crypto.randomBytes(6).toString('hex'); // entity_id é VARCHAR(36)
  const idDe = (i) => `p${i}-${barra}`;
  const inicio = Promise.resolve();
  const escritas = Array.from({ length: PARALELAS }, (_, i) =>
    inicio.then(() => logAction(ATOR, 'create', 'concurrency_probe', idDe(i), `escrita ${i}`))
  );
  await Promise.all(escritas);

  // A prova é o ENCADEAMENTO deste lote, não a contagem global: o banco de
  // desenvolvimento tem uma bifurcação antiga (de quando o logAction ainda não
  // tinha mutex) que não pode ser reparada — `audit_log` é append-only por
  // trigger. Contar linhas alcançáveis a partir de GENESIS não serviria para
  // nada, porque o caminho alcançável nunca cresce.
  const [probes] = await pool.query(
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

  // E a cabeça final é a última do lote — nada foi gravado por fora.
  const [[depois]] = await pool.query('SELECT entry_hash AS h FROM audit_log ORDER BY seq DESC LIMIT 1');
  assert.equal(depois.h, probes[probes.length - 1].entry_hash, 'a cabeça final deve ser a última escrita');
});

test('o mutex é devolvido: outra escrita consegue entrar depois', async () => {
  // Se o GET_LOCK ficasse preso na conexão, tudo depois disso empilharia
  // atrás de um lock que ninguém tem — e o sintoma seria "a auditoria parou".
  const [[antes]] = await pool.query('SELECT entry_hash AS h FROM audit_log ORDER BY seq DESC LIMIT 1');
  const marca = `pos-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  await logAction(ATOR, 'create', 'concurrency_probe', marca, 'depois');
  const [depois] = await pool.query(
    'SELECT prev_hash, entry_hash FROM audit_log WHERE entity_id = ?', [marca]
  );
  assert.equal(depois.length, 1, 'a escrita posterior tem de ter entrado');
  assert.equal(depois[0].prev_hash, antes.h, 'ela tem de encadear na cabeça anterior');
});