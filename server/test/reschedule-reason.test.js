/**
 * Fase 1.6 - remarcação com motivo e histórico.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const SERVER = path.resolve(__dirname, '..');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const app = require('../src/app');
const pool = require('../src/db');

const P = {
  unidade: '00000000-0000-4000-8000-0000001d0001',
  profissional: '00000000-0000-4000-8000-0000001d0002',
  paciente: '00000000-0000-4000-8000-0000001d0003',
  admin: '00000000-0000-4000-8000-0000001d0004',
  schedule: '00000000-0000-4000-8000-0000001d0010',
  oferta: '00000000-0000-4000-8000-0000001d0020',
  consulta: 'Consulta Remarcação',
};

let server;
let base;
let token;
let adminToken;
let appointmentId;

const DIA = (() => {
  const d = new Date(Date.now() + 69 * 86400000);
  while (d.getDay() !== 3) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

const nextDia = (() => {
  const d = new Date(`${DIA}T12:00:00`);
  d.setDate(d.getDate() + 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

const headers = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });

async function preparar() {
  await pool.query('DELETE FROM booking_events WHERE booking_id IN (SELECT id FROM appointments WHERE user_id = ?)', [P.paciente]).catch(() => {});
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [P.paciente]);
  await pool.query('INSERT IGNORE INTO health_units (id, name, type, neighborhood) VALUES (?,?,?,?)',
    [P.unidade, 'UBS Remarcação', 'ubs', 'Centro']);
  await pool.query('INSERT IGNORE INTO professionals (id, name, job_title) VALUES (?,?,?)',
    [P.profissional, 'Dr. Remarcação', 'Clínica Geral']);
  await pool.query(
    `INSERT INTO unit_offers (id, unit_id, kind, name, duration_minutes, active) VALUES (?,?,?,?,30,1)
     ON DUPLICATE KEY UPDATE duration_minutes = 30, active = 1`,
    [P.oferta, P.unidade, 'consulta', P.consulta]
  );
  await pool.query(
    `INSERT INTO professional_offers (id, professional_id, unit_id, kind, name) VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE professional_id = VALUES(professional_id)`,
    [crypto.randomUUID(), P.profissional, P.unidade, 'consulta', P.consulta]
  );
  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, account_status)
     VALUES (?, 'Paciente Remarcação', ?, 'x', 'paciente', 'ativo')
     ON DUPLICATE KEY UPDATE account_status = 'ativo', deleted_at = NULL`,
    [P.paciente, `remarcacao+${P.paciente.slice(-6)}@test.local`]
  );
  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, account_status)
     VALUES (?, 'Admin Remarcação', ?, 'x', 'admin', 'ativo')
     ON DUPLICATE KEY UPDATE account_status = 'ativo', deleted_at = NULL`,
    [P.admin, `admin.remarcacao+${P.admin.slice(-6)}@test.local`]
  );
  await pool.query('DELETE FROM work_schedules WHERE id = ?', [P.schedule]);
  await pool.query(
    `INSERT INTO work_schedules (id, professional_id, unit_id, weekday, start_time, end_time, slot_minutes)
     VALUES (?, ?, ?, 3, '08:00', '12:00', 30)`,
    [P.schedule, P.profissional, P.unidade]
  );

  appointmentId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO appointments (id, user_id, specialty, doctor, location, unit_id, professional_id,
                               scheduled_at, duration_minutes, status)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [appointmentId, P.paciente, P.consulta, 'Dr. Remarcação', 'UBS Remarcação',
      P.unidade, P.profissional, `${DIA} 09:00:00`, 30, 'pendente']
  );

  token = jwt.sign({ id: P.paciente, role: 'paciente', full_name: 'Paciente Remarcação' },
    process.env.JWT_SECRET, { expiresIn: '5m' });
  adminToken = jwt.sign({ id: P.admin, role: 'admin', full_name: 'Admin Remarcação' },
    process.env.JWT_SECRET, { expiresIn: '5m' });
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await preparar();
});

test.after(async () => {
  await pool.query('DELETE FROM booking_events WHERE booking_id = ?', [appointmentId]).catch(() => {});
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [P.paciente]).catch(() => {});
  await pool.query('DELETE FROM work_schedules WHERE id = ?', [P.schedule]).catch(() => {});
  await pool.query('DELETE FROM unit_offers WHERE id = ?', [P.oferta]).catch(() => {});
  await pool.query('DELETE FROM professional_offers WHERE professional_id = ? AND name = ?', [P.profissional, P.consulta]).catch(() => {});
  await pool.query('DELETE FROM professionals WHERE id = ?', [P.profissional]).catch(() => {});
  await pool.query('DELETE FROM health_units WHERE id = ?', [P.unidade]).catch(() => {});
  await pool.query('DELETE FROM users WHERE id IN (?,?)', [P.paciente, P.admin]).catch(() => {});
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await pool.end().catch(() => {});
});

test('staff/admin remarcação exige motivo', async () => {
  const res = await fetch(`${base}/staff/appointments/${appointmentId}`, {
    method: 'PATCH', headers: headers(adminToken),
    body: JSON.stringify({ scheduled_at: `${nextDia} 10:00:00` }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /motivo/i);
});

test('staff/admin remarcação com motivo grava rescheduled', async () => {
  const res = await fetch(`${base}/staff/appointments/${appointmentId}`, {
    method: 'PATCH', headers: headers(adminToken),
    body: JSON.stringify({
      scheduled_at: `${nextDia} 10:00:00`,
      reschedule_reason: 'profissional_indisponivel',
    }),
  });
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json().catch(() => ({}))));

  const [[row]] = await pool.query(
    'SELECT scheduled_at, reschedule_reason FROM appointments WHERE id = ?', [appointmentId]
  );
  assert.match(String(row.scheduled_at), new RegExp(`^${nextDia}`));
  assert.equal(row.reschedule_reason, 'profissional_indisponivel');

  const [events] = await pool.query(
    `SELECT event_type, from_scheduled_at, to_scheduled_at, reason
     FROM booking_events WHERE kind = 'consulta' AND booking_id = ?`,
    [appointmentId]
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].event_type, 'rescheduled');
  assert.match(String(events[0].from_scheduled_at), new RegExp(`^${DIA}`));
  assert.match(String(events[0].to_scheduled_at), new RegExp(`^${nextDia}`));
  assert.equal(events[0].reason, 'profissional_indisponivel');
});

test('paciente reagenda com motivo automático', async () => {
  // Usa o registro atual e remarque para outro horário do mesmo dia.
  const res = await fetch(`${base}/me/appointments/${appointmentId}`, {
    method: 'PUT', headers: headers(token),
    body: JSON.stringify({
      specialty: P.consulta,
      location: 'UBS Remarcação',
      scheduled_at: `${DIA} 11:00:00`,
      unit_id: P.unidade,
      professional_id: P.profissional,
    }),
  });
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json().catch(() => ({}))));
  const [[row]] = await pool.query(
    'SELECT reschedule_reason FROM appointments WHERE id = ?', [appointmentId]
  );
  assert.equal(row.reschedule_reason, 'solicitado_pelo_paciente');
});
