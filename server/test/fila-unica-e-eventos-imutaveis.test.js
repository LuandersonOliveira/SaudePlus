/**
 * E-18 e E-20 (Fase 8, item 2.5): migration 0007.
 *
 *  - Fila de espera: o banco recusa DUAS entradas ATIVAS (`aguardando`) do mesmo paciente para o mesmo
 *    serviço, unidade e profissional. Antes a duplicidade era um `SELECT` antes do `INSERT`, e duas
 *    requisições simultâneas criavam duas entradas.
 *      active_key = IF(status = 'aguardando', SHA2(kind|service|unit|professional), NULL)
 *      UNIQUE (user_id, active_key)
 *    (unit e professional nulos valem como "qualquer um" e entram na chave como texto vazio: NULL no UNIQUE
 *    nunca conflita, e é justamente o caso mais comum.)
 *  - `booking_events` é append-only no banco, como o `audit_log`: triggers recusam UPDATE e DELETE.
 *    A FK `actor_user_id ON DELETE SET NULL` continua funcionando (ação referencial não dispara trigger).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'server');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });
const mysql = require(require.resolve('mysql2/promise', { paths: [SERVER] }));
const jwt = require(require.resolve('jsonwebtoken', { paths: [SERVER] }));
const { rewriteSchemaForDb } = require('../../scripts/db-setup');
const { ehFilaDuplicada } = require('../src/utils/dbErrors');

const DB = `saude_fila_${process.pid}`;
const DB_ANTIGO = `saude_fila_old_${process.pid}`;
const cfg = () => ({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  charset: 'utf8mb4',
});

async function criarBanco(nome) {
  const admin = await mysql.createConnection({ ...cfg(), multipleStatements: true });
  await admin.query('DROP DATABASE IF EXISTS `' + nome + '`');
  await admin.query('CREATE DATABASE `' + nome + '` CHARACTER SET utf8mb4');
  await admin.end();
  const conn = await mysql.createConnection({ ...cfg(), database: nome, multipleStatements: true });
  await conn.query(rewriteSchemaForDb(fs.readFileSync(path.join(SERVER, 'schema.sql'), 'utf8'), nome));
  return conn;
}
async function apagarBanco(nome) {
  const a = await mysql.createConnection(cfg());
  await a.query('DROP DATABASE IF EXISTS `' + nome + '`').catch(() => {});
  await a.end().catch(() => {});
}

let conn;
let user;
let unit;
let prof;

const novoUsuario = async (c, nome = 'Paciente Fila') => {
  const id = crypto.randomUUID();
  await c.query("INSERT INTO users (id, full_name, email, password_hash, role) VALUES (?,?,?,?, 'paciente')", [id, nome, `fila-${id}@test.local`, 'x'.repeat(60)]);
  return id;
};
async function entrar(c, { userId = user, servico = 'Clínico', unitId = null, profId = null, status = 'aguardando', kind = 'consulta' } = {}) {
  const id = crypto.randomUUID();
  await c.query('INSERT INTO waitlist (id, user_id, kind, service_name, unit_id, professional_id, status) VALUES (?,?,?,?,?,?,?)',
    [id, userId, kind, servico, unitId, profId, status]);
  return id;
}

test.before(async () => {
  conn = await criarBanco(DB);
  user = await novoUsuario(conn);
  unit = crypto.randomUUID();
  prof = crypto.randomUUID();
  await conn.query("INSERT INTO health_units (id, name) VALUES (?, 'UBS Fila')", [unit]);
  await conn.query("INSERT INTO professionals (id, name) VALUES (?, 'Dr. Fila')", [prof]);
});
test.after(async () => {
  await conn.end().catch(() => {});
  await apagarBanco(DB);
  await apagarBanco(DB_ANTIGO);
});

// ---------------------------------------------------------------------------
// fila de espera
// ---------------------------------------------------------------------------

test('schema: duas entradas ativas iguais são recusadas, inclusive com unidade e profissional nulos', async () => {
  await entrar(conn, { servico: 'Cardiologia' });
  await assert.rejects(() => entrar(conn, { servico: 'Cardiologia' }), (e) => {
    assert.equal(e.code, 'ER_DUP_ENTRY');
    assert.ok(ehFilaDuplicada(e), e.message);
    return true;
  });

  await entrar(conn, { servico: 'Pediatria', unitId: unit, profId: prof });
  await assert.rejects(() => entrar(conn, { servico: 'Pediatria', unitId: unit, profId: prof }), (e) => ehFilaDuplicada(e));
});

test('schema: serviço, unidade, profissional, tipo ou paciente diferentes NÃO são duplicata', async () => {
  const outro = await novoUsuario(conn);
  await entrar(conn, { servico: 'Dermatologia' });
  await entrar(conn, { servico: 'Dermatologia', unitId: unit });          // outra unidade
  await entrar(conn, { servico: 'Dermatologia', profId: prof });          // outro profissional
  await entrar(conn, { servico: 'Dermatologia', unitId: unit, profId: prof });
  await entrar(conn, { servico: 'Dermatologia', kind: 'exame' });         // outro tipo
  await entrar(conn, { servico: 'Dermatologia', userId: outro });         // outro paciente
  const [[n]] = await conn.query("SELECT COUNT(*) AS n FROM waitlist WHERE service_name = 'Dermatologia'");
  assert.equal(Number(n.n), 6);
});

test('schema: só entrada ATIVA conta: cancelada ou convertida libera a vaga na fila e várias delas coexistem', async () => {
  const id = await entrar(conn, { servico: 'Ortopedia' });
  await conn.query("UPDATE waitlist SET status = 'cancelado' WHERE id = ?", [id]);
  await entrar(conn, { servico: 'Ortopedia' });                         // pode voltar à fila
  await entrar(conn, { servico: 'Ortopedia', status: 'cancelado' });    // duas canceladas iguais
  await entrar(conn, { servico: 'Ortopedia', status: 'convertido' });
  await entrar(conn, { servico: 'Ortopedia', status: 'convertido' });
  await assert.rejects(() => entrar(conn, { servico: 'Ortopedia' }), (e) => ehFilaDuplicada(e), 'a ativa continua única');
});

test('schema: voltar de cancelado para aguardando com outra ativa igual é recusado', async () => {
  const a = await entrar(conn, { servico: 'Neurologia', status: 'cancelado' });
  await entrar(conn, { servico: 'Neurologia' });
  await assert.rejects(() => conn.query("UPDATE waitlist SET status = 'aguardando' WHERE id = ?", [a]), (e) => ehFilaDuplicada(e));
});

test('API: cinco POST /me/waitlist simultâneos iguais resultam em UMA entrada (um 201, o resto 409)', async () => {
  const pool = require('../src/db');
  const app = require('../src/app');
  const id = await novoUsuario(pool, 'Paciente Corrida');
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const token = jwt.sign({ id, email: `fila-${id}@test.local`, role: 'paciente', full_name: 'Paciente Corrida' }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const url = `http://127.0.0.1:${server.address().port}/api/me/waitlist`;
    const chamar = () => fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'consulta', service_name: 'Endocrinologia' }),
    }).then(async (r) => ({ status: r.status, body: await r.json() }));
    const respostas = await Promise.all(Array.from({ length: 5 }, chamar));
    const status = respostas.map((r) => r.status).sort();
    assert.deepEqual(status, [201, 409, 409, 409, 409], JSON.stringify(respostas));
    for (const r of respostas.filter((x) => x.status === 409)) {
      assert.equal(r.body.error, 'Você já está na lista de espera para este serviço.');
    }
    const [[n]] = await pool.query("SELECT COUNT(*) AS n FROM waitlist WHERE user_id = ? AND status = 'aguardando'", [id]);
    assert.equal(Number(n.n), 1);
  } finally {
    await new Promise((r) => server.close(r));
    await pool.query('DELETE FROM waitlist WHERE user_id = ?', [id]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
    await pool.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// booking_events append-only
// ---------------------------------------------------------------------------

async function evento(c, { actor = null } = {}) {
  const id = crypto.randomUUID();
  await c.query(
    "INSERT INTO booking_events (id, kind, booking_id, event_type, actor_user_id) VALUES (?, 'consulta', ?, 'created', ?)",
    [id, crypto.randomUUID(), actor]
  );
  return id;
}

test('booking_events: INSERT funciona; UPDATE e DELETE são recusados pelo banco', async () => {
  const id = await evento(conn);
  await assert.rejects(() => conn.query("UPDATE booking_events SET reason = 'adulterado' WHERE id = ?", [id]), /append-only/);
  await assert.rejects(() => conn.query('DELETE FROM booking_events WHERE id = ?', [id]), /append-only/);
  const [[linha]] = await conn.query('SELECT reason FROM booking_events WHERE id = ?', [id]);
  assert.equal(linha.reason, null, 'a linha continua intacta');
});

test('booking_events: apagar o usuário autor ainda zera actor_user_id (ação da FK não dispara o trigger)', async () => {
  const autor = await novoUsuario(conn, 'Autor Temporário');
  const id = await evento(conn, { actor: autor });
  await conn.query('DELETE FROM users WHERE id = ?', [autor]);
  const [[linha]] = await conn.query('SELECT actor_user_id FROM booking_events WHERE id = ?', [id]);
  assert.equal(linha.actor_user_id, null);
});

test('schema.sql traz os dois triggers de booking_events e o índice da fila (não dependem de migration)', async () => {
  const [triggers] = await conn.query(
    "SELECT trigger_name AS n FROM information_schema.triggers WHERE trigger_schema = ? AND event_object_table = 'booking_events'", [DB]
  );
  assert.deepEqual(triggers.map((r) => r.n).sort(), ['trg_booking_events_no_delete', 'trg_booking_events_no_update']);
  const [idx] = await conn.query(
    "SELECT 1 FROM information_schema.statistics WHERE table_schema = ? AND table_name = 'waitlist' AND index_name = 'uq_waitlist_active'", [DB]
  );
  assert.ok(idx.length > 0);
});

// ---------------------------------------------------------------------------
// migration 0007
// ---------------------------------------------------------------------------

test('migração 0007: banco antigo com duplicata PARA sem alterar; resolvida, aplica; idempotente', async (t) => {
  const old = await criarBanco(DB_ANTIGO);
  t.after(async () => { await old.end().catch(() => {}); });
  // volta o banco ao estado anterior à 0007
  await old.query('DROP TRIGGER IF EXISTS trg_booking_events_no_update');
  await old.query('DROP TRIGGER IF EXISTS trg_booking_events_no_delete');
  await old.query('ALTER TABLE waitlist DROP INDEX uq_waitlist_active, DROP COLUMN active_key');

  const u = await novoUsuario(old, 'Antigo');
  const a1 = await entrar(old, { userId: u, servico: 'Reumatologia' });
  const a2 = await entrar(old, { userId: u, servico: 'Reumatologia' }); // duplicata ativa
  await entrar(old, { userId: u, servico: 'Reumatologia', status: 'cancelado' }); // inativa não conta

  const rodar = () => spawnSync(process.execPath, [path.join(SERVER, 'migrations', '0007_fila_unica_e_eventos_imutaveis.js')], {
    cwd: SERVER, env: { ...process.env, DB_NAME: DB_ANTIGO }, encoding: 'utf8',
  });
  const temColuna = async () => (await old.query("SELECT 1 FROM information_schema.columns WHERE table_schema = ? AND table_name = 'waitlist' AND column_name = 'active_key'", [DB_ANTIGO]))[0].length;
  const triggers = async () => (await old.query("SELECT trigger_name AS n FROM information_schema.triggers WHERE trigger_schema = ? AND event_object_table = 'booking_events'", [DB_ANTIGO]))[0].map((r) => r.n).sort();

  const r1 = rodar();
  assert.equal(r1.status, 2, r1.stdout + r1.stderr);
  assert.match(r1.stderr, /2 entradas/);
  assert.ok(r1.stderr.includes(a1) && r1.stderr.includes(a2), 'lista os ids da duplicata');
  assert.equal(await temColuna(), 0, 'com duplicata nada é alterado');
  assert.deepEqual(await triggers(), [], 'os triggers também só entram depois');

  await old.query("UPDATE waitlist SET status = 'cancelado' WHERE id = ?", [a2]); // decisão humana
  const r2 = rodar();
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(await temColuna(), 1);
  assert.deepEqual(await triggers(), ['trg_booking_events_no_delete', 'trg_booking_events_no_update']);
  await assert.rejects(() => entrar(old, { userId: u, servico: 'Reumatologia' }), (e) => ehFilaDuplicada(e), 'o UNIQUE vale depois da migração');

  const r3 = rodar();
  assert.equal(r3.status, 0, r3.stderr);
  assert.match(r3.stdout, /já existem/);
  assert.doesNotMatch(r3.stdout, /\+ /);
});
