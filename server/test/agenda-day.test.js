/**
 * Fase 1.5 - grade do dia e visão mensal.
 *
 * O atendente continua fail-closed: sem vínculo profissional, agenda vazia;
 * com vínculo, só os registros do próprio profissional. O admin vê tudo e
 * pode filtrar por unidade, profissional e tipo.
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
  unidade: '00000000-0000-4000-8000-0000001c0001',
  profA: '00000000-0000-4000-8000-0000001c0002',
  profB: '00000000-0000-4000-8000-0000001c0003',
  atendenteA: '00000000-0000-4000-8000-0000001c0004',
  atendenteB: '00000000-0000-4000-8000-0000001c0005',
  admin: '00000000-0000-4000-8000-0000001c0006',
  paciente: '00000000-0000-4000-8000-0000001c0007',
  consultaA: '00000000-0000-4000-8000-0000001c0010',
  exameA: '00000000-0000-4000-8000-0000001c0011',
  consultaB: '00000000-0000-4000-8000-0000001c0012',
};

let server;
let base;
let tokenAdmin;
let tokenAtendente;

const DIA = (() => {
  const d = new Date(Date.now() + 67 * 86400000);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();
const MES = DIA.slice(0, 7);

const headers = (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

async function preparar() {
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [P.paciente]);
  await pool.query('DELETE FROM exams WHERE user_id = ?', [P.paciente]);
  await pool.query('INSERT IGNORE INTO health_units (id, name, type, neighborhood) VALUES (?,?,?,?)',
    [P.unidade, 'UBS Agenda', 'ubs', 'Centro']);

  for (const [id, nome, role] of [
    [P.atendenteA, 'Atendente A', 'atendente'],
    [P.atendenteB, 'Atendente B', 'atendente'],
    [P.admin, 'Admin Agenda', 'admin'],
    [P.paciente, 'Paciente Agenda', 'paciente'],
  ]) {
    await pool.query(
      `INSERT INTO users (id, full_name, email, password_hash, role, account_status)
       VALUES (?, ?, ?, 'x', ?, 'ativo')
       ON DUPLICATE KEY UPDATE account_status = 'ativo', deleted_at = NULL`,
      [id, nome, `agenda+${id.slice(-6)}@test.local`, role]
    );
  }

  for (const [id, nome, userId] of [
    [P.profA, 'Dra. Agenda A', P.atendenteA],
    [P.profB, 'Dr. Agenda B', P.atendenteB],
  ]) {
    await pool.query(
      `INSERT INTO professionals (id, name, job_title, user_id) VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), active = 1`,
      [id, nome, 'Clínica Geral', userId]
    );
  }

  const insertAppointment = (id, prof, hora, status) => pool.query(
    `INSERT INTO appointments (id, user_id, specialty, doctor, location, unit_id, professional_id,
                               scheduled_at, duration_minutes, status)
     VALUES (?, ?, 'Consulta Agenda', ?, 'UBS Agenda', ?, ?, ?, 30, ?)`,
    [id, P.paciente, prof === P.profA ? 'Dra. Agenda A' : 'Dr. Agenda B',
      P.unidade, prof, `${DIA} ${hora}:00`, status]
  );
  await insertAppointment(P.consultaA, P.profA, '09:00', 'pendente');
  await insertAppointment(P.consultaB, P.profB, '09:30', 'confirmado');
  await pool.query(
    `INSERT INTO exams (id, user_id, exam_type, location, unit_id, professional_id,
                        scheduled_at, duration_minutes, status)
     VALUES (?, ?, 'Exame Agenda', 'UBS Agenda', ?, ?, ?, 30, 'para_remarcar')`,
    [P.exameA, P.paciente, P.unidade, P.profA, `${DIA} 10:00:00`]
  );

  tokenAdmin = jwt.sign({ id: P.admin, role: 'admin', full_name: 'Admin Agenda' },
    process.env.JWT_SECRET, { expiresIn: '5m' });
  tokenAtendente = jwt.sign({ id: P.atendenteA, role: 'atendente', full_name: 'Atendente A' },
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
  await pool.query('DELETE FROM professionals WHERE id IN (?,?)', [P.profA, P.profB]).catch(() => {});
  await pool.query('DELETE FROM health_units WHERE id = ?', [P.unidade]).catch(() => {});
  await pool.query('DELETE FROM users WHERE id IN (?,?,?,?)',
    [P.atendenteA, P.atendenteB, P.admin, P.paciente]).catch(() => {});
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await pool.end().catch(() => {});
});

test('admin vê o dia inteiro com resumo e itens tipados', async () => {
  const res = await fetch(`${base}/staff/agenda?date=${DIA}`, { headers: headers(tokenAdmin) });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.date, DIA);
  assert.equal(data.items.length, 3);
  assert.deepEqual(data.items.map((i) => i.kind), ['consulta', 'consulta', 'exame']);
  assert.deepEqual(data.summary, {
    total: 3, pendente: 1, confirmado: 1, para_remarcar: 1,
    concluido: 0, cancelado: 0, consultas: 2, exames: 1,
  });
  assert.equal(data.items[0].user_name, 'Paciente Agenda');
  assert.equal(data.items[0].professional_name, 'Dra. Agenda A');
});

test('filtros de tipo, unidade e profissional recortam a grade', async () => {
  const exame = await fetch(`${base}/staff/agenda?date=${DIA}&tipo=exame`, { headers: headers(tokenAdmin) });
  const dadosExame = await exame.json();
  assert.equal(dadosExame.items.length, 1);
  assert.equal(dadosExame.items[0].kind, 'exame');

  const profB = await fetch(`${base}/staff/agenda?date=${DIA}&professional_id=${P.profB}`, { headers: headers(tokenAdmin) });
  const dadosProfB = await profB.json();
  assert.equal(dadosProfB.items.length, 1);
  assert.equal(dadosProfB.items[0].professional_id, P.profB);

  const outraUnidade = await fetch(`${base}/staff/agenda?date=${DIA}&unit_id=${crypto.randomUUID()}`, { headers: headers(tokenAdmin) });
  const dadosOutra = await outraUnidade.json();
  assert.deepEqual(dadosOutra.items, []);
  assert.equal(dadosOutra.summary.total, 0);
});

test('atendente vê só o próprio profissional, mesmo pedindo outro', async () => {
  const res = await fetch(`${base}/staff/agenda?date=${DIA}&professional_id=${P.profB}`, { headers: headers(tokenAtendente) });
  const data = await res.json();
  assert.equal(data.items.length, 2);
  assert.ok(data.items.every((i) => i.professional_id === P.profA));
  assert.equal(data.filtros.professional_id, P.profA);
});

test('data e tipo inválidos devolvem 400', async () => {
  const data = await fetch(`${base}/staff/agenda?date=2026-02-31`, { headers: headers(tokenAdmin) });
  assert.equal(data.status, 400);
  assert.match((await data.json()).error, /Data inválida/i);

  const tipo = await fetch(`${base}/staff/agenda?date=${DIA}&tipo=inventado`, { headers: headers(tokenAdmin) });
  assert.equal(tipo.status, 400);
  assert.match((await tipo.json()).error, /Tipo inválido/i);
});

test('visão mensal soma por dia e por status', async () => {
  const res = await fetch(`${base}/staff/agenda/month?month=${MES}`, { headers: headers(tokenAdmin) });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.month, MES);
  const dia = data.days.find((d) => d.date === DIA);
  assert.ok(dia);
  assert.equal(dia.total, 3);
  assert.equal(dia.consultas, 2);
  assert.equal(dia.exames, 1);
  assert.equal(dia.pendente, 1);
  assert.equal(dia.confirmado, 1);
  assert.equal(dia.para_remarcar, 1);
});

test('mês inválido devolve 400', async () => {
  const res = await fetch(`${base}/staff/agenda/month?month=2026-13`, { headers: headers(tokenAdmin) });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Mês inválido/i);
});
