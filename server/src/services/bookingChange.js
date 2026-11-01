/* ==========================================================================
   Saúde+ — alteração de status / desfecho / remarcação por staff e admin
   (Fase 2, item 3; A1 da Fase 6, passo 7c).

   Mesma lógica do PATCH /:kind/:id de staff.routes e admin.routes.
   Não grava auditoria (Fase 3, item 2): devolve os dados para a rota registrar.

   Duas metades:
     - `normalizarMudanca` (PURA): valida o corpo e monta o que vai ser gravado.
     - `applyBookingChange` (transacional): trava o registro, revalida a agenda,
       grava e registra os eventos operacionais.

   opts = { kindKey: 'appointments'|'exams', id, body: {status, scheduled_at, outcome,
            reschedule_reason}, actorUserId, autoReason, defaultReason, reasonRequired,
            failOnEventError }
   Retorna { status, body } e, em sucesso, { audit: { entityType, details } }.
   ========================================================================== */
const {
  BOOKING_STATUS,
  validateOutcome,
  validateRescheduleReason,
} = require('../utils/booking-status');
const { validateScheduleWindow } = require('../utils/booking-time');
const { registrarEvento } = require('./booking-events');
const atendimentos = require('../repositories/atendimentos');
// A revalidação da agenda usa as regras de agendamento.
const {
  validateBooking, duracaoMinutos, prioridadeDoUsuario, lockBookingActors,
} = require('./bookingRules');

const META = {
  appointments: { table: 'appointments', tipo: 'consulta', serviceColumn: 'specialty', entityType: 'appointment', kind: 'consulta' },
  exams: { table: 'exams', tipo: 'exame', serviceColumn: 'exam_type', entityType: 'exam', kind: 'exame' },
};

const recusa = (status, error) => ({ ok: false, status, body: { error } });
const temChave = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);

/**
 * Valida o pedido e monta a atualização, sem tocar no banco.
 *
 * @returns {{ok: false, status: number, body: {error: string}}
 *   | {ok: true, status: string|undefined, scheduledAt: string|undefined, updates: string[], params: any[],
 *      logParts: string[], reason: string|null, motivoFoiInformado: boolean, temMotivo: boolean,
 *      motivoObrigatorio: boolean, comMotivoOuPadrao: boolean}}
 */
function normalizarMudanca(body, opts = {}) {
  const b = body || {};
  const { status, scheduled_at: scheduledAt } = b;
  const temOutcome = temChave(b, 'outcome');
  const temMotivo = temChave(b, 'reschedule_reason');
  const motivoPadrao = opts.autoReason || opts.defaultReason;
  const updates = [];
  const params = [];
  const logParts = [];

  if (status !== undefined) {
    if (!BOOKING_STATUS.includes(status)) return recusa(400, 'Status inválido.');
    updates.push('status=?'); params.push(status); logParts.push(`status -> ${status}`);
  }
  if (temOutcome) {
    const outcomeError = validateOutcome(b.outcome);
    if (outcomeError) return recusa(400, outcomeError);
    const outcome = b.outcome ? String(b.outcome).trim() : null;
    updates.push('outcome=?'); params.push(outcome);
    logParts.push(`desfecho -> ${outcome || 'limpo'}`);
  }

  const motivoFoiInformado = temMotivo;
  let reason = temMotivo
    ? (b.reschedule_reason ? String(b.reschedule_reason).trim() : null)
    : null;
  if (reason === null && motivoPadrao) reason = motivoPadrao;
  // Motivo só é validado aqui quando o chamador o enviou ou há default.
  if ((temMotivo || reason !== null) && (temMotivo || motivoPadrao)) {
    const reasonError = validateRescheduleReason(reason, { required: false });
    if (reasonError) return recusa(400, reasonError);
  }

  if (scheduledAt) {
    const windowError = validateScheduleWindow(scheduledAt);
    if (windowError) return recusa(400, windowError);
    updates.push('scheduled_at=?'); params.push(scheduledAt);
    logParts.push(`reagendado para ${scheduledAt}`);
  }

  // Motivo obrigatório ao reagendar (salvo quando há default/paciente). A
  // exigência real depende do horário mudar de fato; uma gravação no mesmo
  // horário (salvar sem mudar) não precisa de justificativa.
  const motivoObrigatorio = opts.reasonRequired !== undefined ? opts.reasonRequired : !motivoPadrao;

  // Coluna reschedule_reason: atualiza se motivo foi enviado ou há default.
  if (temMotivo || motivoPadrao) {
    updates.push('reschedule_reason=?'); params.push(reason);
    logParts.push(reason ? `motivo -> ${reason}` : 'motivo -> limpo');
  }

  if (!updates.length) return recusa(400, 'Nada para atualizar.');

  return {
    ok: true,
    status,
    scheduledAt,
    updates,
    params,
    logParts,
    reason,
    motivoFoiInformado,
    temMotivo,
    motivoObrigatorio,
    comMotivoOuPadrao: Boolean(temMotivo || motivoPadrao || motivoFoiInformado),
  };
}

/**
 * Aplica a mudança. Com `db` sendo um POOL, abre e fecha a própria transação; com uma
 * conexão (já dentro de transação), usa a do chamador.
 */
async function applyBookingChange(db, opts) {
  const ownsConnection = typeof db.getConnection === 'function';
  const conn = ownsConnection ? await db.getConnection() : db;
  const meta = META[opts.kindKey] || null;

  const run = async (c) => {
    if (!meta) return { status: 404, body: { error: 'Tipo inválido.' } };

    const n = normalizarMudanca(opts && opts.body, opts);
    if (!n.ok) return { status: n.status, body: n.body };
    const { status, scheduledAt, updates, params, logParts, reason } = n;

    // Leitura/travamento do registro ATUAL antes da validação, para evitar
    // corrida com outro reagendamento do mesmo item ou do mesmo utente.
    const before = await atendimentos.lerETravar(c, meta.table, opts.id);
    if (!before) return { status: 404, body: { error: 'Registro não encontrado.' } };

    const changedScheduled = Boolean(scheduledAt) && String(before.scheduled_at) !== String(scheduledAt);
    if (changedScheduled && n.motivoObrigatorio && !n.motivoFoiInformado && !(opts.autoReason || opts.defaultReason)) {
      return { status: 400, body: { error: 'Informe o motivo da remarcação.' } };
    }
    if (changedScheduled && n.comMotivoOuPadrao) {
      const reasonError = validateRescheduleReason(reason, { required: true });
      if (reasonError) return { status: 400, body: { error: reasonError } };
    }

    await lockBookingActors(c, {
      userId: before.user_id,
      professionalId: before.professional_id,
    });

    // Se o registro tem profissional vinculado, revalida disponibilidade.
    if (scheduledAt && before.professional_id && before.unit_id) {
      const userPriority = await prioridadeDoUsuario(c, before.user_id);
      const bookingError = await validateBooking(c, {
        tipo: meta.tipo,
        userId: before.user_id,
        unitId: before.unit_id,
        professionalId: before.professional_id,
        serviceName: before.service_name,
        scheduledAt,
        excludeId: opts.id,
        userPriority,
        currentScheduledAt: before.scheduled_at,
      });
      if (bookingError) return { status: 409, body: { error: bookingError } };

      const duracao = await duracaoMinutos(c, {
        unitId: before.unit_id,
        professionalId: before.professional_id,
        serviceName: before.service_name,
        tipo: meta.tipo,
        scheduledAt,
      });
      updates.push('duration_minutes=?'); params.push(duracao);
      logParts.push(`duracao -> ${duracao} min`);
    }

    const fromScheduled = before.scheduled_at;
    const toScheduled = scheduledAt || before.scheduled_at;
    const changedStatus = status !== undefined && status !== before.status;

    const afetadas = await atendimentos.atualizar(c, meta.table, opts.id, updates, params);
    if (afetadas === 0) return { status: 404, body: { error: 'Registro não encontrado.' } };

    // Eventos operacionais (append-only).
    const actorUserId = opts.actorUserId || null;
    const evento = (eventType) => registrarEvento(c, {
      kind: meta.kind,
      bookingId: opts.id,
      eventType,
      fromScheduledAt: fromScheduled,
      toScheduledAt: toScheduled,
      fromProfessionalId: before.professional_id,
      toProfessionalId: before.professional_id,
      reason: reason || null,
      actorUserId,
    });
    try {
      if (changedScheduled) await evento('rescheduled');
      if (changedStatus) await evento(status === 'cancelado' ? 'canceled' : 'status_changed');
    } catch (eventError) {
      // Histórico não deve derrubar a atualização, salvo quando for best-effort.
      if (opts.failOnEventError) throw eventError;
    }

    return {
      status: 200,
      body: { id: opts.id },
      audit: { entityType: meta.entityType, details: logParts.join('; ') },
    };
  };

  try {
    if (ownsConnection) await conn.beginTransaction();
    const result = await run(conn);
    if (ownsConnection) {
      if (result.status === 200) await conn.commit();
      else await conn.rollback();
    }
    return result;
  } catch (err) {
    if (ownsConnection) await conn.rollback().catch(() => {});
    throw err;
  } finally {
    if (ownsConnection) conn.release();
  }
}

module.exports = { applyBookingChange, normalizarMudanca };
