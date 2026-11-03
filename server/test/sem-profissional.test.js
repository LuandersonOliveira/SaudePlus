/**
 * E-17 / seção 9 (Fase 8, item 2.7): atendimento SEM profissional.
 *
 * Decisão (2026-11-03): fechar o furo, sem quebrar o legado.
 *  - Serviço que a unidade oferece (com vínculo) EXIGE profissional em agendamento novo (já era regra do
 *    `validateBooking`; fica provado por teste).
 *  - Serviço "Outro" (não cadastrado na unidade) pode ficar sem profissional: a unidade aloca depois.
 *  - O buraco real era outro: sem profissional o `validateBooking` devolvia OK ANTES de olhar a
 *    sobreposição do próprio utente, e a remarcação por staff de um registro antigo (sem profissional ou sem
 *    unidade) não revalidava nada. Resultado: o mesmo paciente podia ter dois atendimentos no mesmo horário.
 *  - Registros antigos sem profissional continuam válidos e remarcáveis.
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
  unidade: '00000000-0000-4000-8000-0000002a0001',
  profissional: '00000000-0000-4000-8000-0000002a0002',
  paciente: '00000000-0000-4000-8000-0000002a0003',
  admin: '00000000-0000-4000-8000-0000002a0004',
  oferta: '00000000-0000-4000-8000-0000002a0020',
  schedule: '00000000-0000-4000-8000-0000002a0010',
  cadastrado: 'Consulta Cadastrada SP',
  outro: 'Atendimento Avulso SP',
};

const DIA = (() => {
  const d = new Date(Date.now() + 73 * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

let server;
let base;
const tokenPaciente = () => jwt.sign({ id: P.paciente, email: 'sp@test.local', role: 'paciente', full_name: 'Paciente SP' }, process.env.JWT_SECRET, { expiresIn: '5m' });
const tokenAdmin = () => jwt.sign({ id: P.admin, role: 'admin', admin_level: 'superadmin', full_name: 'Admin SP' }, process.env.JWT_SECRET, { expiresIn: '5m' });

async function api(method, rota, token, body) {
  const res = await fetch(`${base}${rota}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const avulso = (hora, extra = {}) => ({ specialty: P.outro, unit_id: P.unidade, scheduled_at: `${DIA} ${hora}`, ...extra });

async function limpar() {
  await pool.query('DELETE FROM booking_events WHERE booking_id IN (SELECT id FROM appointments WHERE user_id = ?)', [P.paciente]).catch(() => {});
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [P.paciente]).catch(() => {});
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  await limpar();
  await pool.query('INSERT IGNORE INTO health_units (id, name, type, neighborhood) VALUES (?,?,?,?)', [P.unidade, 'UBS Sem Profissional', 'ubs', 'Centro']);
  await pool.query('INSERT IGNORE INTO professionals (id, name, job_title) VALUES (?,?,?)', [P.profissional, 'Dr. SP', 'Clínica Geral']);
  await pool.query(
    `INSERT INTO unit_offers (id, unit_id, kind, name, duration_minutes, active) VALUES (?, ?, 'consulta', ?, 30, 1)
     ON DUPLICATE KEY UPDATE active = 1`, [P.oferta, P.unidade, P.cadastrado]);
  for (const [id, nome, role, nivel] of [[P.paciente, 'Paciente SP', 'paciente', null], [P.admin, 'Admin SP', 'admin', 'superadmin']]) {
    await pool.query(
      `INSERT INTO users (id, full_name, email, password_hash, role, account_status, admin_level)
       VALUES (?, ?, ?, 'x', ?, 'ativo', ?) ON DUPLICATE KEY UPDATE account_status = 'ativo', deleted_at = NULL`,
      [id, nome, `sp+${id.slice(-6)}@test.local`, role, nivel]);
  }
});

test.beforeEach(limpar);

test.after(async () => {
  await limpar();
  await pool.query('DELETE FROM unit_offers WHERE id = ?', [P.oferta]).catch(() => {});
  await pool.query('DELETE FROM professionals WHERE id = ?', [P.profissional]).catch(() => {});
  await pool.query('DELETE FROM health_units WHERE id = ?', [P.unidade]).catch(() => {});
  await pool.query('DELETE FROM users WHERE id IN (?,?)', [P.paciente, P.admin]).catch(() => {});
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await pool.end().catch(() => {});
});

test('serviço CADASTRADO na unidade exige profissional: sem ele, 409', async () => {
  const r = await api('POST', '/me/appointments', tokenPaciente(), avulso('09:00:00', { specialty: P.cadastrado }));
  assert.equal(r.status, 409);
  assert.match(r.body.error, /Selecione um profissional/);
});

test('serviço avulso ("Outro") pode ficar sem profissional, com 30 min de duração', async () => {
  const r = await api('POST', '/me/appointments', tokenPaciente(), avulso('09:00:00'));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const [[linha]] = await pool.query('SELECT professional_id, duration_minutes FROM appointments WHERE id = ?', [r.body.id]);
  assert.equal(linha.professional_id, null);
  assert.equal(Number(linha.duration_minutes), 30);
});

test('o MESMO paciente não pode ter dois atendimentos avulsos sobrepostos', async () => {
  const a = await api('POST', '/me/appointments', tokenPaciente(), avulso('09:00:00'));
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const b = await api('POST', '/me/appointments', tokenPaciente(), avulso('09:15:00'));
  assert.equal(b.status, 409, JSON.stringify(b.body));
  assert.match(b.body.error, /já tem outro atendimento/);
  // horário seguinte, sem sobreposição: passa
  assert.equal((await api('POST', '/me/appointments', tokenPaciente(), avulso('09:30:00'))).status, 201);
});

test('corrida: quatro POST avulsos simultâneos do mesmo paciente e horário resultam em UM atendimento', async () => {
  const respostas = await Promise.all(Array.from({ length: 4 }, () => api('POST', '/me/appointments', tokenPaciente(), avulso('10:00:00'))));
  const status = respostas.map((r) => r.status).sort();
  assert.deepEqual(status, [201, 409, 409, 409], JSON.stringify(respostas.map((r) => r.body)));
  const [[n]] = await pool.query('SELECT COUNT(*) AS n FROM appointments WHERE user_id = ? AND scheduled_at = ?', [P.paciente, `${DIA} 10:00:00`]);
  assert.equal(Number(n.n), 1);
});

async function legado({ quando, unit = null, status = 'pendente' }) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO appointments (id, user_id, specialty, location, unit_id, professional_id, scheduled_at, duration_minutes, status)
     VALUES (?, ?, ?, 'UBS Antiga', ?, NULL, ?, 30, ?)`, [id, P.paciente, P.outro, unit, quando, status]);
  return id;
}

test('staff remarca registro ANTIGO (sem profissional e sem unidade) para um horário livre: continua remarcável', async () => {
  const id = await legado({ quando: `${DIA} 14:00:00` });
  const r = await api('PATCH', `/staff/appointments/${id}`, tokenAdmin(), { scheduled_at: `${DIA} 15:00:00`, reschedule_reason: 'solicitado_pelo_paciente' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const [[linha]] = await pool.query('SELECT scheduled_at FROM appointments WHERE id = ?', [id]);
  assert.equal(String(linha.scheduled_at), `${DIA} 15:00:00`);
});

test('staff remarca registro ANTIGO para cima de OUTRO atendimento do mesmo paciente: 409 (antes passava sem revalidar)', async () => {
  const id = await legado({ quando: `${DIA} 14:00:00` });
  await legado({ quando: `${DIA} 16:00:00` });
  const r = await api('PATCH', `/staff/appointments/${id}`, tokenAdmin(), { scheduled_at: `${DIA} 16:00:00`, reschedule_reason: 'solicitado_pelo_paciente' });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.match(r.body.error, /já tem outro atendimento/);
  const [[linha]] = await pool.query('SELECT scheduled_at FROM appointments WHERE id = ?', [id]);
  assert.equal(String(linha.scheduled_at), `${DIA} 14:00:00`, 'nada mudou');
});

test('paciente edita (PUT) registro ANTIGO sem unidade: horário livre passa; sobreposto, 409', async () => {
  const id = await legado({ quando: `${DIA} 14:00:00` });
  await legado({ quando: `${DIA} 16:00:00` });
  const corpo = (hora) => ({ specialty: P.outro, scheduled_at: `${DIA} ${hora}`, notes: 'x' });

  const livre = await api('PUT', `/me/appointments/${id}`, tokenPaciente(), corpo('15:00:00'));
  assert.equal(livre.status, 200, JSON.stringify(livre.body));

  const sobreposto = await api('PUT', `/me/appointments/${id}`, tokenPaciente(), corpo('16:00:00'));
  assert.equal(sobreposto.status, 409, JSON.stringify(sobreposto.body));
  assert.match(sobreposto.body.error, /já tem outro atendimento/);
});

test('atendimento cancelado do próprio paciente não bloqueia o horário', async () => {
  await legado({ quando: `${DIA} 09:00:00`, status: 'cancelado' });
  assert.equal((await api('POST', '/me/appointments', tokenPaciente(), avulso('09:00:00'))).status, 201);
});
