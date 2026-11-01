/**
 * Núcleo puro do agendamento (A1, passo 7a): tempo, prioridade e geração de horários
 * livres. Nenhum destes testes toca em banco.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const T = require('../src/utils/booking-time');
const P = require('../src/utils/booking-priority');
const { gerarSlotsDoDia, MARGEM_HOJE_MS } = require('../src/utils/booking-slots');

const HORA = 3600000;
const dia = (y, m, d) => new Date(y, m - 1, d);
const em = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const horas = (r) => r.map((s) => s.hora);

// ---------------------------------------------------------------------------
// booking-time
// ---------------------------------------------------------------------------

test('parseDateTime aceita "AAAA-MM-DD HH:mm[:ss]" com espaço ou T e recusa o resto', () => {
  assert.ok(T.parseDateTime('2027-03-01 08:00'));
  assert.ok(T.parseDateTime('2027-03-01T08:00:30'));
  for (const v of [null, undefined, 123, '', '2027-03-01', '01/03/2027 08:00', '2027-02-30 08:00 x', '2027-13-01 08:00']) {
    assert.equal(T.parseDateTime(v), null, String(v));
  }
});

test('toMinutes / horaDeMinutos / pad', () => {
  assert.equal(T.toMinutes('08:30:00'), 510);
  assert.equal(T.toMinutes('08:30'), 510);
  assert.equal(T.toMinutes('8'), null);
  assert.equal(T.toMinutes(null), null);
  assert.equal(T.horaDeMinutos(510), '08:30');
  assert.equal(T.horaDeMinutos(0), '00:00');
  assert.equal(T.pad(7), '07');
});

test('overlaps: intervalos que apenas se tocam NÃO se sobrepõem', () => {
  assert.equal(T.overlaps(0, 10, 10, 20), false);
  assert.equal(T.overlaps(10, 20, 0, 10), false);
  assert.equal(T.overlaps(0, 11, 10, 20), true);
  assert.equal(T.overlaps(5, 6, 0, 100), true);
});

test('duracaoDe: usa a gravada; ausente, zero ou inválida cai nos 30 min do legado', () => {
  assert.equal(T.duracaoDe({ duration_minutes: 45 }), 45);
  for (const v of [null, undefined, 0, -5, 'abc']) assert.equal(T.duracaoDe({ duration_minutes: v }), T.DURACAO_PADRAO);
  assert.equal(T.DURACAO_PADRAO, 30);
});

test('validateScheduleWindow: passado, futuro além de 1 ano e formato inválido', () => {
  const f = (ms) => {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  assert.equal(T.validateScheduleWindow('lixo'), 'Informe uma data e horário válidos.');
  assert.equal(T.validateScheduleWindow(f(Date.now() - 2 * HORA)), 'Não é permitido agendar em data passada.');
  assert.match(T.validateScheduleWindow(f(Date.now() + 400 * 24 * HORA)), /mais de 1 ano/);
  assert.equal(T.validateScheduleWindow(f(Date.now() + 5 * 24 * HORA)), null);
});

test('resolveAvailabilityWindow: teto de 30 dias e deslocamento dentro do ano', () => {
  assert.deepEqual(T.resolveAvailabilityWindow(), { days: 30, offsetDays: 0 });
  assert.deepEqual(T.resolveAvailabilityWindow({ days: 999, offsetDays: -3 }), { days: 30, offsetDays: 0 });
  assert.deepEqual(T.resolveAvailabilityWindow({ days: 0 }), { days: 1, offsetDays: 0 });
  assert.equal(T.resolveAvailabilityWindow({ days: 30, offsetDays: 99999 }).offsetDays, T.MAX_DAYS_AHEAD - 30);
});

test('schedulePara: casa na grade, respeita o fim e a duração do serviço; a primeira agenda que casa vence', () => {
  const agendas = [{ start_time: '08:00:00', end_time: '12:00:00', slot_minutes: 30 }];
  const quando = (h, m) => new Date(2027, 2, 1, h, m);
  assert.deepEqual(T.schedulePara(agendas, quando(8, 0), null), { slot: 30, duration: 30, start: 480, end: 720 });
  assert.equal(T.schedulePara(agendas, quando(8, 15), null), null, 'fora da grade de 30 min');
  assert.equal(T.schedulePara(agendas, quando(12, 0), null), null, 'no fim, não cabe');
  assert.equal(T.schedulePara(agendas, quando(11, 30), 60), null, 'serviço de 60 min não cabe nos últimos 30');
  assert.equal(T.schedulePara(agendas, quando(11, 0), 60).duration, 60, 'duração do serviço vence o slot');
  const duas = [
    { start_time: '08:00', end_time: '10:00', slot_minutes: 30 },
    { start_time: '08:00', end_time: '10:00', slot_minutes: 20 },
  ];
  assert.equal(T.schedulePara(duas, quando(8, 0), null).slot, 30);
  assert.equal(T.schedulePara(duas, quando(8, 20), null).slot, 20);
  assert.equal(T.schedulePara([{ start_time: null, end_time: null }], quando(8, 0), null), null);
});

// ---------------------------------------------------------------------------
// booking-priority
// ---------------------------------------------------------------------------

test('prioridade: grupos, cota de 10% com piso 1 e reserva nas PRIMEIRAS vagas', () => {
  for (const g of ['idoso', 'gestante', 'pcd', 'lactante']) assert.equal(P.isPriorityUser(g), true);
  for (const g of ['nenhuma', '', null, undefined, 'vip']) assert.equal(P.isPriorityUser(g), false);
  assert.equal(P.quotaPrioritaria(0), 0);
  assert.equal(P.quotaPrioritaria(3), 1);
  assert.equal(P.quotaPrioritaria(10), 1);
  assert.equal(P.quotaPrioritaria(11), 2);
  assert.equal(P.quotaPrioritaria(40), 4);
  const regras = [{ start: 480, end: 600, slot: 30 }]; // 08:00..10:00 => 4 vagas
  assert.deepEqual(P.gradeDoDia(regras), [480, 510, 540, 570]);
  assert.deepEqual([...P.reservasDoDia(regras)], [480]);
});

test('prioridade: agendas sobrepostas não contam o mesmo horário duas vezes', () => {
  const regras = [{ start: 480, end: 540, slot: 30 }, { start: 480, end: 540, slot: 30 }];
  assert.deepEqual(P.gradeDoDia(regras), [480, 510]);
  assert.deepEqual(P.gradeDoDia([{ start: 600, end: 600, slot: 30 }]), [], 'regra vazia é ignorada');
});

test('prioridade: a reserva só vale até 24 h antes do atendimento', () => {
  const regras = [{ start: 480, end: 600, slot: 30 }];
  const slot = em(2027, 3, 10, 8, 0);
  assert.equal(P.slotReservado({ rules: regras, minutesOfDay: 480, slotStartMs: slot, nowMs: slot - 25 * HORA }), true);
  assert.equal(P.slotReservado({ rules: regras, minutesOfDay: 480, slotStartMs: slot, nowMs: slot - 24 * HORA }), false, 'exatamente 24 h: já liberou');
  assert.equal(P.slotReservado({ rules: regras, minutesOfDay: 510, slotStartMs: slot, nowMs: slot - 48 * HORA }), false, 'vaga comum nunca é reservada');
  assert.match(P.PRIORITY_MESSAGE, /Lei 10\.048\/2000/);
});

// ---------------------------------------------------------------------------
// booking-slots
// ---------------------------------------------------------------------------

const REGRA = [{ start: 8 * 60, end: 10 * 60, slot: 30 }]; // 08:00, 08:30, 09:00, 09:30
const DIA = dia(2027, 3, 10);
const LONGE = em(2027, 3, 1, 12, 0); // bem antes: nada é "hoje" nem cai na janela de 24 h

test('gerarSlotsDoDia: dia futuro sem reservas nem ocupações devolve a grade; paciente comum não vê a vaga reservada', () => {
  const comum = gerarSlotsDoDia({ day: DIA, rules: REGRA, nowMs: LONGE });
  assert.deepEqual(horas(comum), ['08:30', '09:00', '09:30'], 'a 1ª vaga (08:00) é reservada à prioridade');
  const prio = gerarSlotsDoDia({ day: DIA, rules: REGRA, nowMs: LONGE, prioritario: true });
  assert.deepEqual(horas(prio), ['08:00', '08:30', '09:00', '09:30']);
  assert.equal(prio[0].startMs, em(2027, 3, 10, 8, 0));
  assert.equal(prio[0].m, 480);
});

test('gerarSlotsDoDia: dentro de 24 h a reserva é liberada para todos', () => {
  const agora = em(2027, 3, 9, 7, 59); // 24h01 antes das 08:00 => ainda reservado
  assert.deepEqual(horas(gerarSlotsDoDia({ day: DIA, rules: REGRA, nowMs: agora })), ['08:30', '09:00', '09:30']);
  const dentro = em(2027, 3, 9, 8, 30); // < 24 h => liberada
  assert.deepEqual(horas(gerarSlotsDoDia({ day: DIA, rules: REGRA, nowMs: dentro })), ['08:00', '08:30', '09:00', '09:30']);
});

test('gerarSlotsDoDia: passado e margem de 30 min só valem para hoje', () => {
  const hoje = dia(2027, 3, 10);
  const agora = em(2027, 3, 10, 8, 40);
  // 08:00/08:30 já passaram; 09:00 está a 20 min (< 30) e sai; 09:30 está a 50 min.
  assert.deepEqual(horas(gerarSlotsDoDia({ day: hoje, rules: REGRA, nowMs: agora, prioritario: true })), ['09:30']);
  assert.equal(MARGEM_HOJE_MS, 30 * 60000);
  // exatamente 30 min: entra
  assert.deepEqual(horas(gerarSlotsDoDia({ day: hoje, rules: REGRA, nowMs: em(2027, 3, 10, 8, 30), prioritario: true })), ['09:00', '09:30'].filter((h) => h >= '09:00'));
  // dia passado inteiro: nada
  assert.deepEqual(gerarSlotsDoDia({ day: dia(2027, 3, 9), rules: REGRA, nowMs: em(2027, 3, 10, 0, 1), prioritario: true }), []);
});

test('gerarSlotsDoDia: intervalo ocupado remove todo horário que ele toca, mas não os vizinhos', () => {
  const busy = [{ start: em(2027, 3, 10, 8, 30), end: em(2027, 3, 10, 9, 0) }]; // exatamente o slot das 08:30
  const r = gerarSlotsDoDia({ day: DIA, rules: REGRA, nowMs: LONGE, prioritario: true, busy });
  assert.deepEqual(horas(r), ['08:00', '09:00', '09:30'], 'os vizinhos que só encostam seguem livres');
  const bloqueio = [{ start: em(2027, 3, 10, 8, 45), end: em(2027, 3, 10, 9, 15) }];
  assert.deepEqual(horas(gerarSlotsDoDia({ day: DIA, rules: REGRA, nowMs: LONGE, prioritario: true, busy: bloqueio })), ['08:00', '09:30']);
});

test('gerarSlotsDoDia: duração do serviço vence o slot — ocupa mais e precisa caber', () => {
  // serviço de 60 min na grade de 30: 09:00 ocupa até 10:00 (cabe); 09:30 ocuparia até 10:30 (não cabe)
  const r = gerarSlotsDoDia({ day: DIA, rules: REGRA, nowMs: LONGE, prioritario: true, servicoDuracao: 60 });
  assert.deepEqual(horas(r), ['08:00', '08:30', '09:00']);
  // e o ocupado considera os 60 min: um atendimento às 09:30 bloqueia o início das 09:00
  const busy = [{ start: em(2027, 3, 10, 9, 30), end: em(2027, 3, 10, 10, 0) }];
  assert.deepEqual(horas(gerarSlotsDoDia({ day: DIA, rules: REGRA, nowMs: LONGE, prioritario: true, servicoDuracao: 60, busy })), ['08:00', '08:30']);
});

test('gerarSlotsDoDia: sem regras → vazio; regras sobrepostas podem repetir o horário (quem chama deduplica)', () => {
  assert.deepEqual(gerarSlotsDoDia({ day: DIA, rules: [], nowMs: LONGE }), []);
  assert.deepEqual(gerarSlotsDoDia({ day: DIA, rules: undefined, nowMs: LONGE }), []);
  const duas = [{ start: 480, end: 540, slot: 30 }, { start: 480, end: 540, slot: 30 }];
  const r = gerarSlotsDoDia({ day: DIA, rules: duas, nowMs: LONGE, prioritario: true });
  assert.equal(r.length, 4);
  assert.deepEqual([...new Set(horas(r))], ['08:00', '08:30']);
});

test('gerarSlotsDoDia: propriedades em 3000 agendas aleatórias', () => {
  const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const pick = (arr) => arr[rnd(0, arr.length - 1)];
  for (let i = 0; i < 3000; i += 1) {
    const day = dia(2027, rnd(1, 12), rnd(1, 28));
    const inicio = rnd(5, 12) * 60;
    const rules = [{ start: inicio, end: inicio + rnd(2, 8) * 60, slot: pick([15, 20, 30, 60]) }];
    const base = day.getTime();
    const nowMs = base + pick([-72, -25, -23, -3, 0, 7]) * HORA + rnd(0, 3599) * 1000;
    const servicoDuracao = Math.random() < 0.4 ? pick([20, 30, 45, 90]) : null;
    const busy = Array.from({ length: rnd(0, 3) }, () => {
      const s = base + rnd(5 * 60, 18 * 60) * 60000;
      return { start: s, end: s + rnd(10, 90) * 60000 };
    });

    const comum = gerarSlotsDoDia({ day, rules, nowMs, servicoDuracao, busy });
    const prio = gerarSlotsDoDia({ day, rules, nowMs, prioritario: true, servicoDuracao, busy });

    const chaves = new Set(prio.map((s) => s.m));
    for (const s of comum) assert.ok(chaves.has(s.m), 'o paciente comum nunca vê vaga que o prioritário não vê');
    for (const s of prio) {
      const ocupacao = servicoDuracao || rules[0].slot;
      assert.ok(s.startMs > nowMs, 'só futuro');
      assert.ok(s.m >= rules[0].start && s.m + ocupacao <= rules[0].end, 'cabe na agenda');
      assert.ok(!busy.some((iv) => T.overlaps(s.startMs, s.startMs + ocupacao * 60000, iv.start, iv.end)), 'nunca sobre ocupado');
      assert.equal((s.m - rules[0].start) % rules[0].slot, 0, 'alinhado à grade');
    }
  }
});

// ---------------------------------------------------------------------------
// Fachada
// ---------------------------------------------------------------------------

test('utils/booking.js segue exportando tudo o que rotas e serviços importam', () => {
  const booking = require('../src/utils/booking');
  const nomes = [
    'KINDS', 'TIPOS', 'MAX_DAYS_AHEAD', 'AVAILABILITY_PAGE_DAYS', 'resolveAvailabilityWindow',
    'PRIORITY_GROUPS', 'PRIORITY_QUOTA_RATIO', 'PRIORITY_RELEASE_HOURS', 'PRIORITY_MESSAGE',
    'isPriorityUser', 'prioridadeDoUsuario', 'quotaPrioritaria', 'gradeDoDia', 'reservasDoDia', 'slotReservado',
    'BOOKING_STATUS', 'parseDateTime', 'toDateStr', 'validateScheduleWindow', 'lockBookingActors',
    'validateUserOverlap', 'validateBooking', 'duracaoServico', 'duracaoMinutos', 'duracaoDe',
    'DURACAO_PADRAO', 'getAvailability', 'findAvailabilityByService', 'applyBookingChange',
  ];
  for (const n of nomes) assert.notEqual(booking[n], undefined, `booking.${n} sumiu da fachada`);
  assert.equal(booking.parseDateTime, T.parseDateTime, 'a fachada reexporta a MESMA função, não uma cópia');
  assert.equal(booking.slotReservado, P.slotReservado);
  assert.equal(booking.applyBookingChange, require('../src/services/bookingChange').applyBookingChange);
  assert.equal(booking.validateBooking, require('../src/services/bookingRules').validateBooking);
});

test('os módulos de agendamento carregam em qualquer ordem, sem dependência circular', () => {
  const { spawnSync } = require('node:child_process');
  const base = path.resolve(__dirname, '..', 'src');
  const ordens = [
    ['services/bookingChange', 'services/bookingRules', 'utils/booking'],
    ['services/bookingRules', 'services/bookingChange', 'utils/booking'],
    ['utils/booking', 'services/bookingChange', 'services/bookingRules'],
    ['repositories/agenda', 'utils/booking-slots', 'utils/booking'],
  ];
  for (const ordem of ordens) {
    const codigo = ordem.map((m) => `require(${JSON.stringify(path.join(base, m))})`).join(';')
      + ';const b=require(' + JSON.stringify(path.join(base, 'utils/booking')) + ');'
      + 'if(typeof b.applyBookingChange!=="function"||typeof b.validateBooking!=="function")process.exit(3);';
    const r = spawnSync(process.execPath, ['-e', codigo], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', env: process.env });
    assert.equal(r.status, 0, `ordem ${ordem.join(' → ')}: ${r.stderr}`);
  }
});
