/**
 * Fase 1.4 - criação pela recepção.
 *
 * A recepção só agenda para utente cadastrado; a validação completa (oferta,
 * vínculo, escala, duração e sobreposição) roda na mesma transação do insert,
 * o `duration_minutes` é persistido e o evento `created` entra junto.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const SERVER = path.resolve(__dirname, '..');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const app = require('../src/app');
const pool = require('../src/db');

const P = {
  unidade: '00000000-0000-4000-8000-0000001b0001',
  profissional: '00000000-0000-4000-8000-0000001b0002',
  paciente: '00000000-0000-4000-8000-0000001b0003',
  admin: '00000000-0000-4000-8000-0000001b0004',
  schedule: '00000000-0000-4000-8000-0000001b0010',
  ofertaConsulta: '00000000-0000-4000-8000-0000001b0020',
  ofertaExame: '00000000-0000-4000-8000-0000001b0021',
  consulta: 'Consulta Recepção',
  exame: 'Exame Recepção',
};

let server;
let base;
let token;

const DIA = (() => {
  const d = new Date(Date.now() + 65 * 86400000);
  while (d.getDay() !== 6) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

const headers = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

async function preparar() {
  await pool.query(
    'DELETE FROM booking_events WHERE booking_id IN (SELECT id FROM appointments WHERE user_id = ?)',
    [P.paciente]
  ).catch(() => {});
  await pool.query(
    'DELETE FROM booking_events WHERE booking_id IN (SELECT id FROM exams WHERE user_id = ?)',
    [P.paciente]
  ).catch(() => {});
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [P.paciente]);
  await pool.query('DELETE FROM exams WHERE user_id = ?', [P.paciente]);

  await pool.query('INSERT IGNORE INTO health_units (id, name, type, neighborhood) VALUES (?,?,?,?)',
    [P.unidade, 'UBS Recepção', 'ubs', 'Centro']);
  await pool.query('INSERT IGNORE INTO professionals (id, name, job_title) VALUES (?,?,?)',
    [P.profissional, 'Dr. Recepção', 'Clínica Geral']);

  for (const [id, kind, nome] of [
    [P.ofertaConsulta, 'consulta', P.consulta],
    [P.ofertaExame, 'exame', P.exame],
  ]) {
    await pool.query(
      `INSERT INTO unit_offers (id, unit_id, kind, name, duration_minutes, active)
       VALUES (?, ?, ?, ?, 60, 1)
       ON DUPLICATE KEY UPDATE duration_minutes = 60, active = 1`,
      [id, P.unidade, kind, nome]
    );
  }

  await pool.query(
    `INSERT INTO professional_offers (id, professional_id, unit_id, kind, name)
     VALUES (UUID(), ?, ?, 'consulta', ?), (UUID(), ?, ?, 'exame', ?)
     ON DUPLICATE KEY UPDATE unit_id = VALUES(unit_id)`,
    [P.profissional, P.unidade, P.consulta, P.profissional, P.unidade, P.exame]
  );

  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, account_status, priority)
     VALUES (?, 'Paciente Recepção', ?, 'x', 'paciente', 'ativo', 'idoso')
     ON DUPLICATE KEY UPDATE account_status = 'ativo', deleted_at = NULL`,
    [P.paciente, `recepcao+${P.paciente.slice(-6)}@test.local`]
  );
  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, account_status)
     VALUES (?, 'Admin Recepção', ?, 'x', 'admin', 'ativo')
     ON DUPLICATE KEY UPDATE account_status = 'ativo', deleted_at = NULL`,
    [P.admin, `admin.recepcao+${P.admin.slice(-6)}@test.local`]
  );

  await pool.query('DELETE FROM work_schedules WHERE id = ?', [P.schedule]);
  await pool.query(
    `INSERT INTO work_schedules (id, professional_id, unit_id, weekday, start_time, end_time, slot_minutes)
     VALUES (?, ?, ?, 6, '08:00', '12:00', 30)`,
    [P.schedule, P.profissional, P.unidade]
  );

  token = jwt.sign({ id: P.admin, role: 'admin', full_name: 'Admin Recepção' },
    process.env.JWT_SECRET, { expiresIn: '5m' });
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await preparar();
});

test.after(async () => {
  await pool.query(
    'DELETE FROM booking_events WHERE booking_id IN (SELECT id FROM appointments WHERE user_id = ?)',
    [P.paciente]
  ).catch(() => {});
  await pool.query(
    'DELETE FROM booking_events WHERE booking_id IN (SELECT id FROM exams WHERE user_id = ?)',
    [P.paciente]
  ).catch(() => {});
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [P.paciente]).catch(() => {});
  await pool.query('DELETE FROM exams WHERE user_id = ?', [P.paciente]).catch(() => {});
  await pool.query('DELETE FROM work_schedules WHERE id = ?', [P.schedule]).catch(() => {});
  await pool.query('DELETE FROM unit_offers WHERE id IN (?,?)', [P.ofertaConsulta, P.ofertaExame]).catch(() => {});
  await pool.query('DELETE FROM professional_offers WHERE professional_id = ? AND name IN (?,?)',
    [P.profissional, P.consulta, P.exame]).catch(() => {});
  await pool.query('DELETE FROM professionals WHERE id = ?', [P.profissional]).catch(() => {});
  await pool.query('DELETE FROM health_units WHERE id = ?', [P.unidade]).catch(() => {});
  await pool.query('DELETE FROM users WHERE id IN (?,?)', [P.paciente, P.admin]).catch(() => {});
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await pool.end().catch(() => {});
});

test('recepção cria consulta para utente cadastrado com duração e evento', async () => {
  const res = await fetch(`${base}/staff/appointments`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      user_id: P.paciente,
      specialty: P.consulta,
      unit_id: P.unidade,
      professional_id: P.profissional,
      scheduled_at: `${DIA} 09:00:00`,
      notes: 'Criado pela recepção',
    }),
  });
  assert.equal(res.status, 201, JSON.stringify(await res.clone().json().catch(() => ({}))));
  const { id, duration_minutes } = await res.json();
  assert.equal(duration_minutes, 60);

  const [[row]] = await pool.query(
    'SELECT status, duration_minutes, location, doctor FROM appointments WHERE id = ?', [id]
  );
  assert.equal(row.status, 'pendente');
  assert.equal(Number(row.duration_minutes), 60);
  assert.equal(row.location, 'UBS Recepção');
  assert.equal(row.doctor, 'Dr. Recepção');

  const [[evento]] = await pool.query(
    `SELECT event_type, to_scheduled_at, to_professional_id, actor_user_id
     FROM booking_events WHERE kind = 'consulta' AND booking_id = ?`, [id]
  );
  assert.equal(evento.event_type, 'created');
  assert.equal(evento.to_professional_id, P.profissional);
  assert.equal(evento.actor_user_id, P.admin);
});

test('recepção cria exame e a sobreposição do utente continua valendo', async () => {
  const exame = await fetch(`${base}/staff/exams`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      user_id: P.paciente,
      exam_type: P.exame,
      unit_id: P.unidade,
      professional_id: P.profissional,
      scheduled_at: `${DIA} 10:30:00`,
    }),
  });
  assert.equal(exame.status, 201, JSON.stringify(await exame.clone().json().catch(() => ({}))));

  const sobreposto = await fetch(`${base}/staff/appointments`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      user_id: P.paciente,
      specialty: P.consulta,
      unit_id: P.unidade,
      professional_id: P.profissional,
      scheduled_at: `${DIA} 09:30:00`,
    }),
  });
  assert.equal(sobreposto.status, 409);
  assert.match((await sobreposto.json()).error, /ocupado|já tem outro atendimento/i);
});

test('utente inexistente não é aceito, nem com nome livre', async () => {
  const res = await fetch(`${base}/staff/appointments`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      user_id: '00000000-0000-4000-8000-0000001bffff',
      full_name: 'Fulano Inventado',
      specialty: P.consulta,
      unit_id: P.unidade,
      professional_id: P.profissional,
      scheduled_at: `${DIA} 11:00:00`,
    }),
  });
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /Paciente não encontrado/i);
});
