/**
 * services/adminProfessionals.js + schemas/adminProfessionals.js (A1, passo 8c).
 * O contrato HTTP segue em admin-silent-failures, admin-professionals-*, catalog-* e agenda-*.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

const SERVER = path.resolve(__dirname, '..');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const pool = require('../src/db');
const svc = require('../src/services/adminProfessionals');
const V = require('../src/schemas/adminProfessionals');
const mailer = require('../src/services/mailer');
const { listarEventos } = require('../src/services/booking-events');

const uid = () => crypto.randomUUID();
const unit = uid();
const unit2 = uid();
const PROFS = [];

test.before(async () => {
  await pool.query("INSERT INTO health_units (id, name, type, active) VALUES (?, 'UBS Prof A', 'ubs', 1), (?, 'UBS Prof B', 'ubs', 1)", [unit, unit2]);
});
const USUARIOS = [];
test.after(async () => {
  for (const id of USUARIOS) {
    await pool.query('DELETE FROM booking_events WHERE booking_id IN (SELECT id FROM appointments WHERE user_id = ? UNION SELECT id FROM exams WHERE user_id = ?)', [id, id]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
  }
  for (const id of PROFS) {
    for (const t of ['professional_offers', 'work_schedules', 'schedule_blocks']) await pool.query(`DELETE FROM ${t} WHERE professional_id = ?`, [id]).catch(() => {});
    await pool.query('DELETE FROM professionals WHERE id = ?', [id]).catch(() => {});
  }
  await pool.query('DELETE FROM health_units WHERE id IN (?,?)', [unit, unit2]).catch(() => {});
  await pool.end().catch(() => {});
});

async function novo(nome = `Prof ${uid().slice(0, 6)}`) {
  const r = await svc.criarProfissional({ name: nome }, '');
  PROFS.push(r.id);
  return r.id;
}

// ---------------------------------------------------------------------------
// schemas (puros)
// ---------------------------------------------------------------------------

test('cleanTime: normaliza para HH:MM:SS e recusa hora/minuto inexistentes', () => {
  assert.equal(V.cleanTime('08:00'), '08:00:00');
  assert.equal(V.cleanTime('8:00'), null);
  assert.equal(V.cleanTime('23:59:59'), '23:59:00');
  for (const v of ['99:99', '12:99', '24:00', '', null, undefined, 800, 'ab:cd']) assert.equal(V.cleanTime(v), null, String(v));
  assert.equal(V.minutesOf('08:30:00'), 510);
});

test('motivoDe: corpo ou ?reason=, aparado e com teto de 1000', () => {
  assert.equal(V.motivoDe({ body: { reason: '  folga  ' } }), 'folga');
  assert.equal(V.motivoDe({ body: {}, query: { reason: 'por query' } }), 'por query');
  assert.equal(V.motivoDe({ body: { reason: 'x'.repeat(3000) } }).length, 1000);
  assert.equal(V.motivoDe({}), '');
  assert.equal(V.sufixoMotivo('abc'), '; motivo: abc');
  assert.equal(V.sufixoMotivo(''), '');
});

test('validarProfissional / validarVinculo: mensagens na ordem de sempre', () => {
  assert.deepEqual(V.validarProfissional({ name: '   ' }), { ok: false, error: 'Nome do profissional é obrigatório.' });
  assert.deepEqual(V.validarProfissional({ name: ' Ana ', job_title: '', registry: 'CRM 1' }).dados, { name: 'Ana', jobTitle: null, registry: 'CRM 1' });
  assert.equal(V.validarVinculo({ kind: 'outro' }).error, 'Selecione a unidade.');
  assert.equal(V.validarVinculo({ unit_id: 'u', kind: 'outro' }).error, 'Tipo inválido (consulta ou exame).');
  assert.equal(V.validarVinculo({ unit_id: 'u', kind: 'consulta', name: '  ' }).error, 'Informe a especialidade ou tipo de exame.');
  assert.deepEqual(V.validarVinculo({ unit_id: 'u', kind: 'exame', name: ' Raio-X ' }).dados, { unitId: 'u', kind: 'exame', serviceName: 'Raio-X' });
});

test('validarHorario: dia, formato, ordem e duração, nessa ordem', () => {
  const ok = { unit_id: 'u', weekday: 1, start_time: '08:00', end_time: '12:00' };
  assert.deepEqual(V.validarHorario(ok).dados, { unitId: 'u', weekday: 1, start: '08:00:00', end: '12:00:00', slot: 30 });
  assert.equal(V.validarHorario({ ...ok, unit_id: '' }).error, 'Selecione a unidade.');
  for (const w of [-1, 7, 1.5, 'x', undefined]) assert.match(V.validarHorario({ ...ok, weekday: w }).error, /Dia da semana inválido/, String(w));
  assert.equal(V.validarHorario({ ...ok, weekday: 0 }).ok, true, 'domingo é 0');
  assert.equal(V.validarHorario({ ...ok, start_time: '99:99' }).error, 'Horários no formato HH:MM.');
  assert.equal(V.validarHorario({ ...ok, start_time: '12:00', end_time: '12:00' }).error, 'O horário final deve ser depois do inicial.');
  assert.equal(V.validarHorario({ ...ok, slot_minutes: 4 }).error, 'Duração do atendimento entre 5 e 240 minutos.');
  assert.equal(V.validarHorario({ ...ok, slot_minutes: 241 }).error, 'Duração do atendimento entre 5 e 240 minutos.');
  assert.equal(V.validarHorario({ ...ok, slot_minutes: 45 }).dados.slot, 45);
  assert.equal(V.validarHorario({ ...ok, slot_minutes: 0 }).dados.slot, 30, 'zero/ausente usa 30');
});

test('validarBloqueio: aceita T ou espaço, exige início < fim', () => {
  const ok = { unit_id: 'u', starts_at: '2027-05-04T08:00', ends_at: '2027-05-04 12:00:00' };
  assert.deepEqual(V.validarBloqueio(ok).dados, { unitId: 'u', start: '2027-05-04 08:00', end: '2027-05-04 12:00:00' });
  assert.equal(V.validarBloqueio({ ...ok, unit_id: null }).error, 'Selecione a unidade.');
  assert.equal(V.validarBloqueio({ ...ok, ends_at: 'amanhã' }).error, 'Informe início e fim do bloqueio.');
  assert.equal(V.validarBloqueio({ ...ok, ends_at: ok.starts_at }).error, 'O fim do bloqueio deve ser depois do início.');
});

// ---------------------------------------------------------------------------
// serviço (banco real)
// ---------------------------------------------------------------------------

test('criarProfissional: grava, devolve entidade e linha de auditoria com o motivo', async () => {
  assert.deepEqual(await svc.criarProfissional({ name: '' }, ''), { ok: false, status: 400, error: 'Nome do profissional é obrigatório.' });
  const r = await svc.criarProfissional({ name: '  Dra. Carla ', job_title: 'Pediatra', registry: 'CRM 9' }, 'novo concurso');
  PROFS.push(r.id);
  assert.equal(r.entidade, 'professional');
  assert.equal(r.auditoria, 'profissional "Dra. Carla"; motivo: novo concurso');
  const [[row]] = await pool.query('SELECT name, job_title, registry, active FROM professionals WHERE id = ?', [r.id]);
  assert.deepEqual([row.name, row.job_title, row.registry, Number(row.active)], ['Dra. Carla', 'Pediatra', 'CRM 9', 1]);
});

test('listar: traz o profissional com ofertas, horários e só os bloqueios que ainda valem', async () => {
  const id = await novo('Zé Lista');
  await svc.adicionarVinculo(id, { unit_id: unit, kind: 'consulta', name: 'Clínica Lista' }, '');
  await svc.adicionarHorario(id, { unit_id: unit, weekday: 2, start_time: '08:00', end_time: '12:00' }, '');
  await svc.adicionarBloqueio(id, { unit_id: unit, starts_at: '2020-01-01 08:00', ends_at: '2020-01-01 09:00' }, ''); // passado
  await svc.adicionarBloqueio(id, { unit_id: unit, starts_at: '2099-01-01 08:00', ends_at: '2099-01-01 09:00' }, 'futuro');
  const r = await svc.listar();
  assert.ok(r.professionals.some((p) => p.id === id));
  assert.equal(r.offers.filter((o) => o.professional_id === id).length, 1);
  assert.equal(r.schedules.filter((s) => s.professional_id === id).length, 1);
  const blocos = r.blocks.filter((b) => b.professional_id === id);
  assert.equal(blocos.length, 1, 'o bloqueio já vencido não aparece');
  assert.equal(blocos[0].reason, 'futuro');
  assert.equal(blocos[0].unit_name, 'UBS Prof A');
});

test('adicionarVinculo: 400 → 404 → 409 duplicata (sem auditar) e sucesso com nome da unidade', async () => {
  const id = await novo();
  const corpo = { unit_id: unit, kind: 'consulta', name: ' Cardiologia ' };
  assert.equal((await svc.adicionarVinculo(id, { ...corpo, kind: 'x' }, '')).status, 400);
  assert.deepEqual(await svc.adicionarVinculo(uid(), corpo, ''), { ok: false, status: 404, error: 'Profissional não encontrado.' });
  assert.deepEqual(await svc.adicionarVinculo(id, { ...corpo, unit_id: uid() }, ''), { ok: false, status: 404, error: 'Unidade não encontrada.' });

  const ok = await svc.adicionarVinculo(id, corpo, 'cobertura');
  assert.equal(ok.ok, true);
  assert.equal(ok.entidade, 'professional_offer');
  assert.equal(ok.auditoria, 'vínculo: Cardiologia (consulta) em UBS Prof A; motivo: cobertura');
  const dup = await svc.adicionarVinculo(id, corpo, '');
  assert.deepEqual([dup.ok, dup.status, dup.error], [false, 409, 'Este vínculo já existe para este profissional nesta unidade.']);
  assert.equal((await pool.query('SELECT 1 FROM professional_offers WHERE professional_id = ?', [id]))[0].length, 1, 'a duplicata não criou linha');
});

test('removerVinculo: só remove o vínculo DO profissional informado', async () => {
  const dono = await novo();
  const outro = await novo();
  const v = await svc.adicionarVinculo(dono, { unit_id: unit, kind: 'exame', name: 'Hemograma' }, '');
  assert.deepEqual(await svc.removerVinculo(outro, v.id, ''), { ok: false, status: 404, error: 'Vínculo não encontrado.' });
  assert.equal((await pool.query('SELECT 1 FROM professional_offers WHERE id = ?', [v.id]))[0].length, 1, 'não removeu de quem não é o dono');
  const r = await svc.removerVinculo(dono, v.id, 'saiu');
  assert.equal(r.ok, true);
  assert.equal(r.auditoria, 'vínculo removido: Hemograma (exame) em UBS Prof A; motivo: saiu');
  assert.equal((await pool.query('SELECT 1 FROM professional_offers WHERE id = ?', [v.id]))[0].length, 0);
});

test('adicionarHorario / removerHorario: duplicata 409, trilha legível, remoção só do dono', async () => {
  const id = await novo();
  const outro = await novo();
  const corpo = { unit_id: unit, weekday: 3, start_time: '08:00', end_time: '12:00', slot_minutes: 20 };
  assert.equal((await svc.adicionarHorario(id, { ...corpo, weekday: 9 }, '')).status, 400);
  assert.equal((await svc.adicionarHorario(uid(), corpo, '')).status, 404);

  const ok = await svc.adicionarHorario(id, corpo, '');
  assert.equal(ok.auditoria, 'quarta 08:00-12:00 (20 min) em UBS Prof A');
  assert.deepEqual((await svc.adicionarHorario(id, corpo, '')).status, 409);
  const [[linha]] = await pool.query('SELECT start_time, slot_minutes FROM work_schedules WHERE id = ?', [ok.id]);
  assert.deepEqual([linha.start_time, Number(linha.slot_minutes)], ['08:00:00', 20]);

  assert.equal((await svc.removerHorario(outro, ok.id, '')).status, 404);
  const rem = await svc.removerHorario(id, ok.id, 'mudou a escala');
  assert.equal(rem.auditoria, 'horário de atendimento removido; motivo: mudou a escala');
  assert.equal((await svc.removerHorario(id, ok.id, '')).status, 404, 'já removido');
});

test('rotuloDaUnidade: nome da unidade, ou um texto que explica quando falta', async () => {
  const r = await require('../src/repositories/profissionais').rotuloDaUnidade(pool, uid());
  assert.match(r, /^unidade [0-9a-f-]{36}$/);
  assert.equal(await require('../src/repositories/profissionais').rotuloDaUnidade(pool, null), 'unidade não informada');
});

test('adicionarBloqueio / removerBloqueio: grava com motivo, normaliza T, remoção só do dono', async () => {
  const id = await novo();
  const outro = await novo();
  assert.equal((await svc.adicionarBloqueio(id, { unit_id: unit }, '')).status, 400);
  assert.equal((await svc.adicionarBloqueio(uid(), { unit_id: unit, starts_at: '2099-02-01T08:00', ends_at: '2099-02-01T09:00' }, '')).status, 404);

  const ok = await svc.adicionarBloqueio(id, { unit_id: unit2, starts_at: '2099-02-01T08:00', ends_at: '2099-02-01T09:30' }, 'consulta médica');
  assert.equal(ok.auditoria, 'bloqueio de 2099-02-01 08:00 a 2099-02-01 09:30 em UBS Prof B; motivo: consulta médica');
  const [[b]] = await pool.query('SELECT reason, unit_id FROM schedule_blocks WHERE id = ?', [ok.id]);
  assert.deepEqual([b.reason, b.unit_id], ['consulta médica', unit2]);

  assert.equal((await svc.removerBloqueio(outro, ok.id, '')).status, 404);
  assert.equal((await svc.removerBloqueio(id, ok.id, '')).auditoria, 'bloqueio removido');
  assert.equal((await pool.query('SELECT 1 FROM schedule_blocks WHERE id = ?', [ok.id]))[0].length, 0);
});

test('a rota fica fina: sem SQL de oferta, horário ou bloqueio, e sem cleanTime próprio', () => {
  const fonte = require('node:fs').readFileSync(path.join(SERVER, 'src', 'routes', 'admin.professionals.routes.js'), 'utf8');
  for (const tabela of ['professional_offers', 'work_schedules', 'schedule_blocks']) {
    assert.ok(!fonte.includes(tabela), `a rota não deveria conhecer ${tabela}`);
  }
  assert.doesNotMatch(fonte, /function cleanTime/);
});

// ---------------------------------------------------------------------------
// Edição e desativação (8d)
// ---------------------------------------------------------------------------

async function paciente() {
  const id = uid();
  await pool.query("INSERT INTO users (id, full_name, email, password_hash, role) VALUES (?,?,?,?, 'paciente')", [id, 'Paciente Desativ', `desat-${id}@test.local`, 'x'.repeat(60)]);
  USUARIOS.push(id);
  return id;
}
async function atendimento(tabela, { user, prof, dias, status = 'pendente' }) {
  const id = uid();
  const col = tabela === 'appointments' ? 'specialty' : 'exam_type';
  await pool.query(
    `INSERT INTO ${tabela} (id, user_id, ${col}, location, unit_id, professional_id, scheduled_at, status)
     VALUES (?,?,?,?,?,?, DATE_ADD(NOW(), INTERVAL ? DAY), ?)`,
    [id, user, 'Clínica Teste', 'UBS', unit, prof, dias, status]
  );
  return id;
}
const estado = async (tabela, id) => (await pool.query(`SELECT status, reschedule_reason FROM ${tabela} WHERE id = ?`, [id]))[0][0];
const ativo = async (id) => Number((await pool.query('SELECT active FROM professionals WHERE id = ?', [id]))[0][0].active);

test('atualizarProfissional: 404, nome vazio, nada a atualizar', async () => {
  const id = await novo('Nome Fixo');
  assert.deepEqual(await svc.atualizarProfissional({ id: uid(), body: { name: 'x' }, reason: '', actorId: null }), { ok: false, status: 404, error: 'Profissional não encontrado.' });
  assert.deepEqual(await svc.atualizarProfissional({ id, body: { name: '   ' }, reason: '', actorId: null }), { ok: false, status: 400, error: 'Nome do profissional é obrigatório.' });
  assert.deepEqual(await svc.atualizarProfissional({ id, body: {}, reason: '', actorId: null }), { ok: false, status: 400, error: 'Nada para atualizar.' });
  assert.deepEqual(await svc.atualizarProfissional({ id, body: { name: 'Nome Fixo' }, reason: '', actorId: null }), { ok: false, status: 400, error: 'Nada para atualizar.' }, 'mesmo nome não é mudança');
});

test('atualizarProfissional: grava os campos e descreve a mudança com o motivo', async () => {
  const id = await novo('Antes');
  const r = await svc.atualizarProfissional({ id, body: { name: ' Depois ', job_title: 'Clínico', registry: '' }, reason: 'correção', actorId: null });
  assert.equal(r.ok, true);
  assert.equal(r.moved, 0);
  assert.equal(r.auditoria, 'nome -> Depois; cargo -> Clínico; registro -> não informado; motivo: correção');
  const [[row]] = await pool.query('SELECT name, job_title, registry FROM professionals WHERE id = ?', [id]);
  assert.deepEqual([row.name, row.job_title, row.registry], ['Depois', 'Clínico', null]);
});

test('desativar move SÓ os atendimentos futuros e ativos (consultas e exames), com evento e motivo', async () => {
  const prof = await novo();
  const user = await paciente();
  const futuraConsulta = await atendimento('appointments', { user, prof, dias: 10 });
  const futuraConfirmada = await atendimento('appointments', { user, prof, dias: 11, status: 'confirmado' });
  const futuroExame = await atendimento('exams', { user, prof, dias: 12 });
  const passada = await atendimento('appointments', { user, prof, dias: -10 });
  const cancelada = await atendimento('appointments', { user, prof, dias: 13, status: 'cancelado' });
  const doOutro = await atendimento('appointments', { user, prof: await novo(), dias: 10 });

  const r = await svc.atualizarProfissional({ id: prof, body: { active: 0 }, reason: 'saiu da unidade', actorId: null });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.moved, 3);
  assert.deepEqual(r.userIds, [user], 'um paciente, avisado uma vez só');
  assert.equal(r.auditoria, 'profissional desativado; 3 registro(s) movido(s) para remarcar; motivo: saiu da unidade');
  assert.equal(await ativo(prof), 0);

  for (const [tabela, id] of [['appointments', futuraConsulta], ['appointments', futuraConfirmada], ['exams', futuroExame]]) {
    assert.deepEqual(await estado(tabela, id), { status: 'para_remarcar', reschedule_reason: 'profissional_inativado' }, id);
  }
  assert.equal((await estado('appointments', passada)).status, 'pendente', 'passado não é tocado');
  assert.equal((await estado('appointments', cancelada)).status, 'cancelado');
  assert.equal((await estado('appointments', doOutro)).status, 'pendente', 'outro profissional não é tocado');

  const eventos = await listarEventos(pool, { kind: 'consulta', bookingId: futuraConsulta });
  assert.ok(eventos.some((e) => e.event_type === 'professional_deactivated' && e.reason === 'profissional_inativado'));
  const eventosExame = await listarEventos(pool, { kind: 'exame', bookingId: futuroExame });
  assert.ok(eventosExame.some((e) => e.event_type === 'professional_deactivated'));
});

test('desativar é ATÔMICO: se o registro do evento falha, nada muda (profissional segue ativo, atendimento intacto)', async () => {
  const prof = await novo();
  const user = await paciente();
  const consulta = await atendimento('appointments', { user, prof, dias: 20 });
  // actor inexistente → a FK de booking_events recusa o evento no meio da operação
  await assert.rejects(svc.atualizarProfissional({ id: prof, body: { active: 0, name: 'Mudou' }, reason: '', actorId: uid() }));
  assert.equal(await ativo(prof), 1, 'o UPDATE do cadastro foi desfeito');
  assert.equal((await pool.query('SELECT name FROM professionals WHERE id = ?', [prof]))[0][0].name !== 'Mudou', true);
  assert.equal((await estado('appointments', consulta)).status, 'pendente', 'o atendimento voltou ao que era');
});

test('reativar e editar sem desativar NÃO movem atendimento algum', async () => {
  const prof = await novo();
  const user = await paciente();
  const consulta = await atendimento('appointments', { user, prof, dias: 9 });
  await svc.atualizarProfissional({ id: prof, body: { active: 0 }, reason: '', actorId: null });
  await pool.query("UPDATE appointments SET status = 'pendente', reschedule_reason = NULL WHERE id = ?", [consulta]);
  const r = await svc.atualizarProfissional({ id: prof, body: { active: 1, job_title: 'Voltou' }, reason: '', actorId: null });
  assert.deepEqual([r.ok, r.moved, r.userIds], [true, 0, []]);
  assert.equal(r.auditoria, 'cargo -> Voltou; profissional ativado');
  assert.equal((await estado('appointments', consulta)).status, 'pendente');
  const mesmo = await svc.atualizarProfissional({ id: prof, body: { active: 1 }, reason: '', actorId: null });
  assert.equal(mesmo.status, 400, 'ativar quem já está ativo não é mudança');
});

test('avisarPacientes: um e-mail por paciente com endereço; falha de envio não interrompe os demais', async () => {
  const a = await paciente();
  const b = await paciente();
  const enviados = [];
  const original = mailer.enviar;
  mailer.enviar = async (msg) => {
    enviados.push(msg.para);
    if (msg.para.includes(a)) throw new Error('SMTP caiu');
    return { enviado: true };
  };
  try {
    await svc.avisarPacientes([a, b, uid()]); // o terceiro não existe
    await svc.avisarPacientes([]); // nada a fazer
  } finally {
    mailer.enviar = original;
  }
  assert.equal(enviados.length, 2);
  assert.ok(enviados.some((e) => e.includes(b)), 'o segundo foi avisado mesmo com o primeiro falhando');
});

test('a rota de profissionais ficou só com validar-permissão, chamar o serviço e responder', () => {
  const fonte = require('node:fs').readFileSync(path.join(SERVER, 'src', 'routes', 'admin.professionals.routes.js'), 'utf8');
  assert.doesNotMatch(fonte, /require\('\.\.\/db'\)/, 'a rota não acessa o banco');
  assert.doesNotMatch(fonte, /registrarEvento|mailer|pool\./, 'eventos e e-mails são do serviço');
});
