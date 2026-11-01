/**
 * Fase 3.3 - fila do dia e status da agenda.
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
  unidade: '00000000-0000-4000-8000-0000001f0001',
  profissional: '00000000-0000-4000-8000-0000001f0002',
  paciente: '00000000-0000-4000-8000-0000001f0003',
  admin: '00000000-0000-4000-8000-0000001f0004',
  schedule: '00000000-0000-4000-8000-0000001f0010',
  remarcar: '00000000-0000-4000-8000-0000001f0020',
};

let server;
let base;
let token;
let DIA;

const headers = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });

async function preparar() {
  await pool.query('DELETE FROM booking_events WHERE booking_id IN (SELECT id FROM appointments WHERE user_id = ?)', [P.paciente]).catch(() => {});
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [P.paciente]);
  await pool.query('INSERT IGNORE INTO health_units (id, name, type, neighborhood) VALUES (?,?,?,?)', [P.unidade, 'UBS Fila', 'ubs', 'Centro']);
  await pool.query('INSERT IGNORE INTO professionals (id, name, job_title) VALUES (?,?,?)', [P.profissional, 'Dr. Fila', 'Clínica Geral']);
  await pool.query(`INSERT INTO users (id, full_name, email, password_hash, role, account_status) VALUES (?,?,?,'x','paciente','ativo') ON DUPLICATE KEY UPDATE account_status='ativo', deleted_at=NULL`, [P.paciente, 'Paciente Fila', `fila+${P.paciente.slice(-6)}@test.local`]);
  await pool.query(`INSERT INTO users (id, full_name, email, password_hash, role, account_status) VALUES (?,?,?,'x','admin','ativo') ON DUPLICATE KEY UPDATE account_status='ativo', deleted_at=NULL`, [P.admin, 'Admin Fila', `admin.fila+${P.admin.slice(-6)}@test.local`]);
  DIA = (() => { const d = new Date(Date.now() + 73 * 86400000); while (d.getDay() !== 4) d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  await pool.query('DELETE FROM work_schedules WHERE id = ?', [P.schedule]);
  await pool.query(`INSERT INTO work_schedules (id, professional_id, unit_id, weekday, start_time, end_time, slot_minutes) VALUES (?,?,?,?,?,?,?)`, [P.schedule, P.profissional, P.unidade, new Date(`${DIA}T12:00:00`).getDay(), '08:00', '12:00', 30]);
  await pool.query(`INSERT INTO appointments (id, user_id, specialty, doctor, location, unit_id, professional_id, scheduled_at, duration_minutes, status) VALUES (?,?,?,?,?,?,?,?,?, 'para_remarcar')`, [P.remarcar, P.paciente, 'Consulta Fila', 'Dr. Fila', 'UBS Fila', P.unidade, P.profissional, `${DIA} 09:00:00`, 30]);
  token = jwt.sign({ id: P.admin, role: 'admin', full_name: 'Admin Fila' }, process.env.JWT_SECRET, { expiresIn: '5m' });
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await preparar();
});

test.after(async () => {
  await pool.query('DELETE FROM booking_events WHERE booking_id = ?', [P.remarcar]).catch(() => {});
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [P.paciente]).catch(() => {});
  await pool.query('DELETE FROM work_schedules WHERE id = ?', [P.schedule]).catch(() => {});
  await pool.query('DELETE FROM professionals WHERE id = ?', [P.profissional]).catch(() => {});
  await pool.query('DELETE FROM health_units WHERE id = ?', [P.unidade]).catch(() => {});
  await pool.query('DELETE FROM users WHERE id IN (?,?)', [P.paciente, P.admin]).catch(() => {});
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await pool.end().catch(() => {});
});

test('status=para_remarcar retorna apenas pendências operacionais', async () => {
  const res = await fetch(`${base}/staff/agenda?date=${DIA}&status=para_remarcar`, { headers: headers(token) });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].status, 'para_remarcar');
  assert.equal(data.summary.para_remarcar, 1);
});
