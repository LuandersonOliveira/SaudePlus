/**
 * R-06 / ADR-0012: o paciente marca o próprio lembrete como lido.
 *
 * A coluna `reminders.read` existia e o front já mostrava "Novo"/"Lido" a partir dela, mas
 * nenhuma rota a gravava: todo lembrete ficava "Novo" para sempre.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

const SERVER = path.resolve(__dirname, '..');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const pool = require('../src/db');
const jwt = require(require.resolve('jsonwebtoken', { paths: [SERVER] }));
const bcrypt = require(require.resolve('bcryptjs', { paths: [SERVER] }));
const app = require('../src/app');

const USUARIOS = [];
let server;
let base;

async function paciente() {
  const id = crypto.randomUUID();
  const email = `lido-${id}@test.local`;
  await pool.query(
    'INSERT INTO users (id, full_name, email, password_hash, role, account_status) VALUES (?,?,?,?,?,?)',
    [id, 'Paciente Lembrete', email, await bcrypt.hash('senha-de-teste-123', 4), 'paciente', 'ativo']
  );
  USUARIOS.push(id);
  return { id, email, token: jwt.sign({ id, email, role: 'paciente', full_name: 'Paciente Lembrete' }, process.env.JWT_SECRET, { expiresIn: '10m' }) };
}
async function lembrete(userId) {
  const id = crypto.randomUUID();
  await pool.query(
    'INSERT INTO reminders (id, user_id, title, message, remind_at) VALUES (?,?,?,?,NOW())',
    [id, userId, 'Consulta amanhã', 'Leve o cartão']
  );
  return id;
}
const lido = async (id) => Number((await pool.query('SELECT `read` AS r FROM reminders WHERE id = ?', [id]))[0][0].r);
const marcar = (id, token) => fetch(`${base}/api/me/reminders/${id}/read`, {
  method: 'PATCH',
  headers: token ? { Authorization: `Bearer ${token}` } : {},
});

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((r) => server.close(r));
  for (const id of USUARIOS) {
    await pool.query('DELETE FROM reminders WHERE user_id = ?', [id]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
  }
  await pool.end().catch(() => {});
});

test('marca o próprio lembrete como lido e a listagem passa a mostrar read = 1', async () => {
  const u = await paciente();
  const id = await lembrete(u.id);
  assert.equal(await lido(id), 0);

  const res = await marcar(id, u.token);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(await lido(id), 1);

  const lista = await (await fetch(`${base}/api/me/reminders`, { headers: { Authorization: `Bearer ${u.token}` } })).json();
  assert.equal(Number(lista.find((l) => l.id === id).read), 1);
});

test('é idempotente: marcar de novo continua 200', async () => {
  const u = await paciente();
  const id = await lembrete(u.id);
  assert.equal((await marcar(id, u.token)).status, 200);
  assert.equal((await marcar(id, u.token)).status, 200);
  assert.equal(await lido(id), 1);
});

test('lembrete de OUTRO paciente: 404 e nada muda', async () => {
  const dono = await paciente();
  const intruso = await paciente();
  const id = await lembrete(dono.id);

  const res = await marcar(id, intruso.token);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'Lembrete não encontrado.');
  assert.equal(await lido(id), 0, 'o lembrete alheio não pode ser alterado');
});

test('id inexistente: 404', async () => {
  const u = await paciente();
  assert.equal((await marcar(crypto.randomUUID(), u.token)).status, 404);
});

test('sem login: 401', async () => {
  const u = await paciente();
  const id = await lembrete(u.id);
  assert.equal((await marcar(id, null)).status, 401);
  assert.equal(await lido(id), 0);
});

test('marcar um lembrete não mexe nos outros do mesmo paciente', async () => {
  const u = await paciente();
  const a = await lembrete(u.id);
  const b = await lembrete(u.id);
  await marcar(a, u.token);
  assert.equal(await lido(a), 1);
  assert.equal(await lido(b), 0);
});
