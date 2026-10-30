/**
 * RF17 - filtros server-side das listagens administrativas.
 *
 * Antes deste teste, `GET /admin/appointments` e `GET /admin/exams` só
 * aceitavam `limit`/paginação. A tela filtrava no cliente, o que só funcionava
 * para as primeiras 100 linhas e nunca para o total. O contrato aqui é:
 * `status`, `unit_id`, `date_from` e `date_to` chegam ao SQL, combinam entre si
 * e o `total` do envelope reflete o filtro.
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
const app = require('../src/app');

let server;
let base;
let token;
let userId;

const UNIT_A = crypto.randomUUID();
const UNIT_B = crypto.randomUUID();
const CRIADOS = [];

async function inserirUsuario() {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, account_status)
     VALUES (?, ?, ?, ?, 'paciente', 'ativo')`,
    [id, 'Paciente Filtro', `filtro+${id.slice(0, 8)}@test.local`, 'x']
  );
  return id;
}

async function inserir(kind, { unitId, scheduledAt, status }) {
  const id = crypto.randomUUID();
  CRIADOS.push({ kind, id });
  if (kind === 'exams') {
    await pool.query(
      `INSERT INTO exams (id, user_id, exam_type, location, unit_id, scheduled_at, status)
       VALUES (?, ?, 'Hemograma', 'UBS Teste', ?, ?, ?)`,
      [id, userId, unitId, scheduledAt, status]
    );
    return id;
  }
  await pool.query(
    `INSERT INTO appointments (id, user_id, specialty, location, unit_id, scheduled_at, status)
     VALUES (?, ?, 'Clínica Geral', 'UBS Teste', ?, ?, ?)`,
    [id, userId, unitId, scheduledAt, status]
  );
  return id;
}

const get = (rota) => fetch(base + rota, {
  headers: { Authorization: `Bearer ${token}` },
}).then(async (res) => ({ status: res.status, body: await res.json() }));

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  const [[admin]] = await pool.query("SELECT id, email, full_name FROM users WHERE role = 'admin' LIMIT 1");
  assert.ok(admin, 'precisa de um admin no banco - rode npm run db:seed');
  token = jwt.sign(
    { id: admin.id, email: admin.email, role: 'admin', admin_level: 'superadmin', full_name: admin.full_name },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );

  userId = await inserirUsuario();
});

test.after(async () => {
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [userId]).catch(() => {});
  await pool.query('DELETE FROM exams WHERE user_id = ?', [userId]).catch(() => {});
  await pool.query('DELETE FROM users WHERE id = ?', [userId]).catch(() => {});
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await pool.end().catch(() => {});
});

test('consulta filtra por status, unidade e intervalo de datas', async () => {
  await inserir('appointments', { unitId: UNIT_A, scheduledAt: '2026-11-10 09:00:00', status: 'pendente' });
  await inserir('appointments', { unitId: UNIT_B, scheduledAt: '2026-11-12 10:00:00', status: 'confirmado' });
  await inserir('appointments', { unitId: UNIT_A, scheduledAt: '2026-11-15 11:00:00', status: 'cancelado' });

  const res = await get(
    `/admin/appointments?page=1&pageSize=10&status=pendente&unit_id=${UNIT_A}` +
    '&date_from=2026-11-01&date_to=2026-11-30'
  );

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.total, 1);
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].status, 'pendente');
  assert.equal(res.body.data[0].unit_id, UNIT_A);
});

test('exame filtra por status, unidade e intervalo de datas', async () => {
  await inserir('exams', { unitId: UNIT_A, scheduledAt: '2026-11-11 08:00:00', status: 'pendente' });
  await inserir('exams', { unitId: UNIT_A, scheduledAt: '2026-11-20 08:00:00', status: 'concluido' });

  const res = await get(
    `/admin/exams?page=1&pageSize=10&status=pendente&unit_id=${UNIT_A}` +
    '&date_from=2026-11-01&date_to=2026-11-30'
  );

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.total, 1);
  assert.equal(res.body.data[0].status, 'pendente');
  assert.equal(res.body.data[0].unit_id, UNIT_A);
});

test('filtros combinados não vazam registros de outra unidade', async () => {
  const res = await get(
    `/admin/appointments?page=1&pageSize=10&unit_id=${UNIT_B}` +
    '&date_from=2026-11-01&date_to=2026-11-30'
  );

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.total, 1);
  assert.equal(res.body.data[0].unit_id, UNIT_B);
});

test('intervalo de datas é inclusivo nas duas pontas', async () => {
  const res = await get(
    `/admin/appointments?page=1&pageSize=10&unit_id=${UNIT_A}` +
    '&date_from=2026-11-10&date_to=2026-11-10'
  );

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.total, 1);
  assert.equal(String(res.body.data[0].scheduled_at).slice(0, 10), '2026-11-10');
});

test('status inválido devolve 400 em vez de lista vazia silenciosa', async () => {
  const res = await get('/admin/appointments?page=1&pageSize=10&status=inventado');
  assert.equal(res.status, 400);
  assert.match(res.body.error, /status/i);
});

test('data inválida devolve 400', async () => {
  const res = await get('/admin/appointments?page=1&pageSize=10&date_from=2026-02-30');
  assert.equal(res.status, 400);
  assert.match(res.body.error, /data/i);
});
