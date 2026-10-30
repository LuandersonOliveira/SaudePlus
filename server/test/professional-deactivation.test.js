/**
 * Fase 1.7 - desativação de profissional move os atendimentos futuros
 * para a fila "Para remarcar", sem cancelar nem apagar.
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
  unidade: '00000000-0000-4000-8000-0000001e0001',
  profissional: '00000000-0000-4000-8000-0000001e0002',
  paciente: '00000000-0000-4000-8000-0000001e0003',
  admin: '00000000-0000-4000-8000-0000001e0004',
  schedule: '00000000-0000-4000-8000-0000001e0010',
  oferta: '00000000-0000-4000-8000-0000001e0020',
};

let server;
let base;
let token;
let appointmentId;
let examId;

const DIA = (() => {
  const d = new Date(Date.now() + 71 * 86400000);
  while (d.getDay() !== 4) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

const weekday = new Date(`${DIA}T12:00:00`).getDay();

const headers = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

async function preparar() {
  appointmentId = crypto.randomUUID();
  examId = crypto.randomUUID();

  await pool.query(
    'DELETE FROM booking_events WHERE booking_id IN (?, ?)', [appointmentId, examId]
  ).catch(() => {});
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [P.paciente]);
  await pool.query('DELETE FROM exams WHERE user_id = ?', [P.paciente]);

  await pool.query('INSERT IGNORE INTO health_units (id, name, type, neighborhood) VALUES (?,?,?,?)',
    [P.unidade, 'UBS Desativação', 'ubs', 'Centro']);
  await pool.query(
    'INSERT INTO professionals (id, name, job_title, active) VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE active = 1',
    [P.profissional, 'Dr. Desativação', 'Clínica Geral']
  );
  await pool.query(
    `INSERT INTO unit_offers (id, unit_id, kind, name, duration_minutes, active) VALUES (?,?,?,?,30,1)
     ON DUPLICATE KEY UPDATE duration_minutes = 30, active = 1`,
    [P.oferta, P.unidade, 'consulta', 'Consulta Desativação']
  );
  await pool.query(
    `INSERT INTO professional_offers (id, professional_id, unit_id, kind, name) VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE professional_id = VALUES(professional_id)`,
    [crypto.randomUUID(), P.profissional, P.unidade, 'consulta', 'Consulta Desativação']
  );
  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, account_status)
     VALUES (?, 'Paciente Desativação', ?, 'x', 'paciente', 'ativo')
     ON DUPLICATE KEY UPDATE account_status = 'ativo', deleted_at = NULL`,
    [P.paciente, `desativacao+${P.paciente.slice(-6)}@test.local`]
  );
  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, account_status, admin_level)
     VALUES (?, 'Admin Desativação', ?, 'x', 'admin', 'ativo', 'superadmin')
     ON DUPLICATE KEY UPDATE account_status = 'ativo', admin_level = 'superadmin', deleted_at = NULL`,
    [P.admin, `admin.desativacao+${P.admin.slice(-6)}@test.local`]
  );

  await pool.query('DELETE FROM work_schedules WHERE id = ?', [P.schedule]);
  await pool.query(
    `INSERT INTO work_schedules (id, professional_id, unit_id, weekday, start_time, end_time, slot_minutes)
     VALUES (?, ?, ?, ?, '08:00', '12:00', 30)`,
    [P.schedule, P.profissional, P.unidade, weekday]
  );

  await pool.query(
    `INSERT INTO appointments (id, user_id, specialty, doctor, location, unit_id, professional_id,
                               scheduled_at, duration_minutes, status)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [appointmentId, P.paciente, 'Consulta Desativação', 'Dr. Desativação', 'UBS Desativação',
      P.unidade, P.profissional, `${DIA} 09:00:00`, 30, 'confirmado']
  );
  await pool.query(
    `INSERT INTO exams (id, user_id, exam_type, location, unit_id, professional_id,
                        scheduled_at, duration_minutes, status)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [examId, P.paciente, 'Exame Desativação', 'UBS Desativação',
      P.unidade, P.profissional, `${DIA} 09:30:00`, 30, 'pendente']
  );

  token = jwt.sign({ id: P.admin, role: 'admin', full_name: 'Admin Desativação', admin_level: 'superadmin' },
    process.env.JWT_SECRET, { expiresIn: '5m' });
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await preparar();
});

test.after(async () => {
  await pool.query('DELETE FROM booking_events WHERE booking_id IN (?,?)', [appointmentId, examId]).catch(() => {});
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [P.paciente]).catch(() => {});
  await pool.query('DELETE FROM exams WHERE user_id = ?', [P.paciente]).catch(() => {});
  await pool.query('DELETE FROM work_schedules WHERE id = ?', [P.schedule]).catch(() => {});
  await pool.query('DELETE FROM unit_offers WHERE id = ?', [P.oferta]).catch(() => {});
  await pool.query('DELETE FROM professional_offers WHERE professional_id = ? AND name = ?', [P.profissional, 'Consulta Desativação']).catch(() => {});
  await pool.query('DELETE FROM professionals WHERE id = ?', [P.profissional]).catch(() => {});
  await pool.query('DELETE FROM health_units WHERE id = ?', [P.unidade]).catch(() => {});
  await pool.query('DELETE FROM users WHERE id IN (?,?)', [P.paciente, P.admin]).catch(() => {});
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await pool.end().catch(() => {});
});

test('desativar profissional move pendentes/confirmados e registra evento', async () => {
  const res = await fetch(`${base}/admin/professionals/${P.profissional}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ active: 0, reason: 'licença médica' }),
  });
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json().catch(() => ({}))));
  const body = await res.json();
  assert.equal(body.moved, 2);

  const [rows] = await pool.query(
    `SELECT status, reschedule_reason FROM appointments WHERE id = ?
     UNION ALL
     SELECT status, reschedule_reason FROM exams WHERE id = ?`,
    [appointmentId, examId]
  );
  assert.ok(rows.every((r) => r.status === 'para_remarcar'));
  assert.ok(rows.every((r) => r.reschedule_reason === 'profissional_inativado'));

  const [events] = await pool.query(
    `SELECT booking_id, event_type FROM booking_events
     WHERE booking_id IN (?, ?)`,
    [appointmentId, examId]
  );
  assert.equal(events.length, 2);
  assert.ok(events.every((e) => e.event_type === 'professional_deactivated'));

  const [[prof]] = await pool.query('SELECT active FROM professionals WHERE id = ?', [P.profissional]);
  assert.equal(Number(prof.active), 0);
});

test('reativar não cria eventos nem move nada', async () => {
  const before = await pool.query('SELECT COUNT(*) AS total FROM booking_events WHERE booking_id IN (?, ?)', [appointmentId, examId]);
  const res = await fetch(`${base}/admin/professionals/${P.profissional}`, {
    method: 'PATCH', headers: headers(),
    body: JSON.stringify({ active: 1 }),
  });
  assert.equal(res.status, 200);
  const after = await pool.query('SELECT COUNT(*) AS total FROM booking_events WHERE booking_id IN (?, ?)', [appointmentId, examId]);
  assert.equal(Number(after[0][0].total), Number(before[0][0].total));
});