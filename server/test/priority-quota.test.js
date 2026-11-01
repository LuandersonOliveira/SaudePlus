/**
 * NV02 — regra pura da cota de prioridade legal.
 *
 * A reserva é de 10% das vagas do dia por profissional (mínimo 1), aplicada
 * às primeiras vagas da grade e liberada para todos nas 24 h anteriores.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PRIORITY_GROUPS,
  PRIORITY_RELEASE_HOURS,
  isPriorityUser,
  quotaPrioritaria,
  gradeDoDia,
  reservasDoDia,
  slotReservado,
} = require('../src/utils/booking');

test('grupos legais reconhecidos; "nenhuma" e vazio não são prioridade', () => {
  assert.deepEqual(PRIORITY_GROUPS, ['idoso', 'gestante', 'pcd', 'lactante']);
  for (const grupo of PRIORITY_GROUPS) assert.equal(isPriorityUser(grupo), true, grupo);
  assert.equal(isPriorityUser('nenhuma'), false);
  assert.equal(isPriorityUser(null), false);
  assert.equal(isPriorityUser(undefined), false);
  assert.equal(isPriorityUser(''), false);
});

test('cota é 10% arredondada para cima, com piso de 1', () => {
  assert.equal(quotaPrioritaria(0), 0);
  assert.equal(quotaPrioritaria(1), 1);
  assert.equal(quotaPrioritaria(4), 1);
  assert.equal(quotaPrioritaria(9), 1);
  assert.equal(quotaPrioritaria(10), 1);
  assert.equal(quotaPrioritaria(11), 2);
  assert.equal(quotaPrioritaria(20), 2);
  assert.equal(quotaPrioritaria(30), 3);
  assert.equal(quotaPrioritaria('12'), 2);
  assert.equal(quotaPrioritaria(null), 0);
});

test('grade deduplica horários de agendas sobrepostas', () => {
  const grade = gradeDoDia([
    { start: 480, end: 660, slot: 60 },
    { start: 540, end: 720, slot: 60 },
  ]);
  assert.deepEqual(grade, [480, 540, 600, 660]);
});

test('grade aceita o formato cru do banco (start_time/slot_minutes)', () => {
  const grade = gradeDoDia([
    { start_time: '08:00:00', end_time: '10:00:00', slot_minutes: '60' },
    { start_time: '08:00:00', end_time: '09:00:00', slot_minutes: 30 },
  ]);
  assert.deepEqual(grade, [480, 510, 540]);
});

test('as primeiras N vagas do dia ficam reservadas', () => {
  const rules = [{ start: 480, end: 720, slot: 60 }]; // 08, 09, 10, 11
  const now = Date.UTC(2026, 0, 5, 12, 0, 0);
  const em25h = now + 25 * 3600 * 1000;
  assert.deepEqual([...reservasDoDia(rules)], [480]);
  assert.equal(slotReservado({ rules, minutesOfDay: 480, slotStartMs: em25h, nowMs: now }), true);
  assert.equal(slotReservado({ rules, minutesOfDay: 540, slotStartMs: em25h, nowMs: now }), false);
});

test('a reserva é liberada 24 h antes do atendimento', () => {
  assert.equal(PRIORITY_RELEASE_HOURS, 24);
  const now = Date.UTC(2026, 0, 5, 12, 0, 0);
  const rules = [{ start: 480, end: 660, slot: 60 }];
  const em = (horas) => now + horas * 3600 * 1000;

  assert.equal(slotReservado({ rules, minutesOfDay: 480, slotStartMs: em(25), nowMs: now }), true);
  assert.equal(slotReservado({ rules, minutesOfDay: 480, slotStartMs: em(24), nowMs: now }), false);
  assert.equal(slotReservado({ rules, minutesOfDay: 480, slotStartMs: em(23), nowMs: now }), false);
});
