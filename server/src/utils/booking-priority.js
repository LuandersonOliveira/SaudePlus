/* ==========================================================================
   Saúde+ — prioridade legal de atendimento (NV02; A1, passo 7a): funções PURAS.

   Lei 10.048/2000. O campo `users.priority` existia, mas não alterava a oferta
   de vagas. Regra acordada: 10% das vagas de cada dia/profissional (mínimo 1)
   ficam reservadas para idoso, gestante, PCD e lactante. A reserva vale até
   24 h antes do atendimento; depois disso a vaga volta para todos, para não
   ficar ociosa.
   ========================================================================== */
const { toMinutes, DURACAO_PADRAO } = require('./booking-time');

const PRIORITY_GROUPS = ['idoso', 'gestante', 'pcd', 'lactante'];
const PRIORITY_QUOTA_RATIO = 0.10;
const PRIORITY_RELEASE_HOURS = 24;
const PRIORITY_LABEL = 'atendimento prioritário (Lei 10.048/2000)';
const PRIORITY_MESSAGE =
  `Este horário é reservado para ${PRIORITY_LABEL}. `
  + 'Escolha outro horário ou tente novamente nas 24 horas anteriores.';

// A coluna `users.priority` é ENUM minúsculo; normaliza mesmo assim, para o dado vindo de outra fonte.
const normalizar = (priority) => String(priority || '').trim().toLowerCase();

function isPriorityUser(priority) {
  return PRIORITY_GROUPS.includes(normalizar(priority));
}

/** Posição na fila: grupo da lei = 0, os demais = 1. Para ordenar listas em JavaScript. */
function prioridadeRank(priority) {
  return isPriorityUser(priority) ? 0 : 1;
}

/**
 * Fragmento SQL (com parâmetros) para `ORDER BY`: grupo da lei primeiro. UM lugar para a lista, em vez de
 * `IN ('idoso', 'gestante', ...)` escrito à mão em cada consulta (E-07). O nome da coluna vem do código
 * (nunca de entrada do usuário) e ainda assim é conferido.
 *
 * @example const { sql, params } = ordemPorPrioridadeSql('u.priority');
 *          pool.query(`... ORDER BY ${sql}, w.created_at`, [...outros, ...params])  // params na posição do ORDER BY
 */
function ordemPorPrioridadeSql(coluna) {
  if (typeof coluna !== 'string' || !/^[a-z_]+\.[a-z_]+$/.test(coluna)) {
    throw new Error(`ordemPorPrioridadeSql: coluna inválida (${coluna})`);
  }
  return {
    sql: `CASE WHEN ${coluna} IN (${PRIORITY_GROUPS.map(() => '?').join(', ')}) THEN 0 ELSE 1 END`,
    params: [...PRIORITY_GROUPS],
  };
}

// Nº de vagas protegidas por dia/profissional. `ceil` garante o piso de 10% e
// `max(1)` garante ao menos uma vaga mesmo em agendas curtas.
function quotaPrioritaria(totalSlots) {
  const total = Number(totalSlots) || 0;
  if (total <= 0) return 0;
  return Math.max(1, Math.ceil(total * PRIORITY_QUOTA_RATIO));
}

// Grade do dia: minutos de início únicos e ordenados. Duas agendas
// sobrepostas não podem contar o mesmo horário duas vezes na cota.
function gradeDoDia(rules) {
  const minutos = new Set();
  for (const rule of rules || []) {
    const slot = Number(rule.slot || rule.slot_minutes) || DURACAO_PADRAO;
    const start = Number(rule.start !== undefined ? rule.start : toMinutes(rule.start_time));
    const end = Number(rule.end !== undefined ? rule.end : toMinutes(rule.end_time));
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) continue;
    for (let m = start; m + slot <= end; m += slot) minutos.add(m);
  }
  return [...minutos].sort((a, b) => a - b);
}

// As primeiras N vagas do dia são as reservadas.
function reservasDoDia(rules) {
  const grade = gradeDoDia(rules);
  return new Set(grade.slice(0, quotaPrioritaria(grade.length)));
}

// A reserva vale só até 24 h antes do atendimento; depois, libera para todos.
function slotReservado({ rules, minutesOfDay, slotStartMs, nowMs = Date.now() }) {
  if (!reservasDoDia(rules).has(minutesOfDay)) return false;
  return slotStartMs - nowMs > PRIORITY_RELEASE_HOURS * 3600 * 1000;
}

module.exports = {
  PRIORITY_GROUPS,
  PRIORITY_QUOTA_RATIO,
  PRIORITY_RELEASE_HOURS,
  PRIORITY_MESSAGE,
  isPriorityUser,
  prioridadeRank,
  ordemPorPrioridadeSql,
  quotaPrioritaria,
  gradeDoDia,
  reservasDoDia,
  slotReservado,
};
