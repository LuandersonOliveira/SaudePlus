/**
 * E-08, E-12 e E-19 (Fase 8, item 2.2): o paciente cria, cancela e remarca com o MESMO rastro que staff e
 * admin já deixavam.
 *
 *  - toda criação (paciente, recepção, fila de espera) grava o evento `created`;
 *  - o cancelamento do paciente passa por `applyBookingChange`: numa transação, com o evento `canceled`;
 *  - criar, cancelar e editar pelo paciente gravam em `audit_log` (`patient_create`, `patient_cancel`,
 *    `patient_update`), sem dado pessoal no `details` (ADR-0012);
 *  - o paciente só mexe nos PRÓPRIOS atendimentos (404 para o dos outros).
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
  unidade: '00000000-0000-4000-8000-0000001d0001',
  profissional: '00000000-0000-4000-8000-0000001d0002',
  pacienteA: '00000000-0000-4000-8000-0000001d0003',
  pacienteB: '00000000-0000-4000-8000-0000001d0004',
  schedule: '00000000-0000-4000-8000-0000001d0010',
  ofertaConsulta: '00000000-0000-4000-8000-0000001d0020',
  ofertaExame: '00000000-0000-4000-8000-0000001d0021',
  consulta: 'Consulta Rastro',
  exame: 'Exame Rastro',
};

const DIA = (() => {
  const d = new Date(Date.now() + 66 * 86400000);
  while (d.getDay() !== 6) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

let server;
let base;
const tokenDe = (id) => jwt.sign({ id, email: `rastro+${id.slice(-6)}@test.local`, role: 'paciente', full_name: 'Paciente Rastro' }, process.env.JWT_SECRET, { expiresIn: '10m' });

async function api(method, rota, token, body) {
  const res = await fetch(`${base}${rota}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const eventos = async (id) => (await pool.query(
  'SELECT kind, event_type, actor_user_id, reason, to_professional_id FROM booking_events WHERE booking_id = ? ORDER BY created_at, id', [id]
))[0];
const trilha = async (id, action) => (await pool.query(
  'SELECT actor_id, action, entity_type, details FROM audit_log WHERE entity_id = ? AND action = ? ORDER BY seq', [id, action]
))[0];
const linha = async (tabela, id) => (await pool.query(`SELECT * FROM ${tabela} WHERE id = ?`, [id]))[0][0];

async function limpar() {
  for (const id of [P.pacienteA, P.pacienteB]) {
    await pool.query('DELETE FROM booking_events WHERE booking_id IN (SELECT id FROM appointments WHERE user_id = ?)', [id]).catch(() => {});
    await pool.query('DELETE FROM booking_events WHERE booking_id IN (SELECT id FROM exams WHERE user_id = ?)', [id]).catch(() => {});
    await pool.query('DELETE FROM waitlist WHERE user_id = ?', [id]).catch(() => {});
    await pool.query('DELETE FROM appointments WHERE user_id = ?', [id]).catch(() => {});
    await pool.query('DELETE FROM exams WHERE user_id = ?', [id]).catch(() => {});
  }
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  await limpar();
  await pool.query('INSERT IGNORE INTO health_units (id, name, type, neighborhood) VALUES (?,?,?,?)', [P.unidade, 'UBS Rastro', 'ubs', 'Centro']);
  await pool.query('INSERT IGNORE INTO professionals (id, name, job_title) VALUES (?,?,?)', [P.profissional, 'Dr. Rastro', 'Clínica Geral']);
  for (const [id, kind, nome] of [[P.ofertaConsulta, 'consulta', P.consulta], [P.ofertaExame, 'exame', P.exame]]) {
    await pool.query(
      `INSERT INTO unit_offers (id, unit_id, kind, name, duration_minutes, active) VALUES (?, ?, ?, ?, 60, 1)
       ON DUPLICATE KEY UPDATE duration_minutes = 60, active = 1`, [id, P.unidade, kind, nome]);
  }
  await pool.query(
    `INSERT INTO professional_offers (id, professional_id, unit_id, kind, name)
     VALUES (UUID(), ?, ?, 'consulta', ?), (UUID(), ?, ?, 'exame', ?)
     ON DUPLICATE KEY UPDATE unit_id = VALUES(unit_id)`,
    [P.profissional, P.unidade, P.consulta, P.profissional, P.unidade, P.exame]);
  for (const id of [P.pacienteA, P.pacienteB]) {
    await pool.query(
      `INSERT INTO users (id, full_name, email, password_hash, role, account_status)
       VALUES (?, 'Paciente Rastro', ?, 'x', 'paciente', 'ativo')
       ON DUPLICATE KEY UPDATE account_status = 'ativo', deleted_at = NULL`,
      [id, `rastro+${id.slice(-6)}@test.local`]);
  }
  await pool.query('DELETE FROM work_schedules WHERE id = ?', [P.schedule]);
  await pool.query(
    `INSERT INTO work_schedules (id, professional_id, unit_id, weekday, start_time, end_time, slot_minutes)
     VALUES (?, ?, ?, 6, '08:00', '12:00', 30)`, [P.schedule, P.profissional, P.unidade]);
});

// Cada caso parte de uma agenda vazia: os atendimentos de um não podem sobrepor os do outro (mesmo utente, mesmo profissional).
test.beforeEach(limpar);

test.after(async () => {
  await limpar();
  await pool.query('DELETE FROM work_schedules WHERE id = ?', [P.schedule]).catch(() => {});
  await pool.query('DELETE FROM unit_offers WHERE id IN (?,?)', [P.ofertaConsulta, P.ofertaExame]).catch(() => {});
  await pool.query('DELETE FROM professional_offers WHERE professional_id = ?', [P.profissional]).catch(() => {});
  await pool.query('DELETE FROM professionals WHERE id = ?', [P.profissional]).catch(() => {});
  await pool.query('DELETE FROM health_units WHERE id = ?', [P.unidade]).catch(() => {});
  await pool.query('DELETE FROM users WHERE id IN (?,?)', [P.pacienteA, P.pacienteB]).catch(() => {});
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await pool.end().catch(() => {});
});

const consulta = (hora, extra = {}) => ({
  specialty: P.consulta, location: 'UBS Rastro', unit_id: P.unidade, professional_id: P.profissional,
  scheduled_at: `${DIA} ${hora}`, notes: 'sem alergias', ...extra,
});

test('criar: evento "created" em nome do paciente e linha "patient_create" sem dado pessoal', async () => {
  const r = await api('POST', '/me/appointments', tokenDe(P.pacienteA), consulta('09:30:00'));
  assert.equal(r.status, 201, JSON.stringify(r.body));

  const ev = await eventos(r.body.id);
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].kind, ev[0].event_type, ev[0].actor_user_id, ev[0].to_professional_id], ['consulta', 'created', P.pacienteA, P.profissional]);

  const t = await trilha(r.body.id, 'patient_create');
  assert.equal(t.length, 1);
  assert.equal(t[0].actor_id, P.pacienteA);
  assert.equal(t[0].entity_type, 'appointment');
  assert.equal(t[0].details, `consulta em ${DIA} 09:30:00 (60 min)`);
  for (const proibido of ['Paciente Rastro', 'rastro+', 'sem alergias']) assert.ok(!t[0].details.includes(proibido), proibido);
});

test('criar exame: evento e trilha com o tipo certo', async () => {
  const r = await api('POST', '/me/exams', tokenDe(P.pacienteA), {
    exam_type: P.exame, location: 'UBS Rastro', unit_id: P.unidade, professional_id: P.profissional, scheduled_at: `${DIA} 10:00:00`,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const ev = await eventos(r.body.id);
  assert.deepEqual([ev[0].kind, ev[0].event_type], ['exame', 'created']);
  const t = await trilha(r.body.id, 'patient_create');
  assert.equal(t[0].entity_type, 'exam');
});

test('cancelar: transação única com o evento "canceled", trilha "patient_cancel" e o horário volta a ficar livre', async () => {
  const c = await api('POST', '/me/appointments', tokenDe(P.pacienteA), consulta('09:00:00'));
  assert.equal(c.status, 201, JSON.stringify(c.body));

  const r = await api('PATCH', `/me/appointments/${c.body.id}/cancel`, tokenDe(P.pacienteA));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ok: true });
  assert.equal((await linha('appointments', c.body.id)).status, 'cancelado');

  const ev = await eventos(c.body.id);
  // created_at tem resolução de 1 s: dois eventos da mesma transação empatam e a ordem sai pelo id. Compara como conjunto.
  assert.deepEqual(ev.map((e) => e.event_type).sort(), ['canceled', 'created']);
  assert.equal(ev.find((e) => e.event_type === 'canceled').actor_user_id, P.pacienteA);

  const t = await trilha(c.body.id, 'patient_cancel');
  assert.equal(t.length, 1);
  assert.equal(t[0].actor_id, P.pacienteA);
  assert.match(t[0].details, /status -> cancelado/);

  // o horário cancelado volta a ser ofertado: outra pessoa consegue marcá-lo
  const outra = await api('POST', '/me/appointments', tokenDe(P.pacienteB), consulta('09:00:00'));
  assert.equal(outra.status, 201, JSON.stringify(outra.body));
});

test('cancelar de novo, ou o de OUTRO paciente, ou um inexistente: 409 e 404, sem rastro novo', async () => {
  const c = await api('POST', '/me/appointments', tokenDe(P.pacienteA), consulta('10:30:00'));
  assert.equal(c.status, 201, JSON.stringify(c.body));

  const intruso = await api('PATCH', `/me/appointments/${c.body.id}/cancel`, tokenDe(P.pacienteB));
  assert.equal(intruso.status, 404);
  assert.equal(intruso.body.error, 'Consulta não encontrada.');
  assert.equal((await linha('appointments', c.body.id)).status, 'pendente', 'o atendimento alheio não muda');
  assert.equal((await trilha(c.body.id, 'patient_cancel')).length, 0);

  assert.equal((await api('PATCH', `/me/appointments/${c.body.id}/cancel`, tokenDe(P.pacienteA))).status, 200);
  const denovo = await api('PATCH', `/me/appointments/${c.body.id}/cancel`, tokenDe(P.pacienteA));
  assert.equal(denovo.status, 409);
  assert.match(denovo.body.error, /concluída ou cancelada/);
  assert.equal((await trilha(c.body.id, 'patient_cancel')).length, 1, 'o segundo pedido não duplica a trilha');

  const nenhum = await api('PATCH', '/me/appointments/00000000-0000-4000-8000-0000001dffff/cancel', tokenDe(P.pacienteA));
  assert.equal(nenhum.status, 404);
});

test('editar (PUT): evento "rescheduled" quando o horário muda e linha "patient_update"', async () => {
  const c = await api('POST', '/me/appointments', tokenDe(P.pacienteA), consulta('11:00:00'));
  assert.equal(c.status, 201, JSON.stringify(c.body));

  const r = await api('PUT', `/me/appointments/${c.body.id}`, tokenDe(P.pacienteA), consulta('08:30:00', { notes: 'mudei de ideia' }));
  assert.equal(r.status, 200, JSON.stringify(r.body));

  const ev = await eventos(c.body.id);
  assert.deepEqual(ev.map((e) => e.event_type).sort(), ['created', 'rescheduled']);
  assert.equal(ev.find((e) => e.event_type === 'rescheduled').reason, 'solicitado_pelo_paciente');

  const t = await trilha(c.body.id, 'patient_update');
  assert.equal(t.length, 1);
  assert.equal(t[0].actor_id, P.pacienteA);
  assert.equal(t[0].details, `reagendado de ${DIA} 11:00:00 para ${DIA} 08:30:00`);
  assert.ok(!t[0].details.includes('mudei de ideia'), 'texto livre das notas não vai para a trilha');
});

test('vaga reaberta pela fila: o atendimento criado pela fila também tem o evento "created"', async () => {
  // A ocupa o horário; B espera por ele; A cancela; a fila converte B.
  const a = await api('POST', '/me/appointments', tokenDe(P.pacienteA), consulta('08:00:00', { scheduled_at: `${DIA} 11:00:00` }));
  assert.equal(a.status, 201, JSON.stringify(a.body));
  await pool.query(
    `INSERT INTO waitlist (id, user_id, kind, service_name, unit_id, professional_id) VALUES (UUID(), ?, 'consulta', ?, ?, ?)`,
    [P.pacienteB, P.consulta, P.unidade, P.profissional]);

  assert.equal((await api('PATCH', `/me/appointments/${a.body.id}/cancel`, tokenDe(P.pacienteA))).status, 200);

  const [[convertida]] = await pool.query(
    `SELECT id FROM appointments WHERE user_id = ? AND scheduled_at = ? AND status = 'pendente'`, [P.pacienteB, `${DIA} 11:00:00`]);
  assert.ok(convertida, 'a fila deveria ter criado o atendimento de B');
  const ev = await eventos(convertida.id);
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].event_type, ev[0].actor_user_id, ev[0].reason], ['created', null, 'fila_de_espera']);
});
test('o local vem da UNIDADE: o "location" do corpo é ignorado no POST e no PUT, e não é obrigatório (E-13)', async () => {
  // POST com local forjado
  const c = await api('POST', '/me/appointments', tokenDe(P.pacienteA), consulta('09:30:00', { location: 'Hospital Inventado' }));
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal((await linha('appointments', c.body.id)).location, 'UBS Rastro');

  // PUT com outro local forjado
  const e = await api('PUT', `/me/appointments/${c.body.id}`, tokenDe(P.pacienteA), consulta('10:00:00', { location: 'Clínica Fantasma' }));
  assert.equal(e.status, 200, JSON.stringify(e.body));
  assert.equal((await linha('appointments', c.body.id)).location, 'UBS Rastro');

  // sem "location" no corpo: a criação funciona (antes dava 400)
  const semLocal = consulta('11:00:00');
  delete semLocal.location;
  const s = await api('POST', '/me/appointments', tokenDe(P.pacienteB), semLocal);
  assert.equal(s.status, 201, JSON.stringify(s.body));
  assert.equal((await linha('appointments', s.body.id)).location, 'UBS Rastro');
});
