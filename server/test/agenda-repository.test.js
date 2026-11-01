/**
 * repositories/agenda.js (A1, passo 7b): as leituras da agenda isoladas.
 * As regras que as usam seguem cobertas por catalog-*, booking-*, priority-* e service-duration.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

const SERVER = path.resolve(__dirname, '..');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const pool = require('../src/db');
const repo = require('../src/repositories/agenda');

const uid = () => crypto.randomUUID();
const ids = { user: uid(), user2: uid(), unit: uid(), unit2: uid(), prof: uid(), prof2: uid(), profInativo: uid() };
const DIA = '2027-05-04'; // terça

test.before(async () => {
  for (const [id, mail] of [[ids.user, 'a'], [ids.user2, 'b']]) {
    await pool.query(
      "INSERT INTO users (id, full_name, email, password_hash, role, priority) VALUES (?,?,?,?, 'paciente', ?)",
      [id, `Repo ${mail}`, `repo-${id}@test.local`, 'x'.repeat(60), mail === 'a' ? 'idoso' : null]
    );
  }
  await pool.query("INSERT INTO health_units (id, name, type, active) VALUES (?, 'UBS Repo A', 'ubs', 1), (?, 'UBS Repo B', 'ubs', 0)", [ids.unit, ids.unit2]);
  await pool.query("INSERT INTO professionals (id, name, job_title, active) VALUES (?, 'Ana Repo', 'Médica', 1), (?, 'Beto Repo', 'Médico', 1), (?, 'Cida Repo', 'Médica', 0)",
    [ids.prof, ids.prof2, ids.profInativo]);
  await pool.query("INSERT INTO unit_offers (id, unit_id, kind, name, active, duration_minutes) VALUES (?,?, 'consulta', 'Clínica Repo', 1, 45)", [uid(), ids.unit]);
  await pool.query("INSERT INTO unit_offers (id, unit_id, kind, name, active) VALUES (?,?, 'consulta', 'Pediatria Repo', 0)", [uid(), ids.unit]);
  await pool.query("INSERT INTO professional_offers (id, professional_id, unit_id, kind, name) VALUES (?,?,?, 'consulta', 'Clínica Repo'), (?,?,?, 'consulta', 'Clínica Repo')",
    [uid(), ids.prof, ids.unit, uid(), ids.prof2, ids.unit]);
  await pool.query("INSERT INTO work_schedules (id, professional_id, unit_id, weekday, start_time, end_time, slot_minutes, active) VALUES (?,?,?, 2, '08:00:00', '12:00:00', 30, 1), (?,?,?, 3, '13:00:00', '17:00:00', 20, 1), (?,?,?, 2, '14:00:00', '15:00:00', 30, 0)",
    [uid(), ids.prof, ids.unit, uid(), ids.prof, ids.unit, uid(), ids.prof, ids.unit]);
});

test.after(async () => {
  await pool.query('DELETE FROM schedule_blocks WHERE professional_id IN (?,?)', [ids.prof, ids.prof2]).catch(() => {});
  await pool.query('DELETE FROM appointments WHERE user_id IN (?,?)', [ids.user, ids.user2]).catch(() => {});
  await pool.query('DELETE FROM exams WHERE user_id IN (?,?)', [ids.user, ids.user2]).catch(() => {});
  await pool.query('DELETE FROM work_schedules WHERE professional_id IN (?,?)', [ids.prof, ids.prof2]).catch(() => {});
  await pool.query('DELETE FROM professional_offers WHERE professional_id IN (?,?,?)', [ids.prof, ids.prof2, ids.profInativo]).catch(() => {});
  await pool.query('DELETE FROM unit_offers WHERE unit_id IN (?,?)', [ids.unit, ids.unit2]).catch(() => {});
  await pool.query('DELETE FROM professionals WHERE id IN (?,?,?)', [ids.prof, ids.prof2, ids.profInativo]).catch(() => {});
  await pool.query('DELETE FROM health_units WHERE id IN (?,?)', [ids.unit, ids.unit2]).catch(() => {});
  await pool.query('DELETE FROM users WHERE id IN (?,?)', [ids.user, ids.user2]).catch(() => {});
  await pool.end().catch(() => {});
});

async function atendimento(tabela, { user = ids.user, prof = ids.prof, quando, status = 'pendente', dur = 30 }) {
  const id = uid();
  const col = tabela === 'appointments' ? 'specialty' : 'exam_type';
  await pool.query(
    `INSERT INTO ${tabela} (id, user_id, ${col}, location, unit_id, professional_id, scheduled_at, status, duration_minutes) VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, user, 'Clínica Repo', 'UBS', ids.unit, prof, quando, status, dur]
  );
  return id;
}
const ms = (s) => new Date(s.replace(' ', 'T')).getTime();

test('prioridadeDoUsuario / unidadePorId / profissionalPorId', async () => {
  assert.equal(await repo.prioridadeDoUsuario(pool, ids.user), 'idoso');
  assert.equal(await repo.prioridadeDoUsuario(pool, ids.user2), null);
  assert.equal(await repo.prioridadeDoUsuario(pool, null), null);
  assert.equal(await repo.prioridadeDoUsuario(pool, uid()), null);
  assert.equal(Number((await repo.unidadePorId(pool, ids.unit)).active), 1);
  assert.equal(Number((await repo.unidadePorId(pool, ids.unit2)).active), 0);
  assert.equal(await repo.unidadePorId(pool, uid()), undefined);
  assert.equal(Number((await repo.profissionalPorId(pool, ids.profInativo)).active), 0);
  assert.equal(await repo.profissionalPorId(pool, uid()), undefined);
});

test('ofertas e vínculos: só serviço ATIVO da unidade; vínculo por profissional+unidade+serviço', async () => {
  assert.equal(await repo.unidadeOfereceServico(pool, { unitId: ids.unit, tipo: 'consulta', serviceName: 'Clínica Repo' }), true);
  assert.equal(await repo.unidadeOfereceServico(pool, { unitId: ids.unit, tipo: 'consulta', serviceName: 'Pediatria Repo' }), false, 'inativo');
  assert.equal(await repo.unidadeOfereceServico(pool, { unitId: ids.unit, tipo: 'exame', serviceName: 'Clínica Repo' }), false, 'outro tipo');
  assert.equal(await repo.unidadeOfereceServico(pool, { unitId: ids.unit, tipo: 'consulta', serviceName: undefined }), false);

  assert.equal(await repo.profissionalAtendeServico(pool, { professionalId: ids.prof, unitId: ids.unit, tipo: 'consulta', serviceName: 'Clínica Repo' }), true);
  assert.equal(await repo.profissionalAtendeServico(pool, { professionalId: ids.prof, unitId: ids.unit2, tipo: 'consulta', serviceName: 'Clínica Repo' }), false, 'outra unidade');
  assert.equal(await repo.profissionalAtendeServico(pool, { professionalId: ids.profInativo, unitId: ids.unit, tipo: 'consulta', serviceName: 'Clínica Repo' }), false);

  assert.equal(await repo.duracaoDaOferta(pool, { unitId: ids.unit, serviceName: 'Clínica Repo', tipo: 'consulta' }), 45);
  assert.equal(await repo.duracaoDaOferta(pool, { unitId: ids.unit, serviceName: 'Pediatria Repo', tipo: 'consulta' }), null, 'inativa');
  assert.equal(await repo.duracaoDaOferta(pool, { unitId: ids.unit, serviceName: 'Não existe', tipo: 'consulta' }), null);
});

test('agendas: só as ATIVAS; por dia da semana e a semana inteira', async () => {
  const terca = await repo.agendasDoDia(pool, ids.prof, ids.unit, 2);
  assert.equal(terca.length, 1, 'a agenda inativa de terça não conta');
  assert.equal(terca[0].start_time, '08:00:00');
  assert.equal((await repo.agendasDoDia(pool, ids.prof, ids.unit, 0)).length, 0);
  const semana = await repo.agendasDaSemana(pool, ids.prof, ids.unit);
  assert.deepEqual(semana.map((s) => s.weekday).sort(), [2, 3]);
  assert.equal((await repo.agendasDaSemana(pool, ids.prof2, ids.unit)).length, 0);
});

test('intervalosOcupados: consultas e exames ativos + bloqueios; ignora cancelados e o excluído', async () => {
  const c1 = await atendimento('appointments', { quando: `${DIA} 08:00:00`, dur: 30 });
  await atendimento('exams', { quando: `${DIA} 09:00:00`, dur: 60 });
  await atendimento('appointments', { quando: `${DIA} 10:00:00`, status: 'cancelado' });
  await atendimento('appointments', { quando: `${DIA} 11:00:00`, status: 'para_remarcar' });
  await atendimento('appointments', { quando: `${DIA} 12:00:00`, prof: ids.prof2 }); // outro profissional
  await pool.query('INSERT INTO schedule_blocks (id, professional_id, unit_id, starts_at, ends_at) VALUES (?,?,?,?,?)',
    [uid(), ids.prof, ids.unit, `${DIA} 14:00:00`, `${DIA} 16:00:00`]);

  const todos = await repo.intervalosOcupados(pool, ids.prof, DIA, DIA);
  assert.deepEqual(todos.map((i) => [i.start, i.end]).sort((a, b) => a[0] - b[0]), [
    [ms(`${DIA} 08:00:00`), ms(`${DIA} 08:30:00`)],
    [ms(`${DIA} 09:00:00`), ms(`${DIA} 10:00:00`)],
    [ms(`${DIA} 14:00:00`), ms(`${DIA} 16:00:00`)],
  ]);
  const sem = await repo.intervalosOcupados(pool, ids.prof, DIA, DIA, c1);
  assert.equal(sem.length, 2, 'o registro em edição não conta contra ele mesmo');
  assert.equal((await repo.intervalosOcupados(pool, ids.prof, '2027-05-05', '2027-05-06')).length, 0, 'fora do intervalo');
});

test('intervalosOcupadosEmLote: agrupa por profissional e bate com a versão individual', async () => {
  const lote = await repo.intervalosOcupadosEmLote(pool, [ids.prof, ids.prof2, ids.prof, null], DIA, DIA);
  const sort = (arr) => arr.map((i) => [i.start, i.end]).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(sort(lote.get(ids.prof)), sort(await repo.intervalosOcupados(pool, ids.prof, DIA, DIA)));
  assert.deepEqual(sort(lote.get(ids.prof2)), sort(await repo.intervalosOcupados(pool, ids.prof2, DIA, DIA)));
  assert.equal((await repo.intervalosOcupadosEmLote(pool, [], DIA, DIA)).size, 0);
  assert.equal((await repo.intervalosOcupadosEmLote(pool, null, DIA, DIA)).size, 0);
});

test('intervalosOcupadosDoUsuario: atendimentos ativos do usuário em consultas e exames', async () => {
  const dia = '2027-05-10';
  const a = await atendimento('appointments', { user: ids.user2, prof: ids.prof, quando: `${dia} 08:00:00`, dur: 45 });
  await atendimento('exams', { user: ids.user2, prof: ids.prof2, quando: `${dia} 09:30:00`, dur: 30 });
  await atendimento('appointments', { user: ids.user2, prof: ids.prof, quando: `${dia} 11:00:00`, status: 'cancelado' });
  const r = await repo.intervalosOcupadosDoUsuario(pool, ids.user2, dia, dia);
  assert.deepEqual(r.map((i) => i.end - i.start).sort(), [30 * 60000, 45 * 60000]);
  assert.equal((await repo.intervalosOcupadosDoUsuario(pool, ids.user2, dia, dia, a)).length, 1);
  assert.equal((await repo.intervalosOcupadosDoUsuario(pool, ids.user, dia, dia)).length, 0, 'outro usuário');
});

test('catálogo: unidades, durações, profissionais e agendas por vínculo', async () => {
  const unidades = await repo.unidadesQueOferecem(pool, { tipo: 'consulta', servico: 'Clínica Repo' });
  assert.deepEqual(unidades.map((u) => u.id), [ids.unit], 'só unidade ativa que oferece');

  const duracoes = await repo.duracoesDoServicoPorUnidade(pool, { tipo: 'consulta', servico: 'Clínica Repo', unitIds: [ids.unit, ids.unit2] });
  assert.deepEqual([...duracoes], [[ids.unit, 45]]);

  const profs = await repo.profissionaisDoServico(pool, { tipo: 'consulta', servico: 'Clínica Repo', unitIds: [ids.unit] });
  assert.deepEqual(profs.map((p) => p.professional_name), ['Ana Repo', 'Beto Repo'], 'ordem alfabética, só ativos');

  const agendas = await repo.agendasDosVinculos(pool, { tipo: 'consulta', servico: 'Clínica Repo' });
  const minhas = agendas.filter((a) => a.professional_id === ids.prof);
  assert.equal(minhas.length, 2, 'duas agendas ativas da Ana (a inativa fica de fora)');
  assert.ok(agendas.every((a) => a.professional_id !== ids.prof2), 'Beto tem vínculo mas nenhuma agenda');

  // agenda de um par SEM vínculo com o serviço não vira vaga
  await pool.query("INSERT INTO work_schedules (id, professional_id, unit_id, weekday, start_time, end_time, slot_minutes, active) VALUES (?,?,?, 4, '08:00:00', '09:00:00', 30, 1)", [uid(), ids.prof, ids.unit2]);
  const depois = await repo.agendasDosVinculos(pool, { tipo: 'consulta', servico: 'Clínica Repo' });
  assert.ok(!depois.some((a) => a.unit_id === ids.unit2), 'a agenda em outra unidade não atende o serviço lá');
});

test('travarEnvolvidos: mesma ordem (por id) para qualquer chamador, só o que existe', async () => {
  const consultas = [];
  const falso = { query: async (sql, params) => { consultas.push([sql, params[0]]); return [[]]; } };
  const a = '00000000-0000-4000-8000-000000000001';
  const b = 'ffffffff-0000-4000-8000-000000000002';

  await repo.travarEnvolvidos(falso, { userId: b, professionalId: a });
  await repo.travarEnvolvidos(falso, { userId: a, professionalId: b });
  assert.deepEqual(consultas.slice(0, 2).map((c) => c[1]), [a, b], 'profissional a (id menor) trava primeiro');
  assert.deepEqual(consultas.slice(2, 4).map((c) => c[1]), [a, b], 'usuário a (id menor) trava primeiro');
  assert.ok(consultas.every(([sql]) => /FOR UPDATE$/.test(sql)));
  assert.match(consultas[0][0], /professionals/);
  assert.match(consultas[2][0], /users/);

  consultas.length = 0;
  await repo.travarEnvolvidos(falso, { userId: a, professionalId: null });
  assert.equal(consultas.length, 1);
  await repo.travarEnvolvidos(falso, {});
  assert.equal(consultas.length, 1, 'sem ninguém, não trava nada');

  consultas.length = 0;
  await repo.travarEnvolvidos(falso, { userId: a, professionalId: a }); // mesmo id: tabela desempata
  assert.deepEqual(consultas.map((c) => /professionals/.test(c[0]) ? 'p' : 'u'), ['p', 'u']);
});

test('booking.js reexporta as leituras do repositório (mesma função, não cópia)', () => {
  const booking = require('../src/utils/booking');
  assert.equal(booking.prioridadeDoUsuario, repo.prioridadeDoUsuario);
  assert.equal(booking.lockBookingActors, repo.travarEnvolvidos);
  const fonte = require('node:fs').readFileSync(path.join(SERVER, 'src', 'utils', 'booking.js'), 'utf8');
  const leituras = fonte.match(/pool\.query\(/g) || [];
  assert.equal(leituras.length, 0, 'booking.js não faz mais SELECT por conta própria (o UPDATE do applyBookingChange usa a conexão c)');
});
