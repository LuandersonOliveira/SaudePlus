/**
 * Fase 1.2 - a duração pode vir do serviço, não só do slot da agenda.
 *
 * `unit_offers.duration_minutes` é a fonte preferencial. NULL continua usando
 * `work_schedules.slot_minutes`, para não mudar o legado. O valor escolhido é
 * persistido no agendamento e usado na checagem de conflito e na oferta.
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
const { duracaoMinutos, duracaoServico, getAvailability } = require('../src/utils/booking');

const P = {
  unidade: '00000000-0000-4000-8000-0000000f0001',
  profissional: '00000000-0000-4000-8000-0000000f0002',
  paciente: '00000000-0000-4000-8000-0000000f0003',
  schedule: '00000000-0000-4000-8000-0000000f0010',
  oferta: '00000000-0000-4000-8000-0000000f0020',
  servico: 'Consulta Longa',
};

let server;
let base;
let token;

const DIA = (() => {
  const d = new Date(Date.now() + 61 * 86400000);
  while (d.getDay() !== 2) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

const auth = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
const marcar = (hora) => fetch(`${base}/me/appointments`, {
  method: 'POST',
  headers: auth(),
  body: JSON.stringify({
    unit_id: P.unidade,
    professional_id: P.profissional,
    specialty: P.servico,
    location: 'UBS Serviço',
    scheduled_at: `${DIA} ${hora}:00`,
  }),
});

async function preparar() {
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [P.paciente]).catch(() => {});
  await pool.query('INSERT IGNORE INTO health_units (id, name, type, neighborhood) VALUES (?,?,?,?)',
    [P.unidade, 'UBS Serviço', 'ubs', 'Centro']);
  await pool.query('INSERT IGNORE INTO professionals (id, name, job_title) VALUES (?,?,?)',
    [P.profissional, 'Dra. Serviço', 'Clínica Geral']);
  await pool.query(
    `INSERT INTO unit_offers (id, unit_id, kind, name, duration_minutes, active)
     VALUES (?, ?, 'consulta', ?, 60, 1)
     ON DUPLICATE KEY UPDATE duration_minutes = 60, active = 1`,
    [P.oferta, P.unidade, P.servico]
  );
  await pool.query('INSERT IGNORE INTO professional_offers (id, professional_id, unit_id, kind, name) VALUES (?,?,?,?,?)',
    [crypto.randomUUID(), P.profissional, P.unidade, 'consulta', P.servico]);
  await pool.query(
    `INSERT IGNORE INTO users (id, full_name, email, password_hash, role, account_status, priority)
     VALUES (?, 'Paciente Serviço', ?, 'x', 'paciente', 'ativo', 'idoso')`,
    [P.paciente, `servico+${P.paciente.slice(-6)}@test.local`]
  );
  await pool.query('DELETE FROM work_schedules WHERE id = ?', [P.schedule]);
  await pool.query(
    `INSERT INTO work_schedules (id, professional_id, unit_id, weekday, start_time, end_time, slot_minutes)
     VALUES (?, ?, ?, 2, '08:00', '12:00', 30)`,
    [P.schedule, P.profissional, P.unidade]
  );
  token = jwt.sign({ id: P.paciente, role: 'paciente', full_name: 'Paciente Serviço' },
    process.env.JWT_SECRET, { expiresIn: '5m' });
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await preparar();
});

test.after(async () => {
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [P.paciente]).catch(() => {});
  await pool.query('DELETE FROM work_schedules WHERE id = ?', [P.schedule]).catch(() => {});
  await pool.query('DELETE FROM unit_offers WHERE id = ?', [P.oferta]).catch(() => {});
  await pool.query('DELETE FROM professional_offers WHERE professional_id = ? AND name = ?', [P.profissional, P.servico]).catch(() => {});
  await pool.query('DELETE FROM professionals WHERE id = ?', [P.profissional]).catch(() => {});
  await pool.query('DELETE FROM health_units WHERE id = ?', [P.unidade]).catch(() => {});
  await pool.query('DELETE FROM users WHERE id = ?', [P.paciente]).catch(() => {});
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await pool.end().catch(() => {});
});

test('duração do serviço vence o slot da agenda', async () => {
  assert.equal(
    await duracaoServico(pool, { unitId: P.unidade, serviceName: P.servico, tipo: 'consulta' }),
    60
  );
  assert.equal(
    await duracaoMinutos(pool, {
      unitId: P.unidade, professionalId: P.profissional, serviceName: P.servico,
      tipo: 'consulta', scheduledAt: `${DIA} 09:00:00`,
    }),
    60
  );
});

test('agendamento grava 60 min mesmo com slot de 30', async () => {
  const res = await marcar('09:00');
  assert.equal(res.status, 201, JSON.stringify(await res.clone().json().catch(() => ({}))));
  const [[row]] = await pool.query(
    'SELECT duration_minutes FROM appointments WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
    [P.paciente]
  );
  assert.equal(Number(row.duration_minutes), 60);
});

test('60 min bloqueiam o início seguinte da grade de 30', async () => {
  const res = await marcar('09:30');
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /ocupado/i);
});

test('disponibilidade não oferece início que ultrapassa o fim da escala', async () => {
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [P.paciente]);
  const avail = await getAvailability(pool, {
    tipo: 'consulta', unitId: P.unidade, professionalId: P.profissional,
    serviceName: P.servico, fromDate: DIA, days: 1, userPriority: 'idoso',
  });
  assert.ok(avail.days.length > 0);
  const slots = avail.days[0].slots;
  assert.ok(slots.includes('08:00'));
  assert.ok(slots.includes('11:00'));
  assert.equal(slots.includes('11:30'), false, '11:30 + 60 min passa das 12:00');
});

test('sem duration_minutes, o fallback continua sendo o slot', async () => {
  await pool.query('UPDATE unit_offers SET duration_minutes = NULL WHERE id = ?', [P.oferta]);
  assert.equal(
    await duracaoMinutos(pool, {
      unitId: P.unidade, professionalId: P.profissional, serviceName: P.servico,
      tipo: 'consulta', scheduledAt: `${DIA} 09:00:00`,
    }),
    30
  );
  await pool.query('UPDATE unit_offers SET duration_minutes = 60 WHERE id = ?', [P.oferta]);
});
