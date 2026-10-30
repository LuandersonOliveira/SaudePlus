/**
 * Fase 0.2 - contrato de status da agenda operacional.
 *
 * `para_remarcar` precisa ser um status válido sem ocupar horário. `outcome`
 * e `reschedule_reason` são dados do registro, não novos status. O histórico
 * operacional fica em `booking_events`, separado da auditoria administrativa.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

const SERVER = path.resolve(__dirname, '..');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const pool = require('../src/db');
const {
  BOOKING_STATUS,
  OCCUPYING_STATUS,
  BOOKING_OUTCOMES,
  RESCHEDULE_REASONS,
  isBookingStatus,
  isOccupyingStatus,
  validateOutcome,
  validateRescheduleReason,
} = require('../src/utils/booking-status');
const { registrarEvento, listarEventos } = require('../src/services/booking-events');
const { applyBookingChange } = require('../src/utils/booking');

let userId;
let appointmentId;

test.before(async () => {
  userId = crypto.randomUUID();
  appointmentId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, account_status)
     VALUES (?, 'Paciente Status', ?, 'x', 'paciente', 'ativo')`,
    [userId, `status+${userId.slice(0, 8)}@test.local`]
  );
  await pool.query(
    `INSERT INTO appointments (id, user_id, specialty, location, scheduled_at, status)
     VALUES (?, ?, 'Clínica Geral', 'UBS Teste', '2026-12-01 09:00:00', 'pendente')`,
    [appointmentId, userId]
  );
});

test.after(async () => {
  await pool.query('DELETE FROM booking_events WHERE booking_id = ?', [appointmentId]).catch(() => {});
  await pool.query('DELETE FROM appointments WHERE id = ?', [appointmentId]).catch(() => {});
  await pool.query('DELETE FROM users WHERE id = ?', [userId]).catch(() => {});
  await pool.end().catch(() => {});
});

test('para_remarcar é status válido e não ocupa horário', () => {
  assert.ok(BOOKING_STATUS.includes('para_remarcar'));
  assert.ok(isBookingStatus('para_remarcar'));
  assert.equal(isOccupyingStatus('para_remarcar'), false);
  assert.deepEqual(OCCUPYING_STATUS, ['pendente', 'confirmado']);
  assert.equal(isOccupyingStatus('pendente'), true);
  assert.equal(isOccupyingStatus('confirmado'), true);
});

test('outcome aceita só o contrato e vazio limpa', () => {
  for (const outcome of BOOKING_OUTCOMES) assert.equal(validateOutcome(outcome), null);
  assert.equal(validateOutcome(''), null);
  assert.equal(validateOutcome(null), null);
  assert.match(validateOutcome('inventado'), /inválido/i);
});

test('motivo de remarcação é obrigatório quando a regra exige', () => {
  assert.equal(validateRescheduleReason('', { required: true }), 'Informe o motivo da remarcação.');
  assert.equal(validateRescheduleReason('', { required: false }), null);
  assert.equal(validateRescheduleReason(RESCHEDULE_REASONS[0]), null);
  assert.match(validateRescheduleReason('x'.repeat(256)), /255/);
});

test('applyBookingChange grava outcome e reschedule_reason no mesmo registro', async () => {
  const result = await applyBookingChange(pool, {
    kindKey: 'appointments',
    id: appointmentId,
    body: { outcome: 'faltou', reschedule_reason: 'solicitado_pelo_paciente' },
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));

  const [[row]] = await pool.query(
    'SELECT outcome, reschedule_reason FROM appointments WHERE id = ?',
    [appointmentId]
  );
  assert.equal(row.outcome, 'faltou');
  assert.equal(row.reschedule_reason, 'solicitado_pelo_paciente');
});

test('booking_events registra e lista o histórico operacional', async () => {
  const id = await registrarEvento(pool, {
    kind: 'consulta',
    bookingId: appointmentId,
    eventType: 'rescheduled',
    fromScheduledAt: '2026-12-01 09:00:00',
    toScheduledAt: '2026-12-02 09:00:00',
    reason: 'solicitado_pelo_paciente',
  });
  assert.ok(id);

  const eventos = await listarEventos(pool, { kind: 'consulta', bookingId: appointmentId });
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].event_type, 'rescheduled');
  assert.equal(eventos[0].reason, 'solicitado_pelo_paciente');
});
