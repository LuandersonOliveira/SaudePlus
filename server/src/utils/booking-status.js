/* ==========================================================================
   Contrato de status da agenda operacional.

   `para_remarcar` é uma pendência da recepção: o registro continua existindo,
   mas NÃO ocupa o horário antigo. `outcome` explica o desfecho sem criar um
   status novo para cada motivo. Mantenha as listas em sincronia com o ENUM de
   `appointments`/`exams` no schema.sql e na migration 011.
   ========================================================================== */

const BOOKING_STATUS = ['pendente', 'confirmado', 'cancelado', 'concluido', 'para_remarcar'];
const OCCUPYING_STATUS = ['pendente', 'confirmado'];

const BOOKING_OUTCOMES = [
  'compareceu',
  'faltou',
  'recusou',
  'desistiu',
  'erro_agendamento',
  'profissional_indisponivel',
];

const RESCHEDULE_REASONS = [
  'solicitado_pelo_paciente',
  'profissional_inativado',
];

function isBookingStatus(value) {
  return BOOKING_STATUS.includes(String(value || ''));
}

function isOccupyingStatus(value) {
  return OCCUPYING_STATUS.includes(String(value || ''));
}

function validateOutcome(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const outcome = String(value).trim();
  if (!BOOKING_OUTCOMES.includes(outcome)) {
    return `Desfecho inválido. Use um dos valores: ${BOOKING_OUTCOMES.join(', ')}.`;
  }
  return null;
}

function validateRescheduleReason(value, { required = false } = {}) {
  const reason = value === null || value === undefined ? '' : String(value).trim();
  if (!reason) {
    return required ? 'Informe o motivo da remarcação.' : null;
  }
  if (reason.length > 255) {
    return 'O motivo da remarcação deve ter no máximo 255 caracteres.';
  }
  return null;
}

module.exports = {
  BOOKING_STATUS,
  OCCUPYING_STATUS,
  BOOKING_OUTCOMES,
  RESCHEDULE_REASONS,
  isBookingStatus,
  isOccupyingStatus,
  validateOutcome,
  validateRescheduleReason,
};
