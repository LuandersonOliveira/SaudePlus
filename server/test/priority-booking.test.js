/**
 * NV02 — prioridade legal aplicada à oferta de vagas.
 *
 * Agenda de teste: terça 08:00–10:00, slot de 60 min -> 2 vagas, cota de 1.
 * A vaga das 08:00 fica reservada para idoso/gestante/PCD/lactante até 24 h
 * antes do atendimento; a das 09:00 fica livre para todos.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const app = require('../src/app');
const pool = require('../src/db');
const { PRIORITY_MESSAGE } = require('../src/utils/booking');

const P = {
  unidade: '00000000-0000-4000-8000-0000000d0001',
  profissional: '00000000-0000-4000-8000-0000000d0002',
  comum: '00000000-0000-4000-8000-0000000d0003',
  prioritario: '00000000-0000-4000-8000-0000000d0004',
  admin: '00000000-0000-4000-8000-0000000d0005',
  schedule: '00000000-0000-4000-8000-0000000d0010',
  oferta: '00000000-0000-4000-8000-0000000d0020',
};

let server;
let base;
const tokens = {};

const DIA = (() => {
  const d = new Date(Date.now() + 61 * 86400000);
  while (d.getDay() !== 2) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

const OFFSET = (() => {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const alvo = new Date(`${DIA}T00:00:00`);
  return Math.round((alvo.getTime() - hoje.getTime()) / 86400000);
})();

const auth = (quem) => ({ Authorization: `Bearer ${tokens[quem]}`, 'Content-Type': 'application/json' });

async function limparAgendamentos() {
  await pool.query('DELETE FROM appointments WHERE user_id IN (?, ?)', [P.comum, P.prioritario]);
}

async function disponibilidade(quem) {
  const params = new URLSearchParams({
    unit_id: P.unidade,
    kind: 'consulta',
    name: 'Clínica Geral',
    professional_id: P.profissional,
    days: '1',
    offset_days: String(OFFSET),
  });
  const res = await fetch(`${base}/catalog/availability?${params}`, { headers: auth(quem) });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  const dia = body.days.find((d) => d.date === DIA);
  return dia ? dia.slots : [];
}

async function marcar(quem, hora) {
  const res = await fetch(`${base}/me/appointments`, {
    method: 'POST',
    headers: auth(quem),
    body: JSON.stringify({
      unit_id: P.unidade,
      professional_id: P.profissional,
      specialty: 'Clínica Geral',
      location: 'UBS Prioridade',
      scheduled_at: `${DIA} ${hora}:00`,
    }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function inserirAgendamento(userId, hora) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO appointments
       (id, user_id, unit_id, professional_id, specialty, location, scheduled_at, status, duration_minutes)
     VALUES (?,?,?,?, 'Clínica Geral', 'UBS Prioridade', ?, 'pendente', 60)`,
    [id, userId, P.unidade, P.profissional, `${DIA} ${hora}:00`]
  );
  return id;
}

async function registrar(usuario, prioridade) {
  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, account_status, priority)
     VALUES (?, ?, ?, 'x', 'paciente', 'ativo', ?)
     ON DUPLICATE KEY UPDATE priority = VALUES(priority), account_status = 'ativo'`,
    [usuario.id, usuario.nome, usuario.email, prioridade]
  );
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  await limparAgendamentos();
  await pool.query('INSERT IGNORE INTO health_units (id, name, type, neighborhood) VALUES (?,?,?,?)',
    [P.unidade, 'UBS Prioridade', 'ubs', 'Centro']);
  await pool.query('INSERT IGNORE INTO professionals (id, name, job_title) VALUES (?,?,?)',
    [P.profissional, 'Dra. Prioridade', 'Clínica Geral']);
  await pool.query('INSERT IGNORE INTO unit_offers (id, unit_id, kind, name, active) VALUES (?,?,?,?,1)',
    [P.oferta, P.unidade, 'consulta', 'Clínica Geral']);
  await pool.query('INSERT IGNORE INTO professional_offers (id, professional_id, unit_id, kind, name) VALUES (?,?,?,?,?)',
    [crypto.randomUUID(), P.profissional, P.unidade, 'consulta', 'Clínica Geral']);

  await registrar({ id: P.comum, nome: 'Paciente Comum', email: 'comum@caps.local' }, 'nenhuma');
  await registrar({ id: P.prioritario, nome: 'Paciente Prioritário', email: 'prioritario@caps.local' }, 'idoso');
  await registrar({ id: P.admin, nome: 'Admin Prioridade', email: 'admin.prioridade@caps.local' }, null);
  await pool.query("UPDATE users SET role = 'admin', admin_level = 'superadmin' WHERE id = ?", [P.admin]);

  await pool.query('DELETE FROM work_schedules WHERE id = ?', [P.schedule]);
  await pool.query(
    `INSERT INTO work_schedules (id, professional_id, unit_id, weekday, start_time, end_time, slot_minutes)
     VALUES (?, ?, ?, 2, '08:00', '10:00', 60)`,
    [P.schedule, P.profissional, P.unidade]
  );

  tokens.comum = jwt.sign(
    { id: P.comum, email: 'comum@caps.local', role: 'paciente', full_name: 'Paciente Comum' },
    process.env.JWT_SECRET, { expiresIn: '10m' }
  );
  tokens.prioritario = jwt.sign(
    { id: P.prioritario, email: 'prioritario@caps.local', role: 'paciente', full_name: 'Paciente Prioritário' },
    process.env.JWT_SECRET, { expiresIn: '10m' }
  );
  tokens.admin = jwt.sign(
    { id: P.admin, email: 'admin.prioridade@caps.local', role: 'admin', admin_level: 'superadmin', full_name: 'Admin Prioridade' },
    process.env.JWT_SECRET, { expiresIn: '10m' }
  );
});

test.after(async () => {
  await limparAgendamentos().catch(() => {});
  await pool.query('DELETE FROM work_schedules WHERE id = ?', [P.schedule]).catch(() => {});
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await pool.end().catch(() => {});
});

test('paciente comum não vê a vaga reservada; prioritário vê as duas', async () => {
  await limparAgendamentos();

  const doComum = await disponibilidade('comum');
  assert.deepEqual(doComum, ['09:00'], 'a vaga das 08:00 está reservada fora das 24 h');

  const doPrioritario = await disponibilidade('prioritario');
  assert.deepEqual(doPrioritario, ['08:00', '09:00']);
});

test('agendar na vaga reservada: comum recebe 409, prioritário passa', async () => {
  await limparAgendamentos();

  const bloqueado = await marcar('comum', '08:00');
  assert.equal(bloqueado.status, 409, JSON.stringify(bloqueado.body));
  assert.equal(bloqueado.body.error, PRIORITY_MESSAGE);

  const liberado = await marcar('prioritario', '08:00');
  assert.equal(liberado.status, 201, JSON.stringify(liberado.body));
});

test('a vaga não reservada continua aberta para o paciente comum', async () => {
  await limparAgendamentos();

  const livre = await marcar('comum', '09:00');
  assert.equal(livre.status, 201, JSON.stringify(livre.body));
});

test('editar o próprio registro sem mudar de horário não é barrado pela reserva', async () => {
  await limparAgendamentos();

  // Registro anterior ao NV02 numa vaga que passou a ser reservada. Salvar
  // sem trocar o horário não pode devolver 409.
  const antigo = await inserirAgendamento(P.comum, '08:00');
  const res = await fetch(`${base}/admin/appointments/${antigo}`, {
    method: 'PATCH',
    headers: auth('admin'),
    body: JSON.stringify({ scheduled_at: `${DIA} 08:00:00` }),
  });
  assert.equal(res.status, 200, JSON.stringify(await res.json()));
});

test('admin reagenda para vaga reservada conforme a prioridade do PACIENTE', async () => {
  await limparAgendamentos();

  const doComum = await inserirAgendamento(P.comum, '09:00');
  const negado = await fetch(`${base}/admin/appointments/${doComum}`, {
    method: 'PATCH',
    headers: auth('admin'),
    body: JSON.stringify({ scheduled_at: `${DIA} 08:00:00`, reschedule_reason: 'profissional_indisponivel' }),
  });
  const negadoBody = await negado.json();
  assert.equal(negado.status, 409, JSON.stringify(negadoBody));
  assert.match(negadoBody.error, /prioritário/i);

  const doPrioritario = await inserirAgendamento(P.prioritario, '09:00');
  const permitido = await fetch(`${base}/admin/appointments/${doPrioritario}`, {
    method: 'PATCH',
    headers: auth('admin'),
    body: JSON.stringify({ scheduled_at: `${DIA} 08:00:00`, reschedule_reason: 'profissional_indisponivel' }),
  });
  assert.equal(permitido.status, 200, JSON.stringify(await permitido.json()));
});
