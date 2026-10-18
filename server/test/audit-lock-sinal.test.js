/**
 * Quando o `GET_LOCK` da cadeia de auditoria não é concedido em 5s, o
 * código segue escrevendo (decisão deliberada: perder registro é pior que
 * gravar fora de ordem). O único sinal era um `console.warn` — invisível
 * para qualquer alerta, e o único jeito de saber que a trilha está sob
 * risco de bifurcar era ler o log do processo.
 *
 * Aqui o sinal vira métrica: contador e instante da última falha, expostos
 * em `GET /ready` (público, sem PII, com rate limit).
 *
 * Este teste provoca a falha de propósito, e por isso roda ISOLADO em duas
 * direções. Duas tentativas anteriores quebraram a suíte, e as duas explicam
 * o porquê:
 *
 *  1. Banco descartável. Sem ele, a escrita fora de ordem vai para a
 *     `audit_log` de desenvolvimento e `audit-details.test.js` falha com
 *     "linha 649 não encadeia na 648" — o próprio teste estaria corrompendo
 *     a trilha que outro teste existe para verificar.
 *  2. Nome de lock próprio (`AUDIT_LOCK_NAME`). O lock é nomeado no SERVIDOR,
 *     não no processo: segurar o nome padrão faria o `logAction` dos outros
 *     arquivos, que rodam em paralelo, esperar 5s e falhar — o mesmo dano, por
 *     outro caminho.
 *
 * Os 5s do teste são o tempo de espera do GET_LOCK, que é justamente o que se
 * está medindo. O que importa é que a escrita OCORREU e o contador subiu.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'server');
const { rewriteSchemaForDb } = require('../../scripts/db-setup');

const DB = `saude_audit_lock_${process.pid}`;

require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const CFG = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  charset: 'utf8mb4',
};

process.env.DB_NAME = DB;
// Lock exclusivo deste teste: o padrão é compartilhado com os outros arquivos.
process.env.AUDIT_LOCK_NAME = `saudeplus:audit-chain:test:${process.pid}`;

const mysql = require(require.resolve('mysql2/promise', { paths: [SERVER] }));
const pool = require('../src/db');
const app = require('../src/app');
const bcrypt = require(require.resolve('bcryptjs', { paths: [SERVER] }));
const audit = require('../src/utils/audit');

const USUARIO = '00000000-0000-4000-8000-0000000d1001';

let server;
let baseUrl;

test.before(async () => {
  const admin = await mysql.createConnection({ ...CFG, multipleStatements: true });
  await admin.query(`DROP DATABASE IF EXISTS \`${DB}\``);
  await admin.query(`CREATE DATABASE \`${DB}\` CHARACTER SET utf8mb4`);
  await admin.query(
    rewriteSchemaForDb(fs.readFileSync(path.join(SERVER, 'schema.sql'), 'utf8'), DB)
  );
  await admin.end();

  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  audit.resetAuditLockStats();

  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, account_status)
     VALUES (?, 'Ator do Lock', 'lock@test.local', ?, 'admin', 'ativo')`,
    [USUARIO, await bcrypt.hash('x', 4)]
  );
});

test.after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await pool.end().catch(() => {});
  const admin = await mysql.createConnection(CFG);
  await admin.query(`DROP DATABASE IF EXISTS \`${DB}\``).catch(() => {});
  await admin.end().catch(() => {});
});

test('o contador começa zerado', () => {
  const s = audit.auditoriaLockStats();
  assert.equal(s.falhas, 0);
  assert.equal(s.ultimaFalhaEm, null);
  assert.equal(s.ok, true, 'sem falha, o sinal fica "ok"');
});

test('GET /ready expõe o sinal do lock', async () => {
  const res = await fetch(`${baseUrl}/ready`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.audit_lock, '/ready precisa expor audit_lock');
  assert.equal(typeof body.audit_lock.falhas, 'number');
  assert.equal(body.audit_lock.ok, true);
});

test('sem lock concedido: a escrita acontece E o contador sobe', async () => {
  // Outra conexão segura o lock e não devolve: o GET_LOCK do logAction expira.
  const blk = await mysql.createConnection(CFG);
  await blk.query('SELECT GET_LOCK(?, 0)', [audit.AUDIT_LOCK]);

  try {
    const antes = audit.auditoriaLockStats().falhas;

    await audit.logAction(USUARIO, 'teste.lock', 'user', USUARIO, 'sinal de lock');

    const depois = audit.auditoriaLockStats();
    assert.equal(depois.falhas, antes + 1, 'a falha do GET_LOCK precisa ser contada');
    assert.ok(depois.ultimaFalhaEm, 'o instante da última falha precisa ser registrado');
    assert.equal(depois.ok, false, 'com falha, o sinal vira "não ok" — é isto que o alerta observa');
  } finally {
    await blk.query('SELECT RELEASE_LOCK(?)', [audit.AUDIT_LOCK]).catch(() => {});
    await blk.end().catch(() => {});
  }
});

test('a linha foi gravada mesmo sem o lock (perder registro é pior)', async () => {
  // A decisão deliberada: sem lock, grava fora de ordem em vez de não gravar.
  const [[r]] = await pool.query(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'teste.lock'`);
  assert.ok(r.n >= 1, 'a ação precisa ter deixado registro mesmo sem o mutex');
});

test('o contador reseta (para teste e para uso operacional)', () => {
  audit.resetAuditLockStats();
  const s = audit.auditoriaLockStats();
  assert.equal(s.falhas, 0);
  assert.equal(s.ultimaFalhaEm, null);
  assert.equal(s.ok, true);
});

test('depois do reset, /ready volta a ficar ok', async () => {
  const body = await (await fetch(`${baseUrl}/ready`)).json();
  assert.equal(body.audit_lock.ok, true);
  assert.equal(body.audit_lock.falhas, 0);
});