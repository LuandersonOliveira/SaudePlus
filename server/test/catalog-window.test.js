/**
 * Janela de disponibilidade — F0-05.
 *
 * O agendamento aceita até 366 dias (`MAX_DAYS_AHEAD`), mas catálogo e slots
 * devolviam no máximo 60 e o front pedia o padrão de 30. Uma agenda de um ano
 * numa resposta só multiplica consultas e slots sem uso. Contrato novo:
 *
 *   days        -> 1..30 (inválido/ausente = 30)
 *   offset_days -> 0..(366 - days), para paginar de 30 em 30
 *
 * A normalização vive em `resolveAvailabilityWindow`, usada pelas duas rotas.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  MAX_DAYS_AHEAD,
  AVAILABILITY_PAGE_DAYS,
  resolveAvailabilityWindow,
} = require('../src/utils/booking');

const ROOT = path.resolve(__dirname, '..', '..');

test('sem parâmetros: página padrão de 30 dias a partir de hoje', () => {
  assert.deepEqual(resolveAvailabilityWindow({}), { days: 30, offsetDays: 0 });
  assert.deepEqual(resolveAvailabilityWindow(), { days: 30, offsetDays: 0 });
});

test('days acima do teto é limitado a 30', () => {
  assert.equal(resolveAvailabilityWindow({ days: '31' }).days, 30);
  assert.equal(resolveAvailabilityWindow({ days: '60' }).days, 30);
  assert.equal(resolveAvailabilityWindow({ days: '366' }).days, 30);
});

test('days válido é respeitado dentro de 1..30', () => {
  assert.equal(resolveAvailabilityWindow({ days: '10' }).days, 10);
  assert.equal(resolveAvailabilityWindow({ days: 7 }).days, 7);
  assert.equal(resolveAvailabilityWindow({ days: '0' }).days, 1);
  assert.equal(resolveAvailabilityWindow({ days: '-5' }).days, 1);
});

test('days não numérico cai no padrão, não em NaN', () => {
  assert.equal(resolveAvailabilityWindow({ days: 'abc' }).days, 30);
  assert.equal(resolveAvailabilityWindow({ days: null }).days, 30);
});

test('offset pagina a janela sem passar do fim de 1 ano', () => {
  assert.equal(resolveAvailabilityWindow({ days: 30, offsetDays: '30' }).offsetDays, 30);
  assert.equal(resolveAvailabilityWindow({ days: 30, offsetDays: '336' }).offsetDays, 336);
  assert.equal(
    resolveAvailabilityWindow({ days: 30, offsetDays: '999' }).offsetDays,
    MAX_DAYS_AHEAD - AVAILABILITY_PAGE_DAYS,
    'a última página começa onde ainda cabem 30 dias'
  );
  assert.equal(resolveAvailabilityWindow({ days: 10, offsetDays: '999' }).offsetDays, 356);
});

test('offset inválido ou negativo vira 0', () => {
  assert.equal(resolveAvailabilityWindow({ offsetDays: '-1' }).offsetDays, 0);
  assert.equal(resolveAvailabilityWindow({ offsetDays: 'x' }).offsetDays, 0);
});

test('constantes do contrato continuam explícitas', () => {
  assert.equal(MAX_DAYS_AHEAD, 366);
  assert.equal(AVAILABILITY_PAGE_DAYS, 30);
});

test('as duas rotas usam a mesma normalização (sem clamps duplicados)', () => {
  const rotas = fs.readFileSync(path.join(ROOT, 'server', 'src', 'routes', 'catalog.routes.js'), 'utf8');
  assert.match(rotas, /resolveAvailabilityWindow/, 'catalog.routes.js precisa importar o helper');
  assert.match(rotas, /offset_days/, 'as rotas precisam aceitar offset_days');
  assert.doesNotMatch(rotas, /parseInt\(req\.query\.days/, 'clamp local voltou? use resolveAvailabilityWindow');
  assert.doesNotMatch(rotas, /\|\| 30, 1\), 60\)/, 'teto antigo de 60 dias voltou');

  const booking = fs.readFileSync(path.join(ROOT, 'server', 'src', 'utils', 'booking.js'), 'utf8');
  assert.doesNotMatch(booking, /\|\| 30, 1\), 60\)/, 'findAvailabilityByService ainda limita a 60');
});
