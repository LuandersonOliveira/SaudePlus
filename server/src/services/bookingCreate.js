/* ==========================================================================
   Saúde+ — criação de atendimento: o ÚNICO caminho de escrita de agendamento novo
   (E-06 da Fase 7, item 2.1 da Fase 8).

   Antes, o paciente (routes/me.booking.routes.js), a recepção (routes/staff.routes.js) e a fila de
   espera (services/waitlist.js) montavam o mesmo INSERT à mão. Agora todos chamam
   `criarAtendimento`, e uma coluna nova ou uma regra nova entra num lugar só.

   A sequência é sempre a mesma:
     1. trava utente e profissional, na ordem canônica (repositories/agenda.travarEnvolvidos);
     2. valida (services/bookingRules.validateBooking): janela, unidade, oferta, escala, bloqueios,
        ocupação do profissional, sobreposição do utente e cota de prioridade;
     3. calcula a duração; 4. resolve o nome do profissional e o local; 5. grava;
     6. registra o evento `created` (booking_events) na mesma transação: TODA criação deixa rastro,
        seja do paciente, da recepção ou da fila (E-08/E-12).

   Duas defesas continuam atrás desta: o `FOR UPDATE` do passo 1 e o UNIQUE (professional_id,
   active_slot) do banco (ADR-0007), que responde 409 "Horário já ocupado" em app.js.

   A TRANSAÇÃO é de quem chama (`db` é a conexão dela): o paciente e a recepção confirmam logo depois,
   a fila avisa o candidato conforme o resultado.
   Nada aqui toca em `req`/`res`.
   ========================================================================== */
const crypto = require('crypto');
const agenda = require('../repositories/agenda');
const atendimentos = require('../repositories/atendimentos');
const { registrarEvento } = require('./booking-events');
const {
  TIPOS, lockBookingActors, validateBooking, duracaoMinutos, prioridadeDoUsuario,
} = require('./bookingRules');

/**
 * @param {object} db conexão de uma transação já aberta
 * @param {object} d
 * @param {'consulta'|'exame'} d.tipo
 * @param {string} d.userId             utente que será atendido
 * @param {string} d.unitId
 * @param {string|null} [d.professionalId]
 * @param {string} d.serviceName        especialidade (consulta) ou tipo de exame
 * @param {string} d.scheduledAt        'YYYY-MM-DD HH:MM[:SS]'
 * @param {string} [d.location]         sem ele, o nome da unidade
 * @param {string} [d.doctor]           só vale sem profissional: com profissional, o nome cadastrado dele vence
 * @param {string} [d.notes]
 * @param {string|null} [d.userPriority] se o chamador já tem a prioridade do utente (a fila tem); `undefined` = consulta o banco
 * @param {string|null} [d.actorUserId]  quem criou (paciente ou atendente); `null` = o sistema (fila de espera)
 * @param {string} [d.eventoMotivo]      motivo do evento `created` (a fila informa `fila_de_espera`)
 * @returns {Promise<{ok: true, id: string, duracao: number} | {ok: false, error: string}>}
 */
async function criarAtendimento(db, d) {
  const meta = TIPOS[d.tipo];
  if (!meta) return { ok: false, error: 'Tipo de atendimento inválido.' };
  const professionalId = d.professionalId || null;

  await lockBookingActors(db, { userId: d.userId, professionalId });

  const userPriority = d.userPriority === undefined ? await prioridadeDoUsuario(db, d.userId) : d.userPriority;
  const erro = await validateBooking(db, {
    tipo: d.tipo,
    userId: d.userId,
    unitId: d.unitId,
    professionalId,
    serviceName: d.serviceName,
    scheduledAt: d.scheduledAt,
    userPriority,
  });
  if (erro) return { ok: false, error: erro };

  // A duração vai gravada junto: sem ela o cálculo de conflito trataria este atendimento como 30 min para
  // sempre, e um de 60 min deixaria livre o horário seguinte da grade de 30.
  const duracao = await duracaoMinutos(db, {
    unitId: d.unitId, professionalId, serviceName: d.serviceName, tipo: d.tipo, scheduledAt: d.scheduledAt,
  });

  const nomeDoProfissional = professionalId ? await agenda.nomeDoProfissional(db, professionalId) : null;
  const location = d.location || (await agenda.nomeDaUnidade(db, d.unitId));

  const id = crypto.randomUUID();
  await atendimentos.inserir(db, {
    table: meta.table,
    id,
    userId: d.userId,
    serviceName: d.serviceName,
    doctor: nomeDoProfissional || d.doctor || null,
    location,
    unitId: d.unitId,
    professionalId,
    scheduledAt: d.scheduledAt,
    notes: d.notes,
    duracao,
  });
  await registrarEvento(db, {
    kind: d.tipo,
    bookingId: id,
    eventType: 'created',
    toScheduledAt: d.scheduledAt,
    toProfessionalId: professionalId,
    reason: d.eventoMotivo || null,
    actorUserId: d.actorUserId || null,
  });
  return { ok: true, id, duracao };
}

module.exports = { criarAtendimento };
