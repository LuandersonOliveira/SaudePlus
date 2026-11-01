/* ==========================================================================
   Saúde+ — tempo e duração do agendamento: funções PURAS (A1, passo 7a).

   Nada aqui toca em banco. É o vocabulário que as regras de agenda usam:
   parse de data/hora, janela permitida, sobreposição de intervalos, duração
   assumida e o encaixe de um horário na agenda do profissional.
   ========================================================================== */
const { localDateStr } = require('./local-date');

const MAX_DAYS_AHEAD = 366;

// Janela devolvida por requisição nas rotas de disponibilidade. A agenda pode
// ir até MAX_DAYS_AHEAD, mas o painel pagina de 30 em 30 dias: uma resposta
// única de um ano inteiro multiplica consultas e slots sem uso real.
const AVAILABILITY_PAGE_DAYS = 30;

// Duração assumida para registro que não tem `duration_minutes` gravado
// (agendamento anterior à coluna, ou serviço sem profissional alocado).
// Ignorar essas linhas seria pior: permitiria sobreposição.
const DURACAO_PADRAO = 30;

/**
 * Normaliza a janela pedida pela rota: `days` nunca passa de 30 e `offsetDays`
 * nunca ultrapassa o fim da janela de 1 ano. É a única fonte de verdade para
 * catálogo e slot — antes cada rota repetia seu próprio `clamp` (30/60),
 * enquanto o agendamento aceitava 366 dias.
 */
function resolveAvailabilityWindow({ days, offsetDays } = {}) {
  const pedido = Number.parseInt(days, 10);
  const span = Number.isFinite(pedido)
    ? Math.min(Math.max(pedido, 1), AVAILABILITY_PAGE_DAYS)
    : AVAILABILITY_PAGE_DAYS;
  const maxOffset = Math.max(MAX_DAYS_AHEAD - span, 0);
  const pedidoOffset = Number.parseInt(offsetDays, 10);
  const offset = Number.isFinite(pedidoOffset)
    ? Math.min(Math.max(pedidoOffset, 0), maxOffset)
    : 0;
  return { days: span, offsetDays: offset };
}

function parseDateTime(value) {
  if (!value || typeof value !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const d = new Date(value.trim().replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}

function pad(n) { return String(n).padStart(2, '0'); }

function toDateStr(d) {
  return localDateStr(d);
}

function toMinutes(hhmm) {
  // '08:00:00' ou '08:00' -> 480
  const parts = String(hhmm || '').split(':');
  if (parts.length < 2) return null;
  return Number(parts[0]) * 60 + Number(parts[1]);
}

/** 480 -> '08:00' */
function horaDeMinutos(m) {
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// Erro (string) ou null quando a data está dentro da janela permitida.
function validateScheduleWindow(value) {
  const d = parseDateTime(value);
  if (!d) return 'Informe uma data e horário válidos.';
  const now = Date.now();
  if (d.getTime() <= now) return 'Não é permitido agendar em data passada.';
  if (d.getTime() > now + MAX_DAYS_AHEAD * 24 * 3600 * 1000) {
    return 'Não é permitido agendar com mais de 1 ano de antecedência.';
  }
  return null;
}

// Minutos ocupados por um registro, com a constante como reserva para o
// legado. A duração é do AGENDAMENTO, não da agenda atual: se o admin mudar
// o slot_minutes amanhã, o que foi marcado hoje não muda de significado.
function duracaoDe(row) {
  const d = Number(row.duration_minutes);
  return Number.isFinite(d) && d > 0 ? d : DURACAO_PADRAO;
}

/**
 * Localiza o `work_schedules` que casa com o horário pedido e devolve a
 * duração do atendimento.
 *
 * Com DUAS agendas sobrepostas no mesmo dia, o horário pode ser candidato de
 * ambas; a primeira que casa define a duração. É a mesma regra que o
 * chamador usava — agora ela é uma função só, e é usada tanto para validar
 * o candidato quanto para gravar a duração no agendamento.
 *
 * @returns {{slot: number, duration: number, start: number, end: number}|null}
 */
function schedulePara(schedules, when, duracaoServico) {
  const minutesOfDay = when.getHours() * 60 + when.getMinutes();
  const duracao = Number(duracaoServico) > 0 ? Number(duracaoServico) : null;
  for (const s of schedules) {
    const start = toMinutes(s.start_time);
    const end = toMinutes(s.end_time);
    const slotMin = Number(s.slot_minutes) || 30;
    const ocupacao = duracao || slotMin;
    if (start === null || end === null) continue;
    if (minutesOfDay >= start && minutesOfDay + ocupacao <= end && (minutesOfDay - start) % slotMin === 0) {
      return { slot: slotMin, duration: ocupacao, start, end };
    }
  }
  return null;
}

module.exports = {
  MAX_DAYS_AHEAD,
  AVAILABILITY_PAGE_DAYS,
  DURACAO_PADRAO,
  resolveAvailabilityWindow,
  parseDateTime,
  pad,
  toDateStr,
  toMinutes,
  horaDeMinutos,
  overlaps,
  validateScheduleWindow,
  duracaoDe,
  schedulePara,
};
