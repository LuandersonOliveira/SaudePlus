/* ==========================================================================
   Saúde+ — regras de agendamento validadas NO SERVIDOR
   (TAREFAS V3, itens 4.5 e 6.2; A1 da Fase 6, passo 7d)

   - Janela de data: nada no passado, nada além de 1 ano.
   - Unidade precisa existir e estar ativa.
   - Serviço cadastrado na unidade exige profissional vinculado.
   - Profissional precisa estar ativo, vinculado à unidade e habilitado
     para aquele serviço, atender no dia/horário e não ter conflito.

   Onde está cada coisa:
     utils/booking-time.js, -priority.js, -slots.js   cálculo puro (7a)
     repositories/agenda.js                           SQL de leitura (7b)
     services/bookingChange.js                        alteração por staff/admin (7c)
     este arquivo                                     as regras que juntam os três
   utils/booking.js é só a fachada que reexporta tudo para os chamadores de sempre.
   ========================================================================== */
const {
  AVAILABILITY_PAGE_DAYS, DURACAO_PADRAO,
  parseDateTime, toDateStr, toMinutes, overlaps, validateScheduleWindow, schedulePara,
} = require('../utils/booking-time');
const { PRIORITY_MESSAGE, isPriorityUser, slotReservado } = require('../utils/booking-priority');
const { gerarSlotsDoDia } = require('../utils/booking-slots');
const agenda = require('../repositories/agenda');

const KINDS = ['consulta', 'exame'];

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

// Leituras da agenda: repositories/agenda.js. Os nomes antigos seguem exportados.
const prioridadeDoUsuario = agenda.prioridadeDoUsuario;
const lockBookingActors = agenda.travarEnvolvidos;

/**
 * Duração declarada pelo serviço na unidade. NULL significa "use o slot da
 * agenda" — o comportamento histórico. A duração do serviço tem prioridade
 * sobre o slot, mas o horário ainda precisa cair na grade.
 */
async function duracaoServico(pool, { unitId, serviceName, tipo }) {
  if (!unitId || !serviceName || !tipo) return null;
  return agenda.duracaoDaOferta(pool, { unitId, serviceName, tipo });
}

/**
 * Duração, em minutos, do atendimento que seria marcado neste horário.
 *
 * Serviço sem profissional alocado não tem agenda: a unidade decide depois, e
 * 30 min é o padrão histórico. Serviço com duração própria vence o slot.
 */
async function duracaoMinutos(pool, { unitId, professionalId, serviceName, tipo, scheduledAt }) {
  if (!professionalId) return DURACAO_PADRAO;
  const when = parseDateTime(scheduledAt);
  if (!when) return DURACAO_PADRAO;
  const servico = await duracaoServico(pool, { unitId, serviceName, tipo });
  const casa = schedulePara(await agenda.agendasDoDia(pool, professionalId, unitId, when.getDay()), when, servico);
  return casa ? casa.duration : DURACAO_PADRAO;
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

  const ocupados = await agenda.intervalosOcupadosDoUsuario(pool, userId, from, to, excludeId);
  if (ocupados.some((iv) => overlaps(startMs, endMs, iv.start, iv.end))) {
    return 'Este utente já tem outro atendimento neste horário.';
  }
  return null;
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
async function validateBooking(pool, opts) {
  const { unitId, professionalId, serviceName, scheduledAt, excludeId } = opts;
  const tipo = resolveTipo(opts);
  if (!tipo) return 'Tipo de atendimento inválido.';

  const windowError = validateScheduleWindow(scheduledAt);
  if (windowError) return windowError;

  if (!unitId) return 'Selecione a unidade de saúde.';
  const unit = await agenda.unidadePorId(pool, unitId);
  if (!unit) return 'Unidade de saúde não encontrada.';
  if (!Number(unit.active)) return 'Esta unidade de saúde está inativada.';

  // Serviço já cadastrado pela unidade?
  const isRegisteredOffer = await agenda.unidadeOfereceServico(pool, { unitId, tipo, serviceName });

  if (!professionalId) {
    // Serviço "Outro"/personalizado: a unidade aloca o atendimento depois.
    if (isRegisteredOffer) return 'Selecione um profissional para este atendimento.';
    return null;
  }

  const prof = await agenda.profissionalPorId(pool, professionalId);
  if (!prof) return 'Profissional não encontrado.';
  if (!Number(prof.active)) return 'Este profissional está inativo.';
  if (!isRegisteredOffer) {
    return 'Este serviço não está vinculado à unidade escolhida.';
  }

  if (!(await agenda.profissionalAtendeServico(pool, { professionalId, unitId, tipo, serviceName }))) {
    return 'Este profissional não atende este serviço nesta unidade.';
  }

  const when = parseDateTime(scheduledAt);
  if (!when) return 'Informe uma data e horário válidos.';
  const servicoDuracao = await duracaoServico(pool, { unitId, serviceName, tipo });
  const schedules = await agenda.agendasDoDia(pool, professionalId, unitId, when.getDay());
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
  const intervals = await agenda.intervalosOcupados(pool, professionalId, dateStr, dateStr, excludeId);
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

  const unit = await agenda.unidadePorId(pool, unitId);
  if (!unit || !Number(unit.active)) {
    return { days: [], reason: 'A unidade escolhida está inativada.' };
  }

  const prof = await agenda.profissionalPorId(pool, professionalId);
  if (!prof || !Number(prof.active)) {
    return { days: [], reason: 'O profissional escolhido está inativo.' };
  }

  if (!(await agenda.profissionalAtendeServico(pool, { professionalId, unitId, tipo, serviceName }))) {
    return { days: [], reason: 'Este profissional não atende este serviço nesta unidade.' };
  }
  const servicoDuracao = await duracaoServico(pool, { unitId, serviceName, tipo });

  const schedules = await agenda.agendasDaSemana(pool, professionalId, unitId);
  if (!schedules.length) {
    return { days: [], reason: 'Este profissional ainda não tem horários cadastrados nesta unidade.' };
  }

  const start = new Date(fromDate + 'T00:00:00');
  if (isNaN(start.getTime())) return empty;
  const rangeEnd = new Date(start.getTime() + (days - 1) * 24 * 3600 * 1000);
  const intervals = await agenda.intervalosOcupados(
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

    const livres = gerarSlotsDoDia({ day, rules, nowMs, prioritario, servicoDuracao, busy: intervals });
    const slots = new Set(livres.map((s) => s.hora));
    if (slots.size) result.push({ date: toDateStr(day), slots: Array.from(slots).sort() });
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
  const unitRows = await agenda.unidadesQueOferecem(pool, { tipo, servico });
  if (!unitRows.length) {
    return { ...empty, reason: 'Nenhuma unidade oferece este serviço no momento.' };
  }
  const unitIds = unitRows.map((u) => u.id);
  const duracaoPorUnidade = await agenda.duracoesDoServicoPorUnidade(pool, { tipo, servico, unitIds });

  // 2) profissionais ativos vinculados ao serviço nessas unidades
  const linkRows = await agenda.profissionaisDoServico(pool, { tipo, servico, unitIds });
  if (!linkRows.length) {
    return { ...empty, reason: 'Nenhum profissional atende este serviço no momento.' };
  }

  // 3) horários desses vínculos (1 query). O filtro é pelo PAR (profissional,
  // unidade) — ver agendasDosVinculos no repositório.
  const profIds = [...new Set(linkRows.map((l) => l.professional_id))];
  const schedRows = await agenda.agendasDosVinculos(pool, { tipo, servico });
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
  const busyByProf = await agenda.intervalosOcupadosEmLote(pool, profIds, fromStr, toStr, (opts && opts.excludeId) || null);

  // 5) grade por unidade
  const nowMs = Date.now();
  const unitDays = new Map();
  for (const { unitId, profId, byWd, prof } of pairs) {
    const busy = busyByProf.get(profId) || [];
    const servicoDuracao = duracaoPorUnidade.get(unitId) || null;
    for (let i = 0; i < days; i++) {
      const day = new Date(start.getTime() + i * 24 * 3600 * 1000);
      const rules = byWd[day.getDay()];
      if (!rules) continue;
      const dateStr = toDateStr(day);
      for (const { hora } of gerarSlotsDoDia({ day, rules, nowMs, prioritario, servicoDuracao, busy })) {
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

module.exports = {
  KINDS,
  TIPOS,
  prioridadeDoUsuario,
  lockBookingActors,
  validateUserOverlap,
  validateBooking,
  duracaoServico,
  duracaoMinutos,
  getAvailability,
  findAvailabilityByService,
};
