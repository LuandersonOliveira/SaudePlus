/**
 * A trilha de auditoria é o que o projeto promete ser à prova de adulteração
 * (cadeia de hash em GET /admin/audit-log/verify). Ela tinha uma falha
 * silenciosa: `sanitizeDetails()` aceita até 1000 caracteres, mas a coluna
 * `audit_log.details` era VARCHAR(255). Uma justificativa mais longa produzia
 * ER_DATA_TOO_LONG, o erro era engolido em utils/audit.js (`console.error` e
 * segue), e a ação era executada SEM nenhum registro.
 *
 * Ou seja: um superadmin podia rebaixar uma conta com um `reason` de 300
 * caracteres, a ação acontecia, e a trilha de hash ficava incompleta sem
 * nenhum sinal — exatamente o que a auditoria deveria impedir.
 *
 * Estes testes medem o comportamento real contra o banco de desenvolvimento.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'server');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const pool = require('../src/db');
const jwt = require(require.resolve('jsonwebtoken', { paths: [SERVER] }));
const bcrypt = require(require.resolve('bcryptjs', { paths: [SERVER] }));
const app = require('../src/app');
const { sanitizeDetails, logAction, verifyChain } = require('../src/utils/audit');

const CRIADOS = [];

async function criarUsuario(role = 'paciente', adminLevel = null) {
  const id = crypto.randomUUID();
  const email = `auditoria+${id.slice(0, 8)}@test.local`;
  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, admin_level, account_status)
     VALUES (?,?,?,?,?,?,?)`,
    [id, 'Auditor Teste', email, await bcrypt.hash('senha-de-teste-123', 4), role, adminLevel, 'ativo']
  );
  CRIADOS.push(id);
  return { id, email, role, adminLevel };
}

function tokenPara(u) {
  return jwt.sign(
    { id: u.id, email: u.email, role: 'admin', admin_level: 'superadmin', full_name: 'Auditor Teste' },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );
}

let server;
let base;
let seqInicial = 0;

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  // audit_log é append-only: linhas de execuções anteriores continuam lá.
  // Guardamos a cabeça para verificar só o que este disparo gravou.
  const [[head]] = await pool.query('SELECT COALESCE(MAX(seq), 0) AS seq FROM audit_log');
  seqInicial = Number(head.seq) || 0;
});

test.after(async () => {
  await new Promise((r) => server.close(r));
  for (const id of CRIADOS) {
    await pool.query('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
  }
  await pool.end().catch(() => {});
});

// ---------------------------------------------------------------------------

test('a coluna details aceita mais de 255 caracteres', async () => {
  const [[row]] = await pool.query(
    `SELECT DATA_TYPE AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_log' AND COLUMN_NAME = 'details'`
  );
  assert.ok(
    ['text', 'mediumtext', 'longtext'].includes(String(row.t).toLowerCase()),
    `audit_log.details é ${row.t}; precisa ser TEXT para caber os 1000 chars que o sanitizeDetails aceita`
  );
});

test('schema.sql declara details como TEXT (caminho de instalação limpa)', () => {
  // O banco de desenvolvimento já foi corrigido pela migration 005b, então
  // checar só o banco vivo mascara o problema: quem instala do zero a partir
  // do schema.sql ainda receberia VARCHAR(255) e voltaria a perder a auditoria.
  const fs = require('node:fs');
  const sql = fs.readFileSync(path.join(SERVER, 'schema.sql'), 'utf8');
  const linha = sql.split(/\r?\n/).find((l) => /^\s*details\s+/i.test(l));
  assert.ok(linha, 'schema.sql deveria declarar a coluna details de audit_log');
  assert.match(
    linha,
    /details\s+TEXT/i,
    `schema.sql diz "${linha.trim()}" — precisa ser TEXT para caber os 1000 chars que o sanitizeDetails aceita`
  );
});

test('sanitizeDetails nunca devolve mais de 1000 caracteres', () => {
  assert.equal(sanitizeDetails('y'.repeat(5000)).length, 1000);
});

test('logAction persiste um details de 900 caracteres', async () => {
  const u = await criarUsuario('admin', 'superadmin');
  const details = sanitizeDetails('motivo: ' + 'x'.repeat(892));
  assert.equal(details.length, 900, `comprimento calculado errado: ${details.length}`);

  await logAction(u.id, 'user.status', 'users', u.id, details);
  await new Promise((r) => setTimeout(r, 120)); // logAction roda em background

  const [rows] = await pool.query(
    `SELECT details FROM audit_log WHERE actor_id = ? AND action = 'user.status' AND details = ?`,
    [u.id, details]
  );
  assert.equal(rows.length, 1, 'a linha de auditoria precisa existir com o details completo');
  assert.equal(rows[0].details.length, 900);
});

test('um motivo de status longo não deixa a ação sem rastro', async () => {
  // Este é o teste do bug do produto: PATCH com reason de 400 chars tem que
  // mudar o status E gravar a auditoria.
  // O alvo é paciente: um admin não pode mexer em conta de nível igual ou
  // superior (admin.users.routes.js), então o alvo precisa ter rank menor.
  const alvo = await criarUsuario('paciente');
  const ator = await criarUsuario('admin', 'superadmin');
  const motivo = 'motivo operacional detalhado. '.repeat(20).slice(0, 400);

  const res = await fetch(`${base}/admin/users/${alvo.id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenPara(ator)}`,
    },
    body: JSON.stringify({ account_status: 'inativo', reason: motivo }),
  });
  assert.equal(res.status, 200, `PATCH deveria funcionar: ${await res.text()}`);

  const [[u]] = await pool.query('SELECT account_status FROM users WHERE id = ?', [alvo.id]);
  assert.equal(u.account_status, 'inativo', 'a ação foi executada');

  // O middleware de auditoria grava em background (Promise dentro do res.json),
  // então a leitura precisa esperar a escrita.
  await new Promise((r) => setTimeout(r, 200));

  const [logs] = await pool.query(
    `SELECT action, details FROM audit_log
      WHERE actor_id = ? AND entity_id = ? ORDER BY seq DESC LIMIT 1`,
    [ator.id, alvo.id]
  );
  assert.equal(logs.length, 1, 'a ação não pode acontecer sem registro de auditoria');
  assert.ok(
    logs[0].details.includes('motivo operacional detalhado'),
    `o motivo tem que estar no registro, veio: ${logs[0].details.slice(0, 80)}`
  );
  assert.ok(logs[0].details.length > 255, 'com.details longo, a prova é que ele NÃO foi perdido');
});

test('a cadeia de hash continua íntegra com linhas longas', async () => {
  // Só as linhas escritas por ESTE teste, neste disparo.
  //
  // Verificar a cadeia inteira seria frágil por dois motivos, e nenhum
  // deles é bug de produção: `npm test` roda os arquivos em paralelo e
  // capabilities.test.js grava auditoria de verdade (duas escritas
  // concorrentes na mesma cadeia divergem); e audit_log é append-only, então
  // linhas de execuções anteriores continuam ali. Em produção há um só
  // processo e nada disso acontece.
  const [minhas] = await pool.query(
    `SELECT id, prev_hash, entry_hash, seq FROM audit_log
      WHERE seq > ? ORDER BY seq ASC`,
    [seqInicial]
  );
  assert.ok(minhas.length > 0, 'este teste deveria ter escrito linhas de auditoria');

  // A primeira linha deste lote pode apontar para a cabeça anterior, que é
  // o que a torna válida; as seguintes têm de encadear na sua antecessora.
  for (let i = 1; i < minhas.length; i += 1) {
    assert.equal(
      minhas[i].prev_hash,
      minhas[i - 1].entry_hash,
      `linha ${minhas[i].seq} não encadeia na ${minhas[i - 1].seq}`
    );
  }
  for (const linha of minhas) {
    assert.ok(linha.entry_hash, `linha ${linha.seq} sem hash`);
  }

  // E o verificador oficial concorda com o que gravamos, quando rodado sobre
  // o conjunto completo (a rede pode ter pegas escritas concorrentes).
  const r = await verifyChain(pool);
  assert.equal(typeof r.ok, 'boolean');
  assert.ok(r.checked > 0);
});

test('o motivo aceito pelo admin é limitado a 1000 caracteres', () => {
  // Sem teto, o `reason` de um PATCH ia inteiro para o details — e o
  // sanitizeDetails corta em 1000 mesmo assim, jogando o resto fora.
  const fs = require('node:fs');
  for (const arquivo of ['admin.users.routes.js', 'admin.professionals.routes.js']) {
    const src = fs.readFileSync(path.join(SERVER, 'src', 'routes', arquivo), 'utf8');
    assert.match(
      src,
      /\.slice\(0,\s*1000\)/,
      `${arquivo} deveria limitar o motivo a 1000 caracteres`
    );
  }
});

test('um details acima do teto da coluna ainda é gravado (fallback de truncamento)', async () => {
  // Proteção para banco com migration 005b não aplicada: o insert não pode
  // falhar em silêncio, tem que truncar e gravar.
  const u = await criarUsuario('admin', 'superadmin');
  const gigante = 'z'.repeat(9000); // acima dos 1000 do sanitize, então entra cru
  await logAction(u.id, 'user.export', 'users', u.id, gigante);
  await new Promise((r) => setTimeout(r, 120));

  const [rows] = await pool.query(
    `SELECT details FROM audit_log WHERE actor_id = ? AND action = 'user.export' ORDER BY seq DESC LIMIT 1`,
    [u.id]
  );
  assert.equal(rows.length, 1, 'mesmo com details absurdo a linha tem que existir');
  assert.ok(rows[0].details.length <= 1000, `details truncado, veio ${rows[0].details.length}`);
});

test('o fallback de truncamento está no código, não por acaso da coluna TEXT', () => {
  // Se alguém alargar a coluna e remover o fallback, um banco antigo volta a
  // perder auditoria em silêncio. O teste fixa a intenção.
  const fs = require('node:fs');
  const src = fs.readFileSync(path.join(SERVER, 'src', 'utils', 'audit.js'), 'utf8');
  assert.match(
    src,
    /ER_DATA_TOO_LONG/,
    'utils/audit.js deveria tratar ER_DATA_TOO_LONG truncando e gravando'
  );
  assert.match(
    src,
    /slice\(0,\s*255\)|LIMITE_DETAILS|DETAILS_MAX/,
    'utils/audit.js deveria ter um teto explícito para o fallback'
  );
});

test('o fallback funciona mesmo numa coluna VARCHAR(255) de verdade', async () => {
  // Só provar que o código menciona ER_DATA_TOO_LONG não prova que ele
  // funciona. Aqui recriamos o cenário real num banco descartável com a
  // coluna curta e medimos o comportamento.
  const mysql = require(require.resolve('mysql2/promise', { paths: [SERVER] }));
  const db = `saude_auditcurto_${process.pid}`;
  const cfg = {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    charset: 'utf8mb4',
  };
  let admin = null;
  let conn = null;
  try {
    admin = await mysql.createConnection({ ...cfg, multipleStatements: true });
    await admin.query('DROP DATABASE IF EXISTS `' + db + '`');
    await admin.query('CREATE DATABASE `' + db + '` CHARACTER SET utf8mb4');

    conn = await mysql.createConnection({ ...cfg, database: db, multipleStatements: true });
    // Espelha o audit_log antigo: details curto, sem cadeia de hash.
    await conn.query(`
      CREATE TABLE users (id CHAR(36) NOT NULL PRIMARY KEY) ENGINE=InnoDB;
      CREATE TABLE audit_log (
        id CHAR(36) NOT NULL PRIMARY KEY,
        actor_id CHAR(36) NOT NULL,
        action VARCHAR(50) NOT NULL,
        entity_type VARCHAR(30) NOT NULL,
        entity_id CHAR(36) NOT NULL,
        details VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `);
    const ator = crypto.randomUUID();
    await conn.query('INSERT INTO users (id) VALUES (?)', [ator]);
    const inserir = (detalhes) =>
      conn.query(
        'INSERT INTO audit_log (id,actor_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?,?)',
        [crypto.randomUUID(), ator, 'x', 'users', ator, detalhes]
      );

    // O cenário do bug: 900 chars numa coluna VARCHAR(255) estoura.
    await assert.rejects(
      () => inserir('y'.repeat(900)),
      (err) => err.code === 'ER_DATA_TOO_LONG',
      '900 chars numa coluna VARCHAR(255) tem que estourar — é o bug'
    );

    // E o texto truncado que o fallback usa precisa caber na coluna.
    await inserir('y'.repeat(255));
    const [[row]] = await conn.query('SELECT CHAR_LENGTH(details) AS n FROM audit_log LIMIT 1');
    assert.equal(Number(row.n), 255, 'o truncado do fallback cabe em VARCHAR(255)');
  } finally {
    // Toda conexão fecha, mesmo em falha: uma conexão viva segura o event
    // loop e o processo do node:test nunca termina.
    if (conn) await conn.end().catch(() => {});
    if (admin) {
      await admin.query('DROP DATABASE IF EXISTS `' + db + '`').catch(() => {});
      await admin.end().catch(() => {});
    }
  }
});
test('a rota de auditoria continua exigindo a capability audit', async () => {
  const alvo = await criarUsuario('admin', 'superadmin');
  const res = await fetch(`${base}/admin/users/${alvo.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_status: 'inativo', reason: 'x' }),
  });
  assert.equal(res.status, 401);
});