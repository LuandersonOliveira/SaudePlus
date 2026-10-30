/**
 * Fase 0.3 - uma única definição de "hoje".
 *
 * O erro que este teste protege: perto da meia-noite, `toISOString()` já
 * devolve o dia seguinte em UTC. A agenda do serviço precisa do dia local.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidDateOnly,
  localDateStr,
  localDateTimeStr,
  addDaysLocal,
  localDateRange,
} = require('../src/utils/local-date');

test('localDateStr usa os getters locais, não o dia UTC', () => {
  const tarde = new Date(2026, 0, 2, 23, 30);
  assert.equal(localDateStr(tarde), '2026-01-02');
  assert.equal(localDateTimeStr(tarde), '2026-01-02T23:30');
});

test('isValidDateOnly rejeita datas que não existem', () => {
  assert.equal(isValidDateOnly('2026-02-30'), false);
  assert.equal(isValidDateOnly('2026-13-01'), false);
  assert.equal(isValidDateOnly('02/01/2026'), false);
  assert.equal(isValidDateOnly('2026-02-29'), false);
  assert.equal(isValidDateOnly('2028-02-29'), true);
  assert.equal(isValidDateOnly('2026-12-31'), true);
});

test('addDaysLocal atravessa mês e ano no calendário local', () => {
  const d = new Date(2026, 11, 31, 22, 0);
  assert.equal(localDateStr(addDaysLocal(d, 1)), '2027-01-01');
  assert.equal(localDateStr(addDaysLocal(new Date(2026, 0, 31), 1)), '2026-02-01');
});

test('localDateRange devolve dias consecutivos, inclusive o inicial', () => {
  assert.deepEqual(
    localDateRange(new Date(2026, 10, 29), 3),
    ['2026-11-29', '2026-11-30', '2026-12-01']
  );
  assert.deepEqual(localDateRange(new Date(2026, 0, 1), 0), ['2026-01-01']);
});
