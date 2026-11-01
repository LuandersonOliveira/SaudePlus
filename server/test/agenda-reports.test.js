/**
 * Fase 3.2 base - relatórios da agenda (NV07).
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
  unidade: '00000000-0000-4000-8000-000000210001',
  profissional: '00000000-0000-4000-8000-000000210002',
  paciente: '00000000-0000-4000-8000-000000210003',
  admin: '00000000-0000-4000-8000-000000210004',
  schedule: '00000000-0000-4000-8000-000000210010',
  consulta: '00000000-0000-4000-8000-000000210020',
};

let server;
let base;
let token;
let DIA;

const headers = (t) => ({ Authorization: `Bearer ${t}` });

async function preparar() {
  await pool.query('DELETE FROM booking_events WHERE booking_id IN (SELECT id FROM appointments WHERE user_id = ?)', [P.paciente]).catch(() => {});
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [P.paciente]);
  await pool.query('INSERT IGNORE INTO health_units (id, name, type, neighborhood) VALUES (?,?,?,?)', [P.unidade, 'UBS Rel', 'ubs', 'Centro']);
  await pool.query('INSERT IGNORE INTO professionals (id, name, job_title) VALUES (?,?,?)', [P.profissional, 'Dr. Rel', 'Clínica Geral']);
  await pool.query(`INSERT INTO users (id, full_name, email, password_hash, role, account_status) VALUES (?,?,?,'x','paciente','ativo') ON DUPLICATE KEY UPDATE account_status='ativo', deleted_at=NULL`, [P.paciente, 'Paciente Rel', `rel+${P.paciente.slice(-6)}@test.local`]);
  await pool.query(`INSERT INTO users (id, full_name, email, password_hash, role, account_status) VALUES (?,?,?,'x','admin','ativo') ON DUPLICATE KEY UPDATE account_status='ativo', deleted_at=NULL`, [P.admin, 'Admin Rel', `admin.rel+${P.admin.slice(-6)}@test.local`]);
  DIA = (() => { const d = new Date(Date.now() + 71 * 86400000); while (d.getDay() !== 2) d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  await pool.query('DELETE FROM work_schedules WHERE id = ?', [P.schedule]);
  await pool.query(`INSERT INTO work_schedules (id, professional_id, unit_id, weekday, start_time, end_time, slot_minutes) VALUES (?,?,?,?,?,?,?)`, [P.schedule, P.profissional, P.unidade, new Date(`${DIA}T12:00:00`).getDay(), '08:00', '12:00', 30]);
  await pool.query(`INSERT INTO appointments (id, user_id, specialty, doctor, location, unit_id, professional_id, scheduled_at, duration_minutes, status, outcome) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [P.consulta, P.paciente, 'Consulta Rel', 'Dr. Rel', 'UBS Rel', P.unidade, P.profissional, `${DIA} 09:00:00`, 30, 
'concluido', 'compareceu']);
  token = jwt.sign({ id: P.admin, role: 'admin', full_name: 'Admin Rel' }, process.env.JWT_SECRET, { expiresIn: '5m' });
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await preparar();
});

test.after(async () => {
  await pool.query('DELETE FROM booking_events WHERE booking_id = ?', [P.consulta]).catch(() => {});
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [P.paciente]).catch(() => {});
  await pool.query('DELETE FROM work_schedules WHERE id = ?', [P.schedule]).catch(() => {});
  await pool.query('DELETE FROM professionals WHERE id = ?', [P.profissional]).catch(() => {});
  await pool.query('DELETE FROM health_units WHERE id = ?', [P.unidade]).catch(() => {});
  await pool.query('DELETE FROM users WHERE id IN (?,?)', [P.paciente, P.admin]).catch(() => {});
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await pool.end().catch(() => {});
});

test('relatório retorna totais, absenteísmo e ocupação', async () => {
  const to = DIA;
  const from = DIA;
  const res = await fetch(`${base}/staff/agenda/reports?from=${from}&to=${to}`, { headers: headers(token) });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.total, 1);
  assert.equal(data.totals.concluidos, 1);
  assert.equal(data.totals.faltas, 0);
  assert.equal(data.absence_rate, 0);
  assert.ok(data.period || data.periodo);
});
