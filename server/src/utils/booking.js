/* ==========================================================================
   Saúde+ — FACHADA do agendamento (A1 da Fase 6, passo 7d).

   Rotas, serviços e testes importam daqui desde sempre; o código mora em:
     utils/booking-time.js       tempo, janela, duração, encaixe na agenda (puro)
     utils/booking-priority.js   prioridade legal (Lei 10.048/2000) (puro)
     utils/booking-slots.js      horários livres de um dia (puro)
     repositories/agenda.js      SQL de leitura da agenda
     services/bookingRules.js    validação e disponibilidade
     services/bookingChange.js   alteração de status/remarcação por staff e admin
   Código novo pode importar direto do módulo que interessa.
   ========================================================================== */
const { BOOKING_STATUS } = require('./booking-status');
const time = require('./booking-time');
const priority = require('./booking-priority');
const rules = require('../services/bookingRules');
const { applyBookingChange } = require('../services/bookingChange');

module.exports = {
  // tipos e janelas
  KINDS: rules.KINDS,
  TIPOS: rules.TIPOS,
  MAX_DAYS_AHEAD: time.MAX_DAYS_AHEAD,
  AVAILABILITY_PAGE_DAYS: time.AVAILABILITY_PAGE_DAYS,
  resolveAvailabilityWindow: time.resolveAvailabilityWindow,
  BOOKING_STATUS,
  // tempo e duração
  parseDateTime: time.parseDateTime,
  toDateStr: time.toDateStr,
  validateScheduleWindow: time.validateScheduleWindow,
  duracaoDe: time.duracaoDe,
  DURACAO_PADRAO: time.DURACAO_PADRAO,
  duracaoServico: rules.duracaoServico,
  duracaoMinutos: rules.duracaoMinutos,
  // prioridade legal
  PRIORITY_GROUPS: priority.PRIORITY_GROUPS,
  PRIORITY_QUOTA_RATIO: priority.PRIORITY_QUOTA_RATIO,
  PRIORITY_RELEASE_HOURS: priority.PRIORITY_RELEASE_HOURS,
  PRIORITY_MESSAGE: priority.PRIORITY_MESSAGE,
  isPriorityUser: priority.isPriorityUser,
  quotaPrioritaria: priority.quotaPrioritaria,
  gradeDoDia: priority.gradeDoDia,
  reservasDoDia: priority.reservasDoDia,
  slotReservado: priority.slotReservado,
  prioridadeDoUsuario: rules.prioridadeDoUsuario,
  // regras
  lockBookingActors: rules.lockBookingActors,
  validateUserOverlap: rules.validateUserOverlap,
  validateBooking: rules.validateBooking,
  getAvailability: rules.getAvailability,
  findAvailabilityByService: rules.findAvailabilityByService,
  // alteração por staff/admin
  applyBookingChange,
};
