/**
 * Fase 3.1 - remarcação pela agenda staff com motivo e histórico.
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
  unidade: '00000000-0000-4000-8000-000000200001',
  profissional: '00000000-0000-4000-8000-000000200002',
  paciente: '00000000-0000-4000-8000-000000200003',
  admin: '00000000-0000-4000-8000-000000200004',
  schedule: '00000000-0000-4000-8000-000000200010',
  oferta: '00000000-0000-4000-8000-000000200020',
  consulta: 'Consulta Agenda',
};

let server;
let base;
let token;
let appointmentId;
let DIA;
let nextDia;

const headers = (t, h = {}) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', ...h });

async function preparar() {
  await pool.query('DELETE FROM booking_events WHERE booking_id IN (SELECT id FROM appointments WHERE user_id = ?)', [P.paciente]).catch(() => {});
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [P.paciente]);
  await pool.query('INSERT IGNORE INTO health_units (id, name, type, neighborhood) VALUES (?,?,?,?)', [P.unidade, 'UBS Agenda', 'ubs', 'Centro']);
  await pool.query('INSERT IGNORE INTO professionals (id, name, job_title) VALUES (?,?,?)', [P.profissional, 'Dr. Agenda', 'Clínica Geral']);
  await pool.query(`INSERT INTO unit_offers (id, unit_id, kind, name, duration_minutes, active) VALUES (?,?,?,?,30,1) ON DUPLICATE KEY UPDATE duration_minutes=30, active=1`, [P.oferta, P.unidade, 'consulta', P.consulta]);
  await pool.query(`INSERT INTO professional_offers (id, professional_id, unit_id, kind, name) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE professional_id=VALUES(professional_id)`, [crypto.randomUUID(), P.profissional, P.unidade, 'consulta', P.consulta]);
  await pool.query(`INSERT INTO users (id, full_name, email, password_hash, role, account_status) VALUES (?,?,?,'x','paciente','ativo') ON DUPLICATE KEY UPDATE account_status='ativo', deleted_at=NULL`, [P.paciente, 'Paciente Agenda', `agenda+${P.paciente.slice(-6)}@test.local`]);
  await pool.query(`INSERT INTO users (id, full_name, email, password_hash, role, account_status) VALUES (?,?,?,'x','admin','ativo') ON DUPLICATE KEY UPDATE account_status='ativo', deleted_at=NULL`, [P.admin, 'Admin Agenda', `admin.agenda+${P.admin.slice(-6)}@test.local`]);
  DIA = (() => { const d = new Date(Date.now() + 79 * 86400000); while (d.getDay() !== 1) d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  nextDia = (() => { const d = new Date(`${DIA}T12:00:00`); d.setDate(d.getDate() + 7); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  await pool.query('DELETE FROM work_schedules WHERE id = ?', [P.schedule]);
  await pool.query(`INSERT INTO work_schedules (id, professional_id, unit_id, weekday, start_time, end_time, slot_minutes) VALUES (?,?,?,?,?,?,?)`, [P.schedule, P.profissional, P.unidade, new Date(`${DIA}T12:00:00`).getDay(), '08:00', '12:00', 30]);
  appointmentId = crypto.randomUUID();
  await pool.query(`INSERT INTO appointments (id, user_id, specialty, doctor, location, unit_id, professional_id, scheduled_at, duration_minutes, status) VALUES (?,?,?,?,?,?,?,?,?,?)`, [appointmentId, P.paciente, P.consulta, 'Dr. Agenda', 'UBS Agenda', P.unidade, P.profissional, `${DIA} 09:00:00`, 30, 'pendente']);
  token = jwt.sign({ id: P.admin, role: 'admin', full_name: 'Admin Agenda' }, process.env.JWT_SECRET, { expiresIn: '5m' });
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

test('PATCH remarcação sem motivo é recusado', async () => {
  const res = await fetch(`${base}/staff/appointments/${appointmentId}`, {
    method: 'PATCH', headers: headers(token),
    body: JSON.stringify({ scheduled_at: `${nextDia} 09:00:00` }),
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /motivo/i);
});

test('PATCH remarcação com motivo atualiza o mesmo registro e grava evento', async () => {
  const res = await fetch(`${base}/staff/appointments/${appointmentId}`, {
    method: 'PATCH', headers: headers(token),
    body: JSON.stringify({ scheduled_at: `${nextDia} 09:00:00`, reschedule_reason: 'teste agenda' }),
  });
  assert.equal(res.status, 200);
  const [rows] = await pool.query('SELECT scheduled_at, reschedule_reason FROM appointments WHERE id=?', [appointmentId]);
  assert.equal(String(rows[0].scheduled_at).slice(0, 10), nextDia);
  assert.equal(rows[0].reschedule_reason, 'teste agenda');
  const events = await fetch(`${base}/staff/booking-events?kind=consulta&booking_id=${appointmentId}`, { headers: headers(token) });
  const evs = await events.json();
  assert.ok(Array.isArray(evs) && evs.length >= 1);
  assert.ok(evs.some((e) => e.event_type === 'rescheduled'));
});
