/**
 * NV03 — lista de espera com liberação automática de vaga.
 *
 * Agenda de teste: terça 08:00–11:00, slot de 30 min. 09:00 e 10:00 são vagas
 * comuns; 08:00 é a vaga reservada pela cota do NV02. A conversão usa a
 * prioridade legal primeiro e, entre iguais, a ordem de chegada.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const app = require('../src/app');
const pool = require('../src/db');

const P = {
  unidade: '00000000-0000-4000-8000-0000000e0001',
  profissional: '00000000-0000-4000-8000-0000000e0002',
  dono: '00000000-0000-4000-8000-0000000e0003',
  comum: '00000000-0000-4000-8000-0000000e0004',
  prioritario: '00000000-0000-4000-8000-0000000e0005',
  admin: '00000000-0000-4000-8000-0000000e0006',
  schedule: '00000000-0000-4000-8000-0000000e0010',
  oferta: '00000000-0000-4000-8000-0000000e0020',
};

const SERVICO = 'Clínica Geral';
const LOCAL = 'UBS Lista de Espera';

const DIA = (() => {
  const d = new Date(Date.now() + 61 * 86400000);
  while (d.getDay() !== 2) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

let server;
let base;
const tokens = {};

const auth = (quem) => ({ Authorization: `Bearer ${tokens[quem]}`, 'Content-Type': 'application/json' });

async function limpar() {
  await pool.query('DELETE FROM appointments WHERE user_id IN (?, ?, ?)', [P.dono, P.comum, P.prioritario]);
  await pool.query('DELETE FROM waitlist WHERE user_id IN (?, ?, ?)', [P.dono, P.comum, P.prioritario]);
}

async function inserirAgendamento(userId, hora) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO appointments
       (id, user_id, unit_id, professional_id, specialty, location, scheduled_at, status, duration_minutes)
     VALUES (?,?,?,?,?,?,?, 'pendente', 30)`,
    [id, userId, P.unidade, P.profissional, SERVICO, LOCAL, `${DIA} ${hora}:00`]
  );
  return id;
}

async function entrarNaLista(quem, body = {}) {
  const res = await fetch(`${base}/me/waitlist`, {
    method: 'POST',
    headers: auth(quem),
    body: JSON.stringify({ kind: 'consulta', service_name: SERVICO, ...body }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function cancelar(quem, id) {
  const res = await fetch(`${base}/me/appointments/${id}/cancel`, {
    method: 'PATCH',
    headers: auth(quem),
    body: '{}',
  });
  return res.status;
}

async function registroDe(userId, hora) {
  const [[row]] = await pool.query(
    `SELECT id, status, scheduled_at FROM appointments
     WHERE user_id = ? AND scheduled_at = ?`,
    [userId, `${DIA} ${hora}:00`]
  );
  return row || null;
}

async function esperaDe(userId) {
  const [[row]] = await pool.query(
    'SELECT id, status, record_id FROM waitlist WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
    [userId]
  );
  return row || null;
}

async function registrar(usuario, prioridade) {
  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, account_status, priority)
     VALUES (?, ?, ?, 'x', 'paciente', 'ativo', ?)
     ON DUPLICATE KEY UPDATE priority = VALUES(priority), account_status = 'ativo', deleted_at = NULL`,
    [usuario.id, usuario.nome, usuario.email, prioridade]
  );
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  await limpar();
  await pool.query('INSERT IGNORE INTO health_units (id, name, type, neighborhood) VALUES (?,?,?,?)',
    [P.unidade, LOCAL, 'ubs', 'Centro']);
  await pool.query('INSERT IGNORE INTO professionals (id, name, job_title) VALUES (?,?,?)',
    [P.profissional, 'Dr. Lista', SERVICO]);
  await pool.query('INSERT IGNORE INTO unit_offers (id, unit_id, kind, name, active) VALUES (?,?,?,?,1)',
    [P.oferta, P.unidade, 'consulta', SERVICO]);
  await pool.query('INSERT IGNORE INTO professional_offers (id, professional_id, unit_id, kind, name) VALUES (?,?,?,?,?)',
    [crypto.randomUUID(), P.profissional, P.unidade, 'consulta', SERVICO]);

  await registrar({ id: P.dono, nome: 'Dono da Vaga', email: 'dono.espera@caps.local' }, 'nenhuma');
  await registrar({ id: P.comum, nome: 'Paciente Comum', email: 'comum.espera@caps.local' }, 'nenhuma');
  await registrar({ id: P.prioritario, nome: 'Paciente Prioritário', email: 'prioritario.espera@caps.local' }, 'idoso');
  await registrar({ id: P.admin, nome: 'Admin Espera', email: 'admin.espera@caps.local' }, null);
  await pool.query("UPDATE users SET role = 'admin', admin_level = 'superadmin' WHERE id = ?", [P.admin]);

  await pool.query('DELETE FROM work_schedules WHERE id = ?', [P.schedule]);
  await pool.query(
    `INSERT INTO work_schedules (id, professional_id, unit_id, weekday, start_time, end_time, slot_minutes)
     VALUES (?, ?, ?, 2, '08:00', '11:00', 30)`,
    [P.schedule, P.profissional, P.unidade]
  );

  const payload = (id, email, nome, role) => ({ id, email, role, full_name: nome });
  tokens.dono = jwt.sign(payload(P.dono, 'dono.espera@caps.local', 'Dono da Vaga', 'paciente'), process.env.JWT_SECRET);
  tokens.comum = jwt.sign(payload(P.comum, 'comum.espera@caps.local', 'Paciente Comum', 'paciente'), process.env.JWT_SECRET);
  tokens.prioritario = jwt.sign(payload(P.prioritario, 'prioritario.espera@caps.local', 'Paciente Prioritário', 'paciente'), process.env.JWT_SECRET);
  tokens.admin = jwt.sign(
    { ...payload(P.admin, 'admin.espera@caps.local', 'Admin Espera', 'admin'), admin_level: 'superadmin' },
    process.env.JWT_SECRET
  );
});

test.after(async () => {
  await limpar();
  await pool.query('DELETE FROM work_schedules WHERE id = ?', [P.schedule]);
  await new Promise((r) => server.close(r));
  await pool.end().catch(() => {});
});

test.beforeEach(limpar);

test('paciente entra, lista e sai da lista de espera', async () => {
  const criada = await entrarNaLista('comum');
  assert.equal(criada.status, 201, JSON.stringify(criada.body));
  assert.equal(criada.body.status, 'aguardando');

  const lista = await (await fetch(`${base}/me/waitlist`, { headers: auth('comum') })).json();
  assert.equal(lista.length, 1);
  assert.equal(lista[0].service_name, SERVICO);

  const duplicada = await entrarNaLista('comum');
  assert.equal(duplicada.status, 409);

  const saiu = await fetch(`${base}/me/waitlist/${criada.body.id}`, {
    method: 'DELETE', headers: auth('comum'),
  });
  assert.equal(saiu.status, 200);

  const depois = await esperaDe(P.comum);
  assert.equal(depois.status, 'cancelado');
});

test('cancelamento do paciente converte a primeira pessoa da fila', async () => {
  const agendamento = await inserirAgendamento(P.dono, '09:00');
  assert.equal((await entrarNaLista('comum')).status, 201);

  assert.equal(await cancelar('dono', agendamento), 200);

  const novo = await registroDe(P.comum, '09:00');
  assert.ok(novo, 'o paciente da lista deveria receber a vaga');
  assert.equal(novo.status, 'pendente');

  const espera = await esperaDe(P.comum);
  assert.equal(espera.status, 'convertido');
  assert.equal(espera.record_id, novo.id);
});

test('prioridade legal passa na frente de quem chegou antes', async () => {
  const agendamento = await inserirAgendamento(P.dono, '09:00');
  assert.equal((await entrarNaLista('comum')).status, 201);
  assert.equal((await entrarNaLista('prioritario')).status, 201);

  assert.equal(await cancelar('dono', agendamento), 200);

  const doPrioritario = await registroDe(P.prioritario, '09:00');
  assert.ok(doPrioritario, 'a vaga deveria ir para o paciente prioritário');
  assert.equal(await registroDe(P.comum, '09:00'), null);

  assert.equal((await esperaDe(P.prioritario)).status, 'convertido');
  assert.equal((await esperaDe(P.comum)).status, 'aguardando');
});

test('cancelamento pelo admin também libera a vaga', async () => {
  const agendamento = await inserirAgendamento(P.dono, '10:00');
  assert.equal((await entrarNaLista('comum')).status, 201);

  const res = await fetch(`${base}/admin/appointments/${agendamento}`, {
    method: 'PATCH',
    headers: auth('admin'),
    body: JSON.stringify({ status: 'cancelado' }),
  });
  assert.equal(res.status, 200, JSON.stringify(await res.json().catch(() => null)));

  const novo = await registroDe(P.comum, '10:00');
  assert.ok(novo, 'a vaga cancelada pelo admin deveria ser preenchida');
  assert.equal((await esperaDe(P.comum)).status, 'convertido');
});

test('lista de espera de serviço diferente não ocupa a vaga', async () => {
  const agendamento = await inserirAgendamento(P.dono, '09:00');
  const outra = await fetch(`${base}/me/waitlist`, {
    method: 'POST',
    headers: auth('comum'),
    body: JSON.stringify({ kind: 'consulta', service_name: 'Cardiologia' }),
  });
  assert.equal(outra.status, 201);

  assert.equal(await cancelar('dono', agendamento), 200);

  assert.equal(await registroDe(P.comum, '09:00'), null);
  assert.equal((await esperaDe(P.comum)).status, 'aguardando');
});

test('sem candidato, o cancelamento continua funcionando', async () => {
  const agendamento = await inserirAgendamento(P.dono, '09:00');
  assert.equal(await cancelar('dono', agendamento), 200);

  const [[row]] = await pool.query('SELECT status FROM appointments WHERE id = ?', [agendamento]);
  assert.equal(row.status, 'cancelado');
});
