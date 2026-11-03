/**
 * E-17 (Fase 8, item 2.6): desativar uma UNIDADE trata os atendimentos futuros e a fila como a desativação
 * de profissional já tratava.
 *
 * Antes só mudava `active`: os atendimentos futuros ficavam marcados numa unidade que o catálogo já não
 * oferecia, e a fila continuava esperando por ela. Agora, numa transação só:
 *  - atendimentos FUTUROS e ATIVOS (pendente/confirmado) da unidade vão para "para_remarcar", com o motivo
 *    `unidade_inativada` e um evento `status_changed` por atendimento;
 *  - entradas da fila presas à unidade viram `cancelado` (entrada "qualquer unidade" não é tocada);
 *  - depois do commit, os pacientes afetados recebem aviso por e-mail (melhor esforço).
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
const mailer = require('../src/services/mailer');

const P = {
  unidade: '00000000-0000-4000-8000-0000001f0001',
  outraUnidade: '00000000-0000-4000-8000-0000001f0002',
  profissional: '00000000-0000-4000-8000-0000001f0003',
  pacienteA: '00000000-0000-4000-8000-0000001f0004',
  pacienteB: '00000000-0000-4000-8000-0000001f0005',
  pacienteC: '00000000-0000-4000-8000-0000001f0006',
  admin: '00000000-0000-4000-8000-0000001f0007',
  gestorSemUnits: '00000000-0000-4000-8000-0000001f0008',
};

const DIA = (() => {
  const d = new Date(Date.now() + 72 * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();
const PASSADO = '2020-01-15 09:00:00';

let server;
let base;
let token;
let ids;
let avisos;
const original = mailer.enviar;

const tokenDe = (id, nivel) => jwt.sign({ id, role: 'admin', full_name: 'Admin Unidade', admin_level: nivel }, process.env.JWT_SECRET, { expiresIn: '5m' });
const patch = (id, corpo, tk = token) => fetch(`${base}/health-units/${id}`, {
  method: 'PATCH', headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
});
const linha = async (tabela, id) => (await pool.query(`SELECT * FROM ${tabela} WHERE id = ?`, [id]))[0][0];

async function inserirAtendimento({ tabela = 'appointments', user, unit, quando, status }) {
  const id = crypto.randomUUID();
  if (tabela === 'appointments') {
    await pool.query(
      `INSERT INTO appointments (id, user_id, specialty, doctor, location, unit_id, professional_id, scheduled_at, duration_minutes, status)
       VALUES (?,?,?,?,?,?,?,?,30,?)`, [id, user, 'Consulta Unidade', 'Dr. Unidade', 'UBS', unit, P.profissional, quando, status]);
  } else {
    await pool.query(
      `INSERT INTO exams (id, user_id, exam_type, location, unit_id, professional_id, scheduled_at, duration_minutes, status)
       VALUES (?,?,?,?,?,?,?,30,?)`, [id, user, 'Exame Unidade', 'UBS', unit, P.profissional, quando, status]);
  }
  return id;
}

async function preparar() {
  await pool.query('INSERT IGNORE INTO health_units (id, name, type, neighborhood, active) VALUES (?,?,?,?,1)', [P.unidade, 'UBS Desativável', 'ubs', 'Centro']);
  await pool.query('INSERT IGNORE INTO health_units (id, name, type, neighborhood, active) VALUES (?,?,?,?,1)', [P.outraUnidade, 'UBS Outra', 'ubs', 'Norte']);
  await pool.query('INSERT IGNORE INTO professionals (id, name, job_title) VALUES (?,?,?)', [P.profissional, 'Dr. Unidade', 'Clínica Geral']);
  for (const [id, nome, nivel, role] of [
    [P.pacienteA, 'Paciente A', null, 'paciente'], [P.pacienteB, 'Paciente B', null, 'paciente'], [P.pacienteC, 'Paciente C', null, 'paciente'],
    [P.admin, 'Admin Unidade', 'superadmin', 'admin'], [P.gestorSemUnits, 'Admin Alertas', 'alertas', 'admin'],
  ]) {
    await pool.query(
      `INSERT INTO users (id, full_name, email, password_hash, role, account_status, admin_level)
       VALUES (?, ?, ?, 'x', ?, 'ativo', ?) ON DUPLICATE KEY UPDATE account_status = 'ativo', deleted_at = NULL, admin_level = VALUES(admin_level)`,
      [id, nome, `unidade+${id.slice(-6)}@test.local`, role, nivel]);
  }
  token = tokenDe(P.admin, 'superadmin');

  ids = {
    futuraA: await inserirAtendimento({ user: P.pacienteA, unit: P.unidade, quando: `${DIA} 09:00:00`, status: 'confirmado' }),
    futuraExameB: await inserirAtendimento({ tabela: 'exams', user: P.pacienteB, unit: P.unidade, quando: `${DIA} 10:00:00`, status: 'pendente' }),
    passada: await inserirAtendimento({ user: P.pacienteA, unit: P.unidade, quando: PASSADO, status: 'concluido' }),
    cancelada: await inserirAtendimento({ user: P.pacienteC, unit: P.unidade, quando: `${DIA} 11:00:00`, status: 'cancelado' }),
    outraUnidade: await inserirAtendimento({ user: P.pacienteC, unit: P.outraUnidade, quando: `${DIA} 11:30:00`, status: 'pendente' }),
  };
  const fila = async (user, unit) => {
    const id = crypto.randomUUID();
    await pool.query(
      "INSERT INTO waitlist (id, user_id, kind, service_name, unit_id, professional_id) VALUES (?, ?, 'consulta', ?, ?, NULL)",
      [id, user, `Serviço ${id.slice(0, 6)}`, unit]);
    return id;
  };
  ids.filaDaUnidade = await fila(P.pacienteC, P.unidade);
  ids.filaQualquerUnidade = await fila(P.pacienteB, null);
  ids.filaOutraUnidade = await fila(P.pacienteA, P.outraUnidade);
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await preparar();
  avisos = [];
  mailer.enviar = async (msg) => { avisos.push(msg); return { enviado: true }; };
});

test.after(async () => {
  mailer.enviar = original;
  for (const id of [P.pacienteA, P.pacienteB, P.pacienteC]) {
    await pool.query('DELETE FROM waitlist WHERE user_id = ?', [id]).catch(() => {});
    await pool.query('DELETE FROM appointments WHERE user_id = ?', [id]).catch(() => {});
    await pool.query('DELETE FROM exams WHERE user_id = ?', [id]).catch(() => {});
  }
  await pool.query('DELETE FROM professionals WHERE id = ?', [P.profissional]).catch(() => {});
  await pool.query('DELETE FROM health_units WHERE id IN (?,?)', [P.unidade, P.outraUnidade]).catch(() => {});
  await pool.query('DELETE FROM users WHERE id IN (?,?,?,?,?)', [P.pacienteA, P.pacienteB, P.pacienteC, P.admin, P.gestorSemUnits]).catch(() => {});
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await pool.end().catch(() => {});
});

test('renomear a unidade não mexe em atendimento nem na fila', async () => {
  const r = await patch(P.unidade, { neighborhood: 'Centro Histórico' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).moved, 0);
  assert.equal((await linha('appointments', ids.futuraA)).status, 'confirmado');
  assert.equal((await linha('waitlist', ids.filaDaUnidade)).status, 'aguardando');
});

test('desativar: move os futuros ativos, com motivo e evento, cancela a fila da unidade e avisa os pacientes', async () => {
  const r = await patch(P.unidade, { active: 0 });
  const corpo = await r.json();
  assert.equal(r.status, 200, JSON.stringify(corpo));
  assert.equal(corpo.moved, 2, 'a consulta de A e o exame de B');
  assert.equal(corpo.waitlist_canceled, 1);

  // atendimentos futuros e ativos
  for (const [tabela, id] of [['appointments', ids.futuraA], ['exams', ids.futuraExameB]]) {
    const l = await linha(tabela, id);
    assert.equal(l.status, 'para_remarcar');
    assert.equal(l.reschedule_reason, 'unidade_inativada');
    assert.equal(l.unit_id, P.unidade, 'o vínculo com a unidade fica (para o histórico)');
  }
  // o que NÃO deve mudar
  assert.equal((await linha('appointments', ids.passada)).status, 'concluido', 'passado não muda');
  assert.equal((await linha('appointments', ids.cancelada)).status, 'cancelado', 'cancelado não muda');
  assert.equal((await linha('appointments', ids.outraUnidade)).status, 'pendente', 'outra unidade não muda');

  // eventos em nome do admin, um por atendimento movido
  const [eventos] = await pool.query(
    'SELECT booking_id, kind, event_type, reason, actor_user_id FROM booking_events WHERE booking_id IN (?, ?)', [ids.futuraA, ids.futuraExameB]);
  assert.equal(eventos.length, 2);
  for (const e of eventos) {
    assert.equal(e.event_type, 'status_changed');
    assert.equal(e.reason, 'unidade_inativada');
    assert.equal(e.actor_user_id, P.admin);
  }
  assert.deepEqual(eventos.map((e) => e.kind).sort(), ['consulta', 'exame']);

  // fila: só a presa à unidade
  assert.equal((await linha('waitlist', ids.filaDaUnidade)).status, 'cancelado');
  assert.equal((await linha('waitlist', ids.filaQualquerUnidade)).status, 'aguardando', 'entrada "qualquer unidade" continua');
  assert.equal((await linha('waitlist', ids.filaOutraUnidade)).status, 'aguardando');

  // unidade inativa
  assert.equal(Number((await linha('health_units', P.unidade)).active), 0);

  // avisos depois do commit: A e B (atendimentos movidos) e C (fila cancelada); mais ninguém
  const destinatarios = avisos.map((a) => a.para).sort();
  assert.deepEqual(destinatarios, [P.pacienteA, P.pacienteB, P.pacienteC].map((id) => `unidade+${id.slice(-6)}@test.local`).sort());
  assert.ok(avisos.every((a) => /unidade/i.test(a.assunto)), avisos.map((a) => a.assunto).join(' | '));
});

test('auditoria da desativação: ações e contagens, sem dado pessoal', async () => {
  const [[t]] = await pool.query(
    "SELECT actor_id, details FROM audit_log WHERE action = 'admin_update_unit' AND entity_id = ? AND details LIKE '%desativada%' ORDER BY seq DESC LIMIT 1", [P.unidade]);
  assert.equal(t.actor_id, P.admin);
  assert.match(t.details, /unidade desativada/);
  assert.match(t.details, /2 atendimento\(s\) movido\(s\) para remarcar/);
  assert.match(t.details, /1 entrada\(s\) da fila cancelada\(s\)/);
  for (const proibido of ['Paciente', '@test.local']) assert.ok(!t.details.includes(proibido), proibido);
});

test('desativar de novo uma unidade já inativa não move nem avisa ninguém', async () => {
  const antes = avisos.length;
  const r = await patch(P.unidade, { active: 0 });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).moved, 0, 'já estava inativa: não há o que mover');
  assert.equal(avisos.length, antes);
});

test('reativar não desfaz nada: atendimentos seguem em "para remarcar" e a fila cancelada continua cancelada', async () => {
  const r = await patch(P.unidade, { active: 1 });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).moved, 0);
  assert.equal((await linha('appointments', ids.futuraA)).status, 'para_remarcar');
  assert.equal((await linha('waitlist', ids.filaDaUnidade)).status, 'cancelado');
  assert.equal(Number((await linha('health_units', P.unidade)).active), 1);
});

test('sem a capability "units": 403 e nada muda', async () => {
  const r = await patch(P.outraUnidade, { active: 0 }, tokenDe(P.gestorSemUnits, 'alertas'));
  assert.equal(r.status, 403);
  assert.equal(Number((await linha('health_units', P.outraUnidade)).active), 1);
  assert.equal((await linha('appointments', ids.outraUnidade)).status, 'pendente');
});

test('unidade inexistente: 404', async () => {
  const r = await patch(crypto.randomUUID(), { active: 0 });
  assert.equal(r.status, 404);
});
