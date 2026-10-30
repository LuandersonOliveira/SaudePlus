const crypto = require('crypto');

const EVENT_TYPES = [
  'created',
  'status_changed',
  'rescheduled',
  'professional_deactivated',
  'canceled',
];

/**
 * Histórico operacional append-only. `db` pode ser o pool ou uma conexão
 * dentro de transação. Nunca lança por evento inválido? Lança de propósito:
 * quem chama decide se o histórico é parte da transação ou best-effort.
 */
async function registrarEvento(db, {
  kind,
  bookingId,
  eventType,
  fromScheduledAt = null,
  toScheduledAt = null,
  fromProfessionalId = null,
  toProfessionalId = null,
  reason = null,
  actorUserId = null,
}) {
  if (!['consulta', 'exame'].includes(kind)) throw new Error(`Tipo de agenda inválido: ${kind}`);
  if (!bookingId) throw new Error('booking_id é obrigatório para o evento.');
  if (!EVENT_TYPES.includes(eventType)) throw new Error(`Tipo de evento inválido: ${eventType}`);

  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO booking_events (
       id, kind, booking_id, event_type,
       from_scheduled_at, to_scheduled_at,
       from_professional_id, to_professional_id,
       reason, actor_user_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, kind, bookingId, eventType,
      fromScheduledAt, toScheduledAt,
      fromProfessionalId, toProfessionalId,
      reason ? String(reason).slice(0, 255) : null,
      actorUserId,
    ]
  );
  return id;
}

async function listarEventos(db, { kind, bookingId, limit = 50 }) {
  if (!['consulta', 'exame'].includes(kind)) return [];
  if (!bookingId) return [];
  const teto = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 200);
  const [rows] = await db.query(
    `SELECT id, kind, booking_id, event_type,
            from_scheduled_at, to_scheduled_at,
            from_professional_id, to_professional_id,
            reason, actor_user_id, created_at
     FROM booking_events
     WHERE kind = ? AND booking_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    [kind, bookingId, teto]
  );
  return rows;
}

module.exports = { EVENT_TYPES, registrarEvento, listarEventos };
