/* ==========================================================================
   Saúde+ — Regras de agendamento validadas NO SERVIDOR
   (TAREFAS V3, itens 4.5 e 6.2)

   - Janela de data: nada no passado, nada além de 1 ano.
   - Unidade precisa existir e estar ativa.
   - Serviço cadastrado na unidade exige profissional vinculado.
   - Profissional precisa estar ativo, vinculado à unidade e habilitado
     para aquele serviço, atender no dia/horário e não ter conflito.
   ========================================================================== */

const KINDS = ['consulta', 'exame'];
const MAX_DAYS_AHEAD = 366;

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
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toMinutes(hhmm) {
  // '08:00:00' ou '08:00' -> 480
  const parts = String(hhmm || '').split(':');
  if (parts.length < 2) return null;
  return Number(parts[0]) * 60 + Number(parts[1]);
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

async function fetchBusyIntervals(pool, professionalId, fromStr, toStr, excludeId) {
  const intervals = [];
  for (const table of ['appointments', 'exams']) {
    const [rows] = await pool.query(
      `SELECT id, scheduled_at FROM ${table}
       WHERE professional_id = ? AND status IN ('pendente', 'confirmado')
         AND scheduled_at BETWEEN ? AND ?`,
      [professionalId, `${fromStr} 00:00:00`, `${toStr} 23:59:59`]
    );
    for (const row of rows) {
      if (excludeId && row.id === excludeId) continue;
      const start = parseDateTime(row.scheduled_at);
      if (start) intervals.push({ start: start.getTime(), end: start.getTime() + 30 * 60000 });
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
      `SELECT professional_id, id, scheduled_at FROM ${table}
       WHERE professional_id IN (?) AND status IN ('pendente', 'confirmado')
         AND scheduled_at BETWEEN ? AND ?`,
      [ids, `${fromStr} 00:00:00`, `${toStr} 23:59:59`]
    );
    for (const row of rows) {
      if (excludeId && row.id === excludeId) continue;
      const start = parseDateTime(row.scheduled_at);
      if (start) ensure(row.professional_id).push({ start: start.getTime(), end: start.getTime() + 30 * 60000 });
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
  const weekday = when.getDay();
  const minutesOfDay = when.getHours() * 60 + when.getMinutes();

  const [schedules] = await pool.query(
    `SELECT start_time, end_time, slot_minutes FROM work_schedules
     WHERE professional_id = ? AND unit_id = ? AND weekday = ? AND active = 1`,
    [professionalId, unitId, weekday]
  );

  let slot = 30;
  let insideSchedule = false;
  for (const s of schedules) {
    const start = toMinutes(s.start_time);
    const end = toMinutes(s.end_time);
    const slotMin = Number(s.slot_minutes) || 30;
    if (start === null || end === null) continue;
    if (minutesOfDay >= start && minutesOfDay + slotMin <= end && (minutesOfDay - start) % slotMin === 0) {
      insideSchedule = true;
      slot = slotMin;
      break;
    }
  }
  if (!insideSchedule) return 'O profissional não atende neste dia e horário.';

  const dateStr = toDateStr(when);
  const intervals = await fetchBusyIntervals(pool, professionalId, dateStr, dateStr, excludeId);
  const startMs = when.getTime();
  const endMs = startMs + slot * 60000;
  for (const iv of intervals) {
    if (overlaps(startMs, endMs, iv.start, iv.end)) {
      return 'Este horário já está ocupado para este profissional.';
    }
  }
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
    const slots = new Set();
    for (const rule of rules) {
      for (let m = rule.start; m + rule.slot <= rule.end; m += rule.slot) {
        const slotDate = new Date(
          day.getFullYear(), day.getMonth(), day.getDate(),
          Math.floor(m / 60), m % 60, 0, 0
        );
        if (slotDate.getTime() <= nowMs) continue;
        if (isToday && slotDate.getTime() < nowMs + 30 * 60000) continue;
        const slotEnd = slotDate.getTime() + rule.slot * 60000;
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
  const days = Math.min(Math.max(parseInt(opts && opts.days, 10) || 30, 1), 60);
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
    for (let i = 0; i < days; i++) {
      const day = new Date(start.getTime() + i * 24 * 3600 * 1000);
      const rules = byWd[day.getDay()];
      if (!rules) continue;
      const dateStr = toDateStr(day);
      const isToday = dateStr === todayStr;
      for (const rule of rules) {
        for (let m = rule.start; m + rule.slot <= rule.end; m += rule.slot) {
          const slotDate = new Date(
            day.getFullYear(), day.getMonth(), day.getDate(),
            Math.floor(m / 60), m % 60, 0, 0
          );
          if (slotDate.getTime() <= nowMs) continue;
          if (isToday && slotDate.getTime() < nowMs + 30 * 60000) continue;
          const slotEnd = slotDate.getTime() + rule.slot * 60000;
          if (busy.some((iv) => overlaps(slotDate.getTime(), slotEnd, iv.start, iv.end))) continue;
          const hora = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
          if (!unitDays.has(unitId)) unitDays.set(unitId, new Map());
          const dayMap = unitDays.get(unitId);
          if (!dayMap.has(dateStr)) dayMap.set(dateStr, new Map());
          const slotMap = dayMap.get(dateStr);
          if (!slotMap.has(hora)) {
            slotMap.set(hora, {
              hora,
              professional_id: profId,
              professional_name: prof.name,
              job_title: prof.job,
            });
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
const BOOKING_STATUS = ['pendente', 'confirmado', 'cancelado', 'concluido'];

async function applyBookingChange(pool, opts) {
  const meta = opts.kindKey === 'appointments'
    ? { table: 'appointments', tipo: 'consulta', serviceColumn: 'specialty', entityType: 'appointment' }
    : opts.kindKey === 'exams'
      ? { table: 'exams', tipo: 'exame', serviceColumn: 'exam_type', entityType: 'exam' }
      : null;
  if (!meta) return { status: 404, body: { error: 'Tipo inválido.' } };

  const { status, scheduled_at } = (opts && opts.body) || {};
  const updates = [];
  const params = [];
  const logParts = [];

  if (status !== undefined) {
    if (!BOOKING_STATUS.includes(status)) {
      return { status: 400, body: { error: 'Status inválido.' } };
    }
    updates.push('status=?'); params.push(status); logParts.push(`status -> ${status}`);
  }
  if (scheduled_at) {
    const windowError = validateScheduleWindow(scheduled_at);
    if (windowError) return { status: 400, body: { error: windowError } };
    updates.push('scheduled_at=?'); params.push(scheduled_at);
    logParts.push(`reagendado para ${scheduled_at}`);
  }
  if (!updates.length) return { status: 400, body: { error: 'Nada para atualizar.' } };

  // Se o registro tem profissional vinculado, revalida disponibilidade
  // (dias/horários, conflito e bloqueios) — item 4.5.
  if (scheduled_at) {
    const [[record]] = await pool.query(
      `SELECT professional_id, unit_id, ${meta.serviceColumn} AS service_name FROM ${meta.table} WHERE id = ?`,
      [opts.id]
    );
    if (record && record.professional_id && record.unit_id) {
      const bookingError = await validateBooking(pool, {
        tipo: meta.tipo,
        unitId: record.unit_id,
        professionalId: record.professional_id,
        serviceName: record.service_name,
        scheduledAt: scheduled_at,
        excludeId: opts.id,
      });
      if (bookingError) return { status: 409, body: { error: bookingError } };
    }
  }

  params.push(opts.id);
  const [result] = await pool.query(
    `UPDATE ${meta.table} SET ${updates.join(', ')} WHERE id=?`, params
  );
  if (result.affectedRows === 0) return { status: 404, body: { error: 'Registro não encontrado.' } };

  return {
    status: 200,
    body: { id: opts.id },
    audit: { entityType: meta.entityType, details: logParts.join('; ') },
  };
}

module.exports = {
  KINDS,
  TIPOS,
  BOOKING_STATUS,
  parseDateTime,
  toDateStr,
  validateScheduleWindow,
  validateBooking,
  getAvailability,
  findAvailabilityByService,
  applyBookingChange,
};
