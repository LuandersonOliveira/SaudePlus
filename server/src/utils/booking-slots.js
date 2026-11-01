/* ==========================================================================
   Saúde+ — geração dos horários livres de UM dia para UM profissional
   (A1, passo 7a): função PURA.

   Antes, este laço existia duas vezes — em `getAvailability` (um profissional)
   e em `findAvailabilityByService` (todas as unidades) — com os mesmos filtros
   escritos duas vezes. Qualquer ajuste numa regra de vaga precisava lembrar de
   mexer nos dois lugares; agora há um só, testável sem banco.
   ========================================================================== */
const { overlaps, horaDeMinutos, toDateStr } = require('./booking-time');
const { reservasDoDia, PRIORITY_RELEASE_HOURS } = require('./booking-priority');

// Margem mínima para marcar "para hoje": nada que comece nos próximos 30 min.
const MARGEM_HOJE_MS = 30 * 60000;

/**
 * Horários de início livres de um dia, na ordem em que a agenda os gera
 * (por regra de agenda e, dentro dela, crescente).
 *
 * Um início `m` (minutos desde 00:00) só entra se:
 *   1. ainda está no futuro, e — se for hoje — a 30 min ou mais;
 *   2. não é uma vaga reservada à prioridade legal ainda dentro da janela de
 *      24 h (o prioritário enxerga tudo);
 *   3. o atendimento inteiro cabe na regra (`servicoDuracao`, se houver,
 *      vence o slot da agenda para a ocupação);
 *   4. não se sobrepõe a nenhum intervalo ocupado (atendimento ou bloqueio).
 *
 * Pode repetir um mesmo `m` se duas regras de agenda se sobrepõem; quem chama
 * deduplica (Set, Map…).
 *
 * @param {object} p
 * @param {Date} p.day dia (qualquer hora; só a data local importa)
 * @param {Array<{start:number,end:number,slot:number}>} p.rules regras do dia da semana, em minutos
 * @param {number} p.nowMs relógio injetável
 * @param {boolean} [p.prioritario] o paciente é de grupo prioritário
 * @param {number|null} [p.servicoDuracao] duração própria do serviço na unidade
 * @param {Array<{start:number,end:number}>} [p.busy] intervalos ocupados, em ms
 * @returns {Array<{m: number, hora: string, startMs: number}>}
 */
function gerarSlotsDoDia({
  day, rules, nowMs, prioritario = false, servicoDuracao = null, busy = [],
}) {
  const livres = [];
  if (!rules || !rules.length) return livres;

  const isToday = toDateStr(day) === toDateStr(new Date(nowMs));
  const reservadas = prioritario ? new Set() : reservasDoDia(rules);

  for (const rule of rules) {
    for (let m = rule.start; m + rule.slot <= rule.end; m += rule.slot) {
      const slotDate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(m / 60), m % 60, 0, 0);
      const startMs = slotDate.getTime();
      if (startMs <= nowMs) continue;
      if (isToday && startMs < nowMs + MARGEM_HOJE_MS) continue;
      if (reservadas.has(m) && startMs - nowMs > PRIORITY_RELEASE_HOURS * 3600 * 1000) continue;
      const ocupacao = servicoDuracao || rule.slot;
      if (m + ocupacao > rule.end) continue;
      const endMs = startMs + ocupacao * 60000;
      if (busy.some((iv) => overlaps(startMs, endMs, iv.start, iv.end))) continue;
      livres.push({ m, hora: horaDeMinutos(m), startMs });
    }
  }
  return livres;
}

module.exports = { gerarSlotsDoDia, MARGEM_HOJE_MS };
