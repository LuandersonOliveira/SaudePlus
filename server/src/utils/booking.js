/* ==========================================================================
   Saúde+ — Regras de agendamento validadas NO SERVIDOR
   (TAREFAS V3, itens 4.5 e 6.2)

   - Janela de data: nada no passado, nada além de 1 ano.
   - Unidade precisa existir e estar ativa.
   - Serviço cadastrado na unidade exige profissional vinculado.
   - Profissional precisa estar ativo, vinculado à unidade e habilitado
     para aquele serviço, atender no dia/horário e não ter conflito.
   ========================================================================== */

const {
  BOOKING_STATUS,
  validateOutcome,
  validateRescheduleReason,
} = require('./booking-status');
const { localDateStr } = require('./local-date');
const { registrarEvento } = require('../services/booking-events');

const KINDS = ['consulta', 'exame'];
const MAX_DAYS_AHEAD = 366;

// Janela devolvida por requisição nas rotas de disponibilidade. A agenda pode
// ir até MAX_DAYS_AHEAD, mas o painel pagina de 30 em 30 dias: uma resposta
// única de um ano inteiro multiplica consultas e slots sem uso real.
const AVAILABILITY_PAGE_DAYS = 30;

// NV02 — prioridade legal (Lei 10.048/2000). O campo `users.priority` já
// existia, mas não alterava a oferta de vagas. Regra acordada: 10% das vagas
// de cada dia/profissional (mínimo 1) ficam reservadas para idoso, gestante,
// PCD e lactante. A reserva vale até 24 h antes do atendimento; depois disso
// a vaga volta para todos, para não ficar ociosa.
const PRIORITY_GROUPS = ['idoso', 'gestante', 'pcd', 'lactante'];
const PRIORITY_QUOTA_RATIO = 0.10;
const PRIORITY_RELEASE_HOURS = 24;
const PRIORITY_LABEL = 'atendimento prioritário (Lei 10.048/2000)';
const PRIORITY_MESSAGE =
  `Este horário é reservado para ${PRIORITY_LABEL}. `
  + 'Escolha outro horário ou tente novamente nas 24 horas anteriores.';

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

// Fase 1 (item 3): mapa único tipo -> tabela/colunas, para consultas e exames
// compartilharem a mesma validação. Parâmetro `tipo` ('consulta'|'exame');
// `kind` legado continua aceito via resolveTipo().
const TIPOS = {
  consulta: { table: 'appointments', serviceColumn: 'specialty', entityType: 'appointment' },
  exame: { table: 'exams', serviceColumn: 'exam_type', entityType: 'exam' },
};

function resolveTipo(opts) {
  const t = (opts && (opts.tipo || opts.kind)) || '';
  return TIPOS[t] ? t : null;
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

function isPriorityUser(priority) {
  return PRIORITY_GROUPS.includes(String(priority || ''));
}

async function prioridadeDoUsuario(pool, userId) {
  if (!userId) return null;
  const [rows] = await pool.query('SELECT priority FROM users WHERE id = ?', [userId]);
  return rows.length ? rows[0].priority : null;
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

// Duração assumida para registro que não tem `duration_minutes` gravado
// (agendamento anterior à migration 007, ou serviço sem profissional
// alocado). Ignorar essas linhas seria pior: permitiria sobreposição.
const DURACAO_PADRAO = 30;

// Minutos ocupados por um registro, com a constante como reserva para o
// legado. A duração é do AGENDAMENTO, não da agenda atual: se o admin mudar
// o slot_minutes amanhã, o que foi marcado hoje não muda de significado.
function duracaoDe(row) {
  const d = Number(row.duration_minutes);
  return Number.isFinite(d) && d > 0 ? d : DURACAO_PADRAO;
}

async function fetchBusyIntervals(pool, professionalId, fromStr, toStr, excludeId) {
  const intervals = [];
  for (const table of ['appointments', 'exams']) {
    const [rows] = await pool.query(
      `SELECT id, scheduled_at, duration_minutes FROM ${table}
       WHERE professional_id = ? AND status IN ('pendente', 'confirmado')
         AND scheduled_at BETWEEN ? AND ?`,
      [professionalId, `${fromStr} 00:00:00`, `${toStr} 23:59:59`]
    );
    for (const row of rows) {
      if (excludeId && row.id === excludeId) continue;
      const start = parseDateTime(row.scheduled_at);
      if (start) intervals.push({ start: start.getTime(), end: start.getTime() + duracaoDe(row) * 60000 });
    }
  }
  const [blocks] = await pool.query(
    `SELECT starts_at, ends_at FROM schedule_blocks
     WHERE professional_id = ? AND starts_at <= ? AND ends_at >= ?`,
    [professionalId, `${toStr} 23:59:59`, `${fromStr} 00:00:00`]
  );
  for (const row of blocks) {
    const start = parseDateTime(row.starts_at);
    const end = parseDateTime(row.ends_at);
    if (start && end) intervals.push({ start: start.getTime(), end: end.getTime() });
  }
  return intervals;
}

// Versão em lote (Fase 1, item 1): carrega os intervalos ocupados de vários
// profissionais com 3 queries no total — usada pelo /catalog/slots, que
// agrega todas as unidades de uma vez.
async function fetchBusyIntervalsBulk(pool, professionalIds, fromStr, toStr, excludeId) {
  const byProf = new Map();
  const ids = [...new Set((professionalIds || []).filter(Boolean))];
  if (!ids.length) return byProf;
  const ensure = (id) => {
    if (!byProf.has(id)) byProf.set(id, []);
    return byProf.get(id);
  };

  for (const table of ['appointments', 'exams']) {
    const [rows] = await pool.query(
      `SELECT professional_id, id, scheduled_at, duration_minutes FROM ${table}
       WHERE professional_id IN (?) AND status IN ('pendente', 'confirmado')
         AND scheduled_at BETWEEN ? AND ?`,
      [ids, `${fromStr} 00:00:00`, `${toStr} 23:59:59`]
    );
    for (const row of rows) {
      if (excludeId && row.id === excludeId) continue;
      const start = parseDateTime(row.scheduled_at);
      if (start) ensure(row.professional_id).push({ start: start.getTime(), end: start.getTime() + duracaoDe(row) * 60000 });
    }
  }
  const [blocks] = await pool.query(
    `SELECT professional_id, starts_at, ends_at FROM schedule_blocks
     WHERE professional_id IN (?) AND starts_at <= ? AND ends_at >= ?`,
    [ids, `${toStr} 23:59:59`, `${fromStr} 00:00:00`]
  );
  for (const row of blocks) {
    const start = parseDateTime(row.starts_at);
    const end = parseDateTime(row.ends_at);
    if (start && end) ensure(row.professional_id).push({ start: start.getTime(), end: end.getTime() });
  }
  return byProf;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/*
 * Valida uma criação/edição de agendamento.
 * Retorna string de erro ou null quando liberado.
 *
 * opts = {
 *   tipo: 'consulta' | 'exame' (ou `kind` legado),
 *   unitId, professionalId (pode ser null p/ serviço "Outro"),
 *   serviceName, scheduledAt, excludeId (registro em edição)
 * }
 */
/**
 * Localiza o `work_schedules` que casa com o horário pedido e devolve a
 * duração do atendimento.
 *
 * Com DUAS agendas sobrepostas no mesmo dia, o horário pode ser candidato de
 * ambas; a primeira que casa define a duração. É a mesma regra que o
 * chamador usava — agora ela é uma função só, e é usada tanto para validar
 * o candidato quanto para gravar a duração no agendamento.
 *
 * @returns {{slot: number, start: number, end: number}|null}
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

async function agendasDoDia(pool, professionalId, unitId, when) {
  const [rows] = await pool.query(
    `SELECT start_time, end_time, slot_minutes FROM work_schedules
     WHERE professional_id = ? AND unit_id = ? AND weekday = ? AND active = 1`,
    [professionalId, unitId, when.getDay()]
  );
  return rows;
}

/**
 * Dura��o declarada pelo servi�o na unidade. NULL significa "use o slot da
 * agenda" - o comportamento hist�rico. A duracao do servico tem prioridade
 * sobre o slot, mas o horario ainda precisa cair na grade.
 */
async function duracaoServico(pool, { unitId, serviceName, tipo }) {
  if (!unitId || !serviceName || !tipo) return null;
  const [[row]] = await pool.query(
    `SELECT duration_minutes FROM unit_offers
     WHERE unit_id = ? AND kind = ? AND name = ? AND active = 1`,
    [unitId, tipo, serviceName]
  );
  const d = Number(row && row.duration_minutes);
  return Number.isFinite(d) && d > 0 ? d : null;
}

/**
 * Dura��o, em minutos, do atendimento que seria marcado neste hor�rio.
 *
 * Servi�o sem profissional alocado n�o tem agenda: a unidade decide depois, e
 * 30 min � o padr�o hist�rico. Servi�o com dura��o pr�pria vence o slot.
 */
async function duracaoMinutos(pool, { unitId, professionalId, serviceName, tipo, scheduledAt }) {
  if (!professionalId) return DURACAO_PADRAO;
  const when = parseDateTime(scheduledAt);
  if (!when) return DURACAO_PADRAO;
  const servico = await duracaoServico(pool, { unitId, serviceName, tipo });
  const casa = schedulePara(await agendasDoDia(pool, professionalId, unitId, when), when, servico);
  return casa ? casa.duration : DURACAO_PADRAO;
}

/**
 * Trava utente e profissional na MESMA ordem em todas as requisições.
 * Sem isso, A agenda o profissional X do utente 1 enquanto B agenda o
 * profissional Y do utente 2: nenhuma das duas vê a outra e as duas passam.
 * A ordenação por id elimina o ciclo clássico de deadlock.
 */
async function lockBookingActors(db, { userId, professionalId }) {
  const alvos = [];
  if (userId) alvos.push({ id: userId, tabela: 'users' });
  if (professionalId) alvos.push({ id: professionalId, tabela: 'professionals' });
  alvos.sort((a, b) => (a.id === b.id ? a.tabela.localeCompare(b.tabela) : a.id.localeCompare(b.id)));
  for (const alvo of alvos) {
    await db.query(`SELECT id FROM ${alvo.tabela} WHERE id = ? FOR UPDATE`, [alvo.id]);
  }
}

async function validateUserOverlap(pool, { userId, scheduledAt, durationMinutes, excludeId }) {
  if (!userId) return null;
  const when = parseDateTime(scheduledAt);
  if (!when) return null;
  const duracao = Number(durationMinutes) > 0 ? Number(durationMinutes) : DURACAO_PADRAO;
  const startMs = when.getTime();
  const endMs = startMs + duracao * 60000;
  const from = toDateStr(new Date(startMs - 24 * 3600 * 1000));
  const to = toDateStr(new Date(endMs + 24 * 3600 * 1000));

  for (const table of ['appointments', 'exams']) {
    const [rows] = await pool.query(
      `SELECT id, scheduled_at, duration_minutes FROM ${table}
       WHERE user_id = ? AND status IN ('pendente', 'confirmado')
         AND scheduled_at BETWEEN ? AND ?`,
      [userId, `${from} 00:00:00`, `${to} 23:59:59`]
    );
    for (const row of rows) {
      if (excludeId && row.id === excludeId) continue;
      const inicio = parseDateTime(row.scheduled_at);
      if (!inicio) continue;
      const fim = inicio.getTime() + duracaoDe(row) * 60000;
      if (overlaps(startMs, endMs, inicio.getTime(), fim)) {
        return 'Este utente já tem outro atendimento neste horário.';
      }
    }
  }
  return null;
}

async function validateBooking(pool, opts) {
  const { unitId, professionalId, serviceName, scheduledAt, excludeId } = opts;
  const tipo = resolveTipo(opts);
  if (!tipo) return 'Tipo de atendimento inválido.';

  const windowError = validateScheduleWindow(scheduledAt);
  if (windowError) return windowError;

  if (!unitId) return 'Selecione a unidade de saúde.';
  const [[unit]] = await pool.query('SELECT id, active FROM health_units WHERE id = ?', [unitId]);
  if (!unit) return 'Unidade de saúde não encontrada.';
  if (!Number(unit.active)) return 'Esta unidade de saúde está inativada.';

  // Serviço já cadastrado pela unidade?
  const [offers] = await pool.query(
    'SELECT id FROM unit_offers WHERE unit_id = ? AND kind = ? AND name = ? AND active = 1',
    [unitId, tipo, serviceName || '']
  );
  const isRegisteredOffer = offers.length > 0;

  if (!professionalId) {
    // Serviço "Outro"/personalizado: a unidade aloca o atendimento depois.
    if (isRegisteredOffer) return 'Selecione um profissional para este atendimento.';
    return null;
  }

  const [[prof]] = await pool.query('SELECT id, active FROM professionals WHERE id = ?', [professionalId]);
  if (!prof) return 'Profissional não encontrado.';
  if (!Number(prof.active)) return 'Este profissional está inativo.';
  if (!isRegisteredOffer) {
    return 'Este serviço não está vinculado à unidade escolhida.';
  }

  const [links] = await pool.query(
    'SELECT id FROM professional_offers WHERE professional_id = ? AND unit_id = ? AND kind = ? AND name = ?',
    [professionalId, unitId, tipo, serviceName]
  );
  if (!links.length) return 'Este profissional não atende este serviço nesta unidade.';

  const when = parseDateTime(scheduledAt);
  if (!when) return 'Informe uma data e horário válidos.';
  const servicoDuracao = await duracaoServico(pool, { unitId, serviceName, tipo });
  const schedules = await agendasDoDia(pool, professionalId, unitId, when);
  const casa = schedulePara(schedules, when, servicoDuracao);
  if (!casa) return 'O profissional não atende neste dia e horário.';

  // NV02: fora da janela de liberação, não-priority não ocupa vaga reservada.
  // O front esconde essas vagas, mas a checagem fica no servidor porque o
  // POST/PUT pode ser chamado direto.
  //
  // Editar o próprio registro sem mudar de horário não pode ser barrado: um
  // agendamento anterior ao NV02 pode estar numa vaga que agora é reservada.
  const atual = opts.currentScheduledAt ? parseDateTime(opts.currentScheduledAt) : null;
  const jaEraNesteHorario = atual ? atual.getTime() === when.getTime() : false;
  if (!jaEraNesteHorario && !isPriorityUser(opts.userPriority)) {
    const minutesOfDay = when.getHours() * 60 + when.getMinutes();
    if (slotReservado({ rules: schedules, minutesOfDay, slotStartMs: when.getTime() })) {
      return PRIORITY_MESSAGE;
    }
  }

  const slot = casa.duration;

  const dateStr = toDateStr(when);
  const intervals = await fetchBusyIntervals(pool, professionalId, dateStr, dateStr, excludeId);
  const startMs = when.getTime();
  const endMs = startMs + slot * 60000;
  for (const iv of intervals) {
    if (overlaps(startMs, endMs, iv.start, iv.end)) {
      return 'Este horário já está ocupado para este profissional.';
    }
  }

  const conflitoUsuario = await validateUserOverlap(pool, {
    userId: opts.userId,
    scheduledAt,
    durationMinutes: slot,
    excludeId,
  });
  if (conflitoUsuario) return conflitoUsuario;

  return null;
}

/*
 * Disponibilidade em um intervalo de dias (usado pelo painel do paciente).
 * Retorna { days: [{ date, slots: ['08:00', ...] }], reason }
 * days cobre apenas dias com pelo menos 1 horário livre.
 */
async function getAvailability(pool, opts) {
  const { unitId, professionalId, serviceName, fromDate, days = 30, excludeId } = opts;
  const tipo = resolveTipo(opts);
  const prioritario = isPriorityUser(opts.userPriority);
  const empty = { days: [], reason: 'Nenhum horário disponível no momento.' };

  if (!unitId || !professionalId || !tipo) return empty;

  const [[unit]] = await pool.query('SELECT active FROM health_units WHERE id = ?', [unitId]);
  if (!unit || !Number(unit.active)) {
    return { days: [], reason: 'A unidade escolhida está inativada.' };
  }

  const [[prof]] = await pool.query('SELECT active FROM professionals WHERE id = ?', [professionalId]);
  if (!prof || !Number(prof.active)) {
    return { days: [], reason: 'O profissional escolhido está inativo.' };
  }

  const [links] = await pool.query(
    'SELECT id FROM professional_offers WHERE professional_id = ? AND unit_id = ? AND kind = ? AND name = ?',
    [professionalId, unitId, tipo, serviceName || '']
  );
  if (!links.length) {
    return { days: [], reason: 'Este profissional não atende este serviço nesta unidade.' };
  }
  const servicoDuracao = await duracaoServico(pool, { unitId, serviceName, tipo });

  const [schedules] = await pool.query(
    `SELECT weekday, start_time, end_time, slot_minutes FROM work_schedules
     WHERE professional_id = ? AND unit_id = ? AND active = 1`,
    [professionalId, unitId]
  );
  if (!schedules.length) {
    return { days: [], reason: 'Este profissional ainda não tem horários cadastrados nesta unidade.' };
  }

  const start = new Date(fromDate + 'T00:00:00');
  if (isNaN(start.getTime())) return empty;
  const rangeEnd = new Date(start.getTime() + (days - 1) * 24 * 3600 * 1000);
  const intervals = await fetchBusyIntervals(
    pool, professionalId, toDateStr(start), toDateStr(rangeEnd), excludeId
  );

  const nowMs = Date.now();
  const byWeekday = {};
  for (const s of schedules) {
    const st = toMinutes(s.start_time);
    const en = toMinutes(s.end_time);
    if (st === null || en === null || st >= en) continue;
    (byWeekday[s.weekday] = byWeekday[s.weekday] || []).push({
      start: st, end: en, slot: Number(s.slot_minutes) || 30,
    });
  }

  const result = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(start.getTime() + i * 24 * 3600 * 1000);
    const rules = byWeekday[day.getDay()];
    if (!rules) continue;

    const dateStr = toDateStr(day);
    const isToday = dateStr === toDateStr(new Date());
    const reservadas = prioritario ? new Set() : reservasDoDia(rules);
    const slots = new Set();
    for (const rule of rules) {
      for (let m = rule.start; m + rule.slot <= rule.end; m += rule.slot) {
        const slotDate = new Date(
          day.getFullYear(), day.getMonth(), day.getDate(),
          Math.floor(m / 60), m % 60, 0, 0
        );
        if (slotDate.getTime() <= nowMs) continue;
        if (isToday && slotDate.getTime() < nowMs + 30 * 60000) continue;
        if (reservadas.has(m)
          && slotDate.getTime() - nowMs > PRIORITY_RELEASE_HOURS * 3600 * 1000) continue;
        const ocupacao = servicoDuracao || rule.slot;
        if (m + ocupacao > rule.end) continue;
        const slotEnd = slotDate.getTime() + ocupacao * 60000;
        const busy = intervals.some(iv => overlaps(slotDate.getTime(), slotEnd, iv.start, iv.end));
        if (!busy) slots.add(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
      }
    }
    if (slots.size) result.push({ date: dateStr, slots: Array.from(slots).sort() });
  }

  if (!result.length) {
    return {
      days: [],
      reason: days
        ? 'Nenhum horário livre nos próximos dias. Tente outra unidade ou profissional.'
        : 'Nenhum horário livre.',
    };
  }
  return { days: result, reason: null };
}

/*
 * Vagas livres por SERVIÇO em todas as unidades (Fase 1, item 1).
 * Recebe o `tipo` ('consulta'|'exame') e o nome exato do serviço, e devolve
 * SÓ unidades/dias com pelo menos 1 horário livre de verdade (conflitos de
 * 30 min e bloqueios já removidos).
 *
 * opts = { tipo, servico (ou serviceName), fromDate 'YYYY-MM-DD', days, excludeId }
 * Retorna { tipo, name, days, totalVagas, unidades: [{ id, name, type,
 * neighborhood, totalVagas, dias: [{ date, slots: [{ hora, professional_id,
 * professional_name, job_title }] }] }], reason }
 */
async function findAvailabilityByService(pool, opts) {
  const tipo = resolveTipo(opts);
  const servico = String((opts && (opts.servico || opts.serviceName)) || '').trim();
  const days = Math.min(
    Math.max(parseInt(opts && opts.days, 10) || AVAILABILITY_PAGE_DAYS, 1),
    AVAILABILITY_PAGE_DAYS
  );
  const prioritario = isPriorityUser(opts && opts.userPriority);
  const empty = { tipo: tipo || null, name: servico, days, totalVagas: 0, unidades: [], reason: 'Nenhum horário disponível no momento.' };
  if (!tipo || !servico) return { ...empty, reason: 'Informe o tipo e o nome do serviço.' };

  const start = new Date((opts && opts.fromDate ? opts.fromDate : '') + 'T00:00:00');
  if (isNaN(start.getTime())) return empty;
  const rangeEnd = new Date(start.getTime() + (days - 1) * 24 * 3600 * 1000);
  const fromStr = toDateStr(start);
  const toStr = toDateStr(rangeEnd);

  // 1) unidades ativas que oferecem o serviço
  const [unitRows] = await pool.query(
    `SELECT u.id, u.name, u.type, u.neighborhood
     FROM health_units u
     JOIN unit_offers o ON o.unit_id = u.id
     WHERE o.kind = ? AND o.name = ? AND o.active = 1 AND u.active = 1
     ORDER BY u.name`,
    [tipo, servico]
  );
  if (!unitRows.length) {
    return { ...empty, reason: 'Nenhuma unidade oferece este serviço no momento.' };
  }
  const unitIds = unitRows.map((u) => u.id);
  const [offerDurationRows] = await pool.query(
    `SELECT unit_id, duration_minutes FROM unit_offers
     WHERE kind = ? AND name = ? AND active = 1 AND unit_id IN (?)`,
    [tipo, servico, unitIds]
  );
  const duracaoPorUnidade = new Map(
    offerDurationRows
      .filter((row) => Number(row.duration_minutes) > 0)
      .map((row) => [row.unit_id, Number(row.duration_minutes)])
  );

  // 2) profissionais ativos vinculados ao serviço nessas unidades
  const [linkRows] = await pool.query(
    `SELECT po.unit_id, po.professional_id, p.name AS professional_name, p.job_title
     FROM professional_offers po
     JOIN professionals p ON p.id = po.professional_id
     WHERE po.kind = ? AND po.name = ? AND p.active = 1 AND po.unit_id IN (?)
     ORDER BY p.name`,
    [tipo, servico, unitIds]
  );
  if (!linkRows.length) {
    return { ...empty, reason: 'Nenhum profissional atende este serviço no momento.' };
  }

  // 3) horários desses vínculos (1 query)
  //
  // O filtro é pelo PAR (profissional, unidade), não só pelo profissional.
  // Filtrar por professional_id IN (...) já exclui quem não tem nenhum
  // vínculo, mas deixa passar o caso em que o profissional atende o serviço
  // na unidade A e tem work_schedule na unidade B: o par (B, prof) entrava na
  // grade sem existir em professional_offers, saía com nome vazio (o fallback
  // `{ name: '', job: '' }`) e o POST devolvia 409 — "não atende este serviço
  // nesta unidade". Ou seja, a tela oferecia horários que nunca funcionavam.
  const profIds = [...new Set(linkRows.map((l) => l.professional_id))];
  const [schedRows] = await pool.query(
    `SELECT ws.professional_id, ws.unit_id, ws.weekday, ws.start_time, ws.end_time, ws.slot_minutes
     FROM work_schedules ws
     WHERE ws.active = 1
       AND EXISTS (
         SELECT 1 FROM professional_offers po
          WHERE po.professional_id = ws.professional_id
            AND po.unit_id = ws.unit_id
            AND po.kind = ? AND po.name = ?
       )`,
    [tipo, servico]
  );
  const rulesByPair = new Map();
  for (const s of schedRows) {
    const st = toMinutes(s.start_time);
    const en = toMinutes(s.end_time);
    if (st === null || en === null || st >= en) continue;
    const key = `${s.unit_id}||${s.professional_id}`;
    if (!rulesByPair.has(key)) rulesByPair.set(key, {});
    const byWd = rulesByPair.get(key);
    (byWd[s.weekday] = byWd[s.weekday] || []).push({ start: st, end: en, slot: Number(s.slot_minutes) || 30 });
  }
  if (!rulesByPair.size) {
    return { ...empty, reason: 'Este serviço ainda não tem horários cadastrados nas unidades.' };
  }

  const profByPair = new Map();
  for (const l of linkRows) {
    profByPair.set(`${l.unit_id}||${l.professional_id}`, { name: l.professional_name, job: l.job_title });
  }

  // Ordenação determinística: mesmo horário livre em 2 profissionais,
  // o primeiro em ordem alfabética vence (o POST valida o mesmo vínculo).
  // Sem o fallback `{ name: '' }`: um par sem profByPair é, por construção,
  // um par que o POST rejeitaria, então ele não vira vaga.
  const pairs = [];
  for (const [key, byWd] of rulesByPair) {
    const prof = profByPair.get(key);
    if (!prof) continue;
    const sep = key.lastIndexOf('||');
    pairs.push({
      unitId: key.slice(0, sep),
      profId: key.slice(sep + 2),
      byWd,
      prof,
    });
  }
  pairs.sort((a, b) => (a.prof.name < b.prof.name ? -1 : a.prof.name > b.prof.name ? 1 : 0));

  // 4) ocupados em lote (1 query por tabela + 1 de bloqueios)
  const busyByProf = await fetchBusyIntervalsBulk(pool, profIds, fromStr, toStr, (opts && opts.excludeId) || null);

  // 5) grade por unidade
  const nowMs = Date.now();
  const todayStr = toDateStr(new Date());
  const unitDays = new Map();
  for (const { unitId, profId, byWd, prof } of pairs) {
    const busy = busyByProf.get(profId) || [];
    const servicoDuracao = duracaoPorUnidade.get(unitId) || null;
    for (let i = 0; i < days; i++) {
      const day = new Date(start.getTime() + i * 24 * 3600 * 1000);
      const rules = byWd[day.getDay()];
      if (!rules) continue;
      const dateStr = toDateStr(day);
      const isToday = dateStr === todayStr;
      const reservadas = prioritario ? new Set() : reservasDoDia(rules);
      for (const rule of rules) {
        for (let m = rule.start; m + rule.slot <= rule.end; m += rule.slot) {
          const slotDate = new Date(
            day.getFullYear(), day.getMonth(), day.getDate(),
            Math.floor(m / 60), m % 60, 0, 0
          );
          if (slotDate.getTime() <= nowMs) continue;
          if (isToday && slotDate.getTime() < nowMs + 30 * 60000) continue;
          if (reservadas.has(m)
            && slotDate.getTime() - nowMs > PRIORITY_RELEASE_HOURS * 3600 * 1000) continue;
          const ocupacao = servicoDuracao || rule.slot;
          if (m + ocupacao > rule.end) continue;
          const slotEnd = slotDate.getTime() + ocupacao * 60000;
          if (busy.some((iv) => iv.start < slotEnd && iv.end > slotDate.getTime())) continue;
          const hora = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
          if (!unitDays.has(unitId)) unitDays.set(unitId, new Map());
          const dayMap = unitDays.get(unitId);
          if (!dayMap.has(dateStr)) dayMap.set(dateStr, new Map());
          const slotMap = dayMap.get(dateStr);

          // TODOS os profissionais livres nesta hora entram na lista.
          //
          // A versão anterior guardava só o primeiro (ordem alfabética) e
          // descartava os demais em silêncio. Como o front envia o
          // `professional_id` que foi exibido, o cenário era: Ana e Beto
          // livres às 09:00, aparece só a Ana; alguém ocupa a Ana; o POST
          // valida a Ana e devolve 409 — mesmo com o Beto livre, que a tela
          // nunca mostrou. O usuário ficava sem saída.
          const disponivel = {
            id: profId,
            professional_id: profId,
            name: prof.name,
            professional_name: prof.name,
            job_title: prof.job,
          };

          const jaExiste = slotMap.get(hora);
          if (!jaExiste) {
            // Primeiro profissional: preenche também os campos legados, que
            // continuam sendo o que o front usa por padrão.
            slotMap.set(hora, {
              hora,
              professional_id: profId,
              professional_name: prof.name,
              job_title: prof.job,
              professionals: [disponivel],
            });
          } else if (!jaExiste.professionals.some((p) => p.id === profId)) {
            jaExiste.professionals.push(disponivel);
          }
        }
      }
    }
  }

  const unidades = [];
  let totalVagas = 0;
  for (const u of unitRows) {
    const dayMap = unitDays.get(u.id);
    if (!dayMap || !dayMap.size) continue;
    const dias = [];
    for (const date of [...dayMap.keys()].sort()) {
      const slots = [...dayMap.get(date).values()].sort((a, b) => (a.hora < b.hora ? -1 : 1));
      if (!slots.length) continue;
      dias.push({ date, slots });
      totalVagas += slots.length;
    }
    if (!dias.length) continue;
    unidades.push({
      id: u.id,
      name: u.name,
      type: u.type,
      neighborhood: u.neighborhood,
      totalVagas: dias.reduce((n, d) => n + d.slots.length, 0),
      dias,
    });
  }

  if (!unidades.length) {
    return { ...empty, reason: 'Nenhuma vaga livre nos próximos dias. Tente outro serviço ou volte depois.' };
  }
  return { tipo, name: servico, days, totalVagas, unidades, reason: null };
}

/*
 * Alteração de status/reagendamento por staff/admin (Fase 2, item 3).
 * Mesma lógica do PATCH /:kind/:id de staff.routes e admin.routes.
 * Não grava auditoria (Fase 3, item 2); devolve os dados para a rota registrar.
 *
 * opts = { kindKey: 'appointments'|'exams', id, body: {status, scheduled_at} }
 * Retorna { status, body } e, em sucesso, { audit: { entityType, details } }.
 */
async function applyBookingChange(db, opts) {
  const ownsConnection = typeof db.getConnection === 'function';
  const conn = ownsConnection ? await db.getConnection() : db;
  const meta = opts.kindKey === 'appointments'
    ? { table: 'appointments', tipo: 'consulta', serviceColumn: 'specialty', entityType: 'appointment', kind: 'consulta' }
    : opts.kindKey === 'exams'
      ? { table: 'exams', tipo: 'exame', serviceColumn: 'exam_type', entityType: 'exam', kind: 'exame' }
      : null;

  const run = async (c) => {
    if (!meta) return { status: 404, body: { error: 'Tipo inválido.' } };
    const body = (opts && opts.body) || {};
    const { status, scheduled_at } = body;
    const temOutcome = Object.prototype.hasOwnProperty.call(body, 'outcome');
    const temMotivo = Object.prototype.hasOwnProperty.call(body, 'reschedule_reason');
    const updates = [];
    const params = [];
    const logParts = [];

    if (status !== undefined) {
      if (!BOOKING_STATUS.includes(status)) {
        return { status: 400, body: { error: 'Status inválido.' } };
      }
      updates.push('status=?'); params.push(status); logParts.push(`status -> ${status}`);
    }
    if (temOutcome) {
      const outcomeError = validateOutcome(body.outcome);
      if (outcomeError) return { status: 400, body: { error: outcomeError } };
      const outcome = body.outcome ? String(body.outcome).trim() : null;
      updates.push('outcome=?'); params.push(outcome);
      logParts.push(`desfecho -> ${outcome || 'limpo'}`);
    }

    const motivoFoiInformado = temMotivo;
    let reason = temMotivo
      ? (body.reschedule_reason ? String(body.reschedule_reason).trim() : null)
      : null;
    if (reason === null && (opts.autoReason || opts.defaultReason)) {
      reason = opts.autoReason || opts.defaultReason;
    }
    if (temMotivo || reason !== null) {
      // Motivo só entra como coluna quando o chamador o enviou ou há default.
      if (temMotivo || (opts.autoReason || opts.defaultReason)) {
        const reasonError = validateRescheduleReason(reason, {
          required: false,
        });
        if (reasonError) return { status: 400, body: { error: reasonError } };
      }
    }

    if (scheduled_at) {
      const windowError = validateScheduleWindow(scheduled_at);
      if (windowError) return { status: 400, body: { error: windowError } };
      updates.push('scheduled_at=?'); params.push(scheduled_at);
      logParts.push(`reagendado para ${scheduled_at}`);
    }

    // Motivo obrigatório ao reagendar (salvo quando há default/paciente). A
    // exigência real depende do horário mudar de fato; uma gravação no mesmo
    // horário (salvar sem mudar) não precisa de justificativa.
    const motivoObrigatorio = opts.reasonRequired !== undefined
      ? opts.reasonRequired
      : !opts.autoReason && !opts.defaultReason;

    // Coluna reschedule_reason: atualiza se motivo foi enviado ou há default.
    if (temMotivo || (opts.defaultReason || opts.autoReason)) {
      updates.push('reschedule_reason=?'); params.push(reason);
      logParts.push(reason ? `motivo -> ${reason}` : 'motivo -> limpo');
    }

    if (!updates.length) return { status: 400, body: { error: 'Nada para atualizar.' } };

    // Leitura/travamento do registro ATUAL antes da validação, para evitar
    // corrida com outro reagendamento do mesmo item ou do mesmo utente.
    const [[before]] = await c.query(
      `SELECT id, status, scheduled_at, professional_id, unit_id, user_id,
              ${meta.serviceColumn} AS service_name
       FROM ${meta.table} WHERE id = ? FOR UPDATE`,
      [opts.id]
    );
    if (!before) return { status: 404, body: { error: 'Registro não encontrado.' } };

    const changedScheduled = Boolean(scheduled_at) && String(before.scheduled_at) !== String(scheduled_at);
    if (changedScheduled && motivoObrigatorio && !motivoFoiInformado && !(opts.autoReason || opts.defaultReason)) {
      return { status: 400, body: { error: 'Informe o motivo da remarcação.' } };
    }
    if (changedScheduled && (temMotivo || opts.autoReason || opts.defaultReason || motivoFoiInformado)) {
      const reasonError = validateRescheduleReason(reason, { required: true });
      if (reasonError) return { status: 400, body: { error: reasonError } };
    }

    await lockBookingActors(c, {
      userId: before.user_id,
      professionalId: before.professional_id,
    });

    // Se o registro tem profissional vinculado, revalida disponibilidade.
    if (scheduled_at) {
      if (before.professional_id && before.unit_id) {
        const userPriority = await prioridadeDoUsuario(c, before.user_id);
        const bookingError = await validateBooking(c, {
          tipo: meta.tipo,
          userId: before.user_id,
          unitId: before.unit_id,
          professionalId: before.professional_id,
          serviceName: before.service_name,
          scheduledAt: scheduled_at,
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
          scheduledAt: scheduled_at,
        });
        updates.push('duration_minutes=?'); params.push(duracao);
        logParts.push(`duracao -> ${duracao} min`);
      }
    }

    const fromScheduled = before.scheduled_at;
    const toScheduled = scheduled_at || before.scheduled_at;
    const changedStatus = status !== undefined && status !== before.status;

    params.push(opts.id);
    const [result] = await c.query(
      `UPDATE ${meta.table} SET ${updates.join(', ')} WHERE id=?`, params
    );
    if (result.affectedRows === 0) return { status: 404, body: { error: 'Registro não encontrado.' } };

    // Eventos operacionais (append-only).
    const actorUserId = opts.actorUserId || null;
    try {
      if (changedScheduled) {
        await registrarEvento(c, {
          kind: meta.kind,
          bookingId: opts.id,
          eventType: 'rescheduled',
          fromScheduledAt: fromScheduled,
          toScheduledAt: toScheduled,
          fromProfessionalId: before.professional_id,
          toProfessionalId: before.professional_id,
          reason: reason || null,
          actorUserId,
        });
      }
      if (changedStatus) {
        const eventType = status === 'cancelado' ? 'canceled' : 'status_changed';
        await registrarEvento(c, {
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
      }
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

module.exports = {
  KINDS,
  TIPOS,
  MAX_DAYS_AHEAD,
  AVAILABILITY_PAGE_DAYS,
  resolveAvailabilityWindow,
  PRIORITY_GROUPS,
  PRIORITY_QUOTA_RATIO,
  PRIORITY_RELEASE_HOURS,
  PRIORITY_MESSAGE,
  isPriorityUser,
  prioridadeDoUsuario,
  quotaPrioritaria,
  gradeDoDia,
  reservasDoDia,
  slotReservado,
  BOOKING_STATUS,
  parseDateTime,
  toDateStr,
  validateScheduleWindow,
  lockBookingActors,
  validateUserOverlap,
  validateBooking,
duracaoServico,
duracaoMinutos,
duracaoDe,
DURACAO_PADRAO,
  getAvailability,
  findAvailabilityByService,
  applyBookingChange,
};
