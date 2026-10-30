/**
 * Fase 1.3 - o mesmo utente não pode ter dois atendimentos sobrepostos,
 * mesmo em profissionais/unidades diferentes e mesmo entre consulta e exame.
 * Reagendar o próprio registro não pode conflitar consigo mesmo.
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
  unidade: '00000000-0000-4000-8000-0000001a0001',
  prof1: '00000000-0000-4000-8000-0000001a0002',
  prof2: '00000000-0000-4000-8000-0000001a0003',
  paciente: '00000000-0000-4000-8000-0000001a0004',
  sched1: '00000000-0000-4000-8000-0000001a0010',
  sched2: '00000000-0000-4000-8000-0000001a0011',
  ofertaConsulta: '00000000-0000-4000-8000-0000001a0020',
  ofertaExame: '00000000-0000-4000-8000-0000001a0021',
  consulta: 'Consulta Sobreposição',
  exame: 'Exame Sobreposição',
};

let server;
let base;
let token;

const DIA = (() => {
  const d = new Date(Date.now() + 63 * 86400000);
  while (d.getDay() !== 4) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

const headers = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

function corpoConsulta(hora, professional_id = P.prof1) {
  return {
    unit_id: P.unidade,
    professional_id,
    specialty: P.consulta,
    location: 'UBS Sobreposição',
    scheduled_at: `${DIA} ${hora}:00`,
  };
}

function corpoExame(hora, professional_id = P.prof2) {
  return {
    unit_id: P.unidade,
    professional_id,
    exam_type: P.exame,
    location: 'UBS Sobreposição',
    scheduled_at: `${DIA} ${hora}:00`,
  };
}

async function preparar() {
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [P.paciente]);
  await pool.query('DELETE FROM exams WHERE user_id = ?', [P.paciente]);
  await pool.query('INSERT IGNORE INTO health_units (id, name, type, neighborhood) VALUES (?,?,?,?)',
    [P.unidade, 'UBS Sobreposição', 'ubs', 'Centro']);
  await pool.query('INSERT IGNORE INTO professionals (id, name, job_title) VALUES (?,?,?),(?,?,?)',
    [P.prof1, 'Dra. Um', 'Clínica Geral', P.prof2, 'Dra. Dois', 'Clínica Geral']);

  for (const [id, kind, nome] of [
    [P.ofertaConsulta, 'consulta', P.consulta],
    [P.ofertaExame, 'exame', P.exame],
  ]) {
    await pool.query(
      `INSERT INTO unit_offers (id, unit_id, kind, name, duration_minutes, active)
       VALUES (?, ?, ?, ?, 30, 1)
       ON DUPLICATE KEY UPDATE duration_minutes = 30, active = 1`,
      [id, P.unidade, kind, nome]
    );
  }

  await pool.query(
    `INSERT IGNORE INTO professional_offers (id, professional_id, unit_id, kind, name)
     VALUES (UUID(), ?, ?, 'consulta', ?), (UUID(), ?, ?, 'exame', ?)`,
    [P.prof1, P.unidade, P.consulta, P.prof2, P.unidade, P.exame]
  );

  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, account_status, priority)
     VALUES (?, 'Paciente Sobreposição', ?, 'x', 'paciente', 'ativo', 'idoso')
     ON DUPLICATE KEY UPDATE account_status = 'ativo', deleted_at = NULL`,
    [P.paciente, `sobreposicao+${P.paciente.slice(-6)}@test.local`]
  );

  for (const [id, prof] of [[P.sched1, P.prof1], [P.sched2, P.prof2]]) {
    await pool.query('DELETE FROM work_schedules WHERE id = ?', [id]);
    await pool.query(
      `INSERT INTO work_schedules (id, professional_id, unit_id, weekday, start_time, end_time, slot_minutes)
       VALUES (?, ?, ?, 4, '08:00', '12:00', 30)`,
      [id, prof, P.unidade]
    );
  }

  token = jwt.sign({ id: P.paciente, role: 'paciente', full_name: 'Paciente Sobreposição' },
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
  await pool.query('DELETE FROM exams WHERE user_id = ?', [P.paciente]).catch(() => {});
  await pool.query('DELETE FROM work_schedules WHERE id IN (?,?)', [P.sched1, P.sched2]).catch(() => {});
  await pool.query('DELETE FROM unit_offers WHERE id IN (?,?)', [P.ofertaConsulta, P.ofertaExame]).catch(() => {});
  await pool.query('DELETE FROM professional_offers WHERE professional_id IN (?,?) AND name IN (?,?)',
    [P.prof1, P.prof2, P.consulta, P.exame]).catch(() => {});
  await pool.query('DELETE FROM professionals WHERE id IN (?,?)', [P.prof1, P.prof2]).catch(() => {});
  await pool.query('DELETE FROM health_units WHERE id = ?', [P.unidade]).catch(() => {});
  await pool.query('DELETE FROM users WHERE id = ?', [P.paciente]).catch(() => {});
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await pool.end().catch(() => {});
});

test('reagendar o próprio registro não conflita consigo mesmo', async () => {
  const criado = await fetch(`${base}/me/appointments`, {
    method: 'POST', headers: headers(), body: JSON.stringify(corpoConsulta('09:00')),
  });
  assert.equal(criado.status, 201, JSON.stringify(await criado.clone().json().catch(() => ({}))));
  const { id } = await criado.json();

  const reagendado = await fetch(`${base}/me/appointments/${id}`, {
    method: 'PUT', headers: headers(), body: JSON.stringify(corpoConsulta('09:00')),
  });
  assert.equal(reagendado.status, 200, JSON.stringify(await reagendado.clone().json().catch(() => ({}))));
});

test('consulta e exame do mesmo utente não se sobrepõem, mesmo em profissionais diferentes', async () => {
  const res = await fetch(`${base}/me/exams`, {
    method: 'POST', headers: headers(), body: JSON.stringify(corpoExame('09:00')),
  });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /já tem outro atendimento/i);
});

test('duas requisições concorrentes do mesmo utente não passam juntas', async () => {
  const [consulta, exame] = await Promise.all([
    fetch(`${base}/me/appointments`, {
      method: 'POST', headers: headers(), body: JSON.stringify(corpoConsulta('10:00')),
    }),
    fetch(`${base}/me/exams`, {
      method: 'POST', headers: headers(), body: JSON.stringify(corpoExame('10:00')),
    }),
  ]);
  const status = [consulta.status, exame.status].sort();
  assert.deepEqual(status, [201, 409]);

  const [[{ total }]] = await pool.query(
    `SELECT (SELECT COUNT(*) FROM appointments WHERE user_id = ? AND scheduled_at = ? AND status IN ('pendente','confirmado'))
          + (SELECT COUNT(*) FROM exams WHERE user_id = ? AND scheduled_at = ? AND status IN ('pendente','confirmado')) AS total`,
    [P.paciente, `${DIA} 10:00:00`, P.paciente, `${DIA} 10:00:00`]
  );
  assert.equal(Number(total), 1);
});

test('registro em para_remarcar não ocupa o horário do utente', async () => {
  const [rows] = await pool.query(
    `SELECT id FROM appointments WHERE user_id = ? AND scheduled_at = ? LIMIT 1`,
    [P.paciente, `${DIA} 09:00:00`]
  );
  assert.equal(rows.length, 1);
  await pool.query('UPDATE appointments SET status = ? WHERE id = ?', ['para_remarcar', rows[0].id]);

  const res = await fetch(`${base}/me/exams`, {
    method: 'POST', headers: headers(), body: JSON.stringify(corpoExame('09:00')),
  });
  assert.equal(res.status, 201, JSON.stringify(await res.clone().json().catch(() => ({}))));
});
