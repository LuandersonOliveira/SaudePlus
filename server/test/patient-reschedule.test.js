/**
 * Reagendamento do paciente (NV01) — PUT /me/appointments/:id e /me/exams/:id.
 *
 * O caminho do atendente/admin já revalidava disponibilidade e recalculava a
 * duração. O do paciente não:
 *
 *  1. validava com `pool` e gravava depois, sem transação — um reagendamento
 *     concorrente com um novo agendamento podia ocupar o mesmo horário;
 *  2. carregava `duration_minutes` do horário antigo. Levar um atendimento de
 *     60 min para uma grade de 30 bloqueava o slot seguinte à toa.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const app = require('../src/app');
const pool = require('../src/db');

const P = {
  unidade: '00000000-0000-4000-8000-0000000c0001',
  profissional: '00000000-0000-4000-8000-0000000c0002',
  paciente: '00000000-0000-4000-8000-0000000c0003',
  scheduleLongo: '00000000-0000-4000-8000-0000000c0010',
  scheduleCurto: '00000000-0000-4000-8000-0000000c0011',
  oferta: '00000000-0000-4000-8000-0000000c0020',
};

let server;
let base;
let token;

// Terça-feira bem longe, para não colidir com a agenda real.
const DIA = (() => {
  const d = new Date(Date.now() + 61 * 86400000);
  while (d.getDay() !== 2) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

function outroDia(dias) {
  const d = new Date(`${DIA}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const auth = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

async function marcar(hora, dia = DIA) {
  const res = await fetch(`${base}/me/appointments`, {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify({
      unit_id: P.unidade,
      professional_id: P.profissional,
      specialty: 'Clínica Geral',
      location: 'UBS Reagendamento',
      scheduled_at: `${dia} ${hora}:00`,
    }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function reagendar(id, hora, dia = DIA) {
  const res = await fetch(`${base}/me/appointments/${id}`, {
    method: 'PUT',
    headers: auth(),
    body: JSON.stringify({
      unit_id: P.unidade,
      professional_id: P.profissional,
      specialty: 'Clínica Geral',
      location: 'UBS Reagendamento',
      scheduled_at: `${dia} ${hora}:00`,
    }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function ler(id) {
  const [[row]] = await pool.query(
    'SELECT scheduled_at, status, duration_minutes FROM appointments WHERE id = ?',
    [id]
  );
  return row;
}

async function preparar() {
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [P.paciente]).catch(() => {});
  await pool.query('INSERT IGNORE INTO health_units (id, name, type, neighborhood) VALUES (?,?,?,?)',
    [P.unidade, 'UBS Reagendamento', 'ubs', 'Centro']);
  await pool.query('INSERT IGNORE INTO professionals (id, name, job_title) VALUES (?,?,?)',
    [P.profissional, 'Dra. Reagendamento', 'Clínica Geral']);
  await pool.query('INSERT IGNORE INTO unit_offers (id, unit_id, kind, name, active) VALUES (?,?,?,?,1)',
    [P.oferta, P.unidade, 'consulta', 'Clínica Geral']);
  await pool.query('INSERT IGNORE INTO professional_offers (id, professional_id, unit_id, kind, name) VALUES (?,?,?,?,?)',
    [crypto.randomUUID(), P.profissional, P.unidade, 'consulta', 'Clínica Geral']);
  await pool.query(
    `INSERT IGNORE INTO users (id, full_name, email, password_hash, role, account_status)
     VALUES (?, 'Paciente Reagendamento', 'reagendar@caps.local', 'x', 'paciente', 'ativo')`,
    [P.paciente]
  );
  // Esta suíte testa reagendamento, não prioridade: sem isso, a cota do NV02
  // esconderia 08:00/09:00 e os casos de conflito mudariam de motivo.
  await pool.query("UPDATE users SET priority = 'idoso' WHERE id = ?", [P.paciente]);

  await pool.query('DELETE FROM work_schedules WHERE id IN (?, ?)', [P.scheduleLongo, P.scheduleCurto]);
  await pool.query(
    `INSERT INTO work_schedules (id, professional_id, unit_id, weekday, start_time, end_time, slot_minutes)
     VALUES (?, ?, ?, 2, '08:00', '12:00', 60)`,
    [P.scheduleLongo, P.profissional, P.unidade]
  );
  await pool.query(
    `INSERT INTO work_schedules (id, professional_id, unit_id, weekday, start_time, end_time, slot_minutes)
     VALUES (?, ?, ?, 2, '13:00', '17:00', 30)`,
    [P.scheduleCurto, P.profissional, P.unidade]
  );

  token = jwt.sign(
    { id: P.paciente, email: 'reagendar@caps.local', role: 'paciente', full_name: 'Paciente Reagendamento' },
    process.env.JWT_SECRET,
    { expiresIn: '5m' }
  );
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await preparar();
});

test.after(async () => {
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [P.paciente]).catch(() => {});
  await pool.query('DELETE FROM work_schedules WHERE id IN (?, ?)', [P.scheduleLongo, P.scheduleCurto]).catch(() => {});
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await pool.end().catch(() => {});
});

test('reagendar para o próprio horário não conflita consigo mesmo', async () => {
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [P.paciente]);
  const criado = await marcar('09:00');
  assert.equal(criado.status, 201, JSON.stringify(criado.body));

  const r = await reagendar(criado.body.id, '09:00');
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test('horário ocupado devolve 409 e preserva o agendamento original', async () => {
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [P.paciente]);
  const primeiro = await marcar('09:00');
  const segundo = await marcar('10:00');
  assert.equal(primeiro.status, 201);
  assert.equal(segundo.status, 201);

  const antes = await ler(primeiro.body.id);
  const r = await reagendar(primeiro.body.id, '10:00');
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.match(r.body.error, /ocupado/i);

  const depois = await ler(primeiro.body.id);
  assert.equal(String(depois.scheduled_at).slice(11, 16), '09:00');
  assert.equal(depois.status, antes.status);
});

test('duração é recalculada quando o atendimento muda de grade', async () => {
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [P.paciente]);
  const criado = await marcar('09:00'); // grade de 60 min
  assert.equal(criado.status, 201);

  const paraCurta = await reagendar(criado.body.id, '13:00'); // grade de 30 min
  assert.equal(paraCurta.status, 200, JSON.stringify(paraCurta.body));
  assert.equal(Number((await ler(criado.body.id)).duration_minutes), 30);

  const paraLonga = await reagendar(criado.body.id, '10:00'); // 10:00 ainda é grade de 60
  assert.equal(paraLonga.status, 200, JSON.stringify(paraLonga.body));
  assert.equal(Number((await ler(criado.body.id)).duration_minutes), 60);
});

test('item cancelado não pode ser reagendado', async () => {
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [P.paciente]);
  const criado = await marcar('09:00');
  const cancel = await fetch(`${base}/me/appointments/${criado.body.id}/cancel`, {
    method: 'PATCH', headers: auth(),
  });
  assert.equal(cancel.status, 200);

  const r = await reagendar(criado.body.id, '10:00');
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.match(r.body.error, /cancelad/i);
});

test('fora da janela de 1 ano devolve 400', async () => {
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [P.paciente]);
  const criado = await marcar('09:00');
  const r = await reagendar(criado.body.id, '09:00', outroDia(400));
  assert.equal(r.status, 400, JSON.stringify(r.body));
});

test('dois reagendamentos simultâneos para o mesmo horário: só um passa', async () => {
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [P.paciente]);
  const a = await marcar('09:00');
  const b = await marcar('10:00');
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);

  const [ra, rb] = await Promise.all([
    reagendar(a.body.id, '11:00'),
    reagendar(b.body.id, '11:00'),
  ]);
  const status = [ra.status, rb.status].sort();
  assert.deepEqual(status, [200, 409], `esperava um 200 e um 409; veio ${ra.status}/${rb.status}`);

  const [[contagem]] = await pool.query(
    `SELECT COUNT(*) AS n FROM appointments WHERE user_id = ? AND scheduled_at = ?`,
    [P.paciente, `${DIA} 11:00:00`]
  );
  assert.equal(Number(contagem.n), 1, 'o horário não pode ficar com dois agendamentos');
});
