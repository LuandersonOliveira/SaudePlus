/* ==========================================================================
   Saúde+ — repositório de LEITURA da agenda (A1, passo 7b).

   Todo o SQL que as regras de agendamento (utils/booking.js) usam para consultar
   unidades, profissionais, ofertas, agendas e horários ocupados vive aqui. As
   regras recebem dados prontos e decidem; este arquivo só pergunta ao banco.

   Cada função recebe `db` primeiro: um pool OU a conexão da transação em curso
   (validar e gravar precisam enxergar o mesmo estado, sob o mesmo lock).
   Nada aqui escreve em tabela de agenda; o único `FOR UPDATE` é o das travas de
   `travarEnvolvidos`, que existem para serializar quem agenda.
   ========================================================================== */
const { parseDateTime, duracaoDe } = require('../utils/booking-time');

const TABELAS_DE_ATENDIMENTO = ['appointments', 'exams'];
const ATIVOS = "status IN ('pendente', 'confirmado')";

// ---------------------------------------------------------------------------
// Pessoas e lugares
// ---------------------------------------------------------------------------

async function prioridadeDoUsuario(db, userId) {
  if (!userId) return null;
  const [rows] = await db.query('SELECT priority FROM users WHERE id = ?', [userId]);
  return rows.length ? rows[0].priority : null;
}

/** @returns {Promise<{id: string, active: number}|undefined>} */
async function unidadePorId(db, unitId) {
  const [[unit]] = await db.query('SELECT id, active FROM health_units WHERE id = ?', [unitId]);
  return unit;
}

/** @returns {Promise<{id: string, active: number}|undefined>} */
async function profissionalPorId(db, professionalId) {
  const [[prof]] = await db.query('SELECT id, active FROM professionals WHERE id = ?', [professionalId]);
  return prof;
}

/**
 * Trava utente e profissional na MESMA ordem em todas as requisições.
 * Sem isso, A agenda o profissional X do utente 1 enquanto B agenda o
 * profissional Y do utente 2: nenhuma das duas vê a outra e as duas passam.
 * A ordenação por id elimina o ciclo clássico de deadlock.
 */
async function travarEnvolvidos(db, { userId, professionalId }) {
  const alvos = [];
  if (userId) alvos.push({ id: userId, tabela: 'users' });
  if (professionalId) alvos.push({ id: professionalId, tabela: 'professionals' });
  alvos.sort((a, b) => (a.id === b.id ? a.tabela.localeCompare(b.tabela) : a.id.localeCompare(b.id)));
  for (const alvo of alvos) {
    await db.query(`SELECT id FROM ${alvo.tabela} WHERE id = ? FOR UPDATE`, [alvo.id]);
  }
}

// ---------------------------------------------------------------------------
// Ofertas e vínculos
// ---------------------------------------------------------------------------

/** A unidade tem este serviço cadastrado (e ativo)? */
async function unidadeOfereceServico(db, { unitId, tipo, serviceName }) {
  const [rows] = await db.query(
    'SELECT id FROM unit_offers WHERE unit_id = ? AND kind = ? AND name = ? AND active = 1',
    [unitId, tipo, serviceName || '']
  );
  return rows.length > 0;
}

/** O profissional está habilitado para este serviço nesta unidade? */
async function profissionalAtendeServico(db, { professionalId, unitId, tipo, serviceName }) {
  const [rows] = await db.query(
    'SELECT id FROM professional_offers WHERE professional_id = ? AND unit_id = ? AND kind = ? AND name = ?',
    [professionalId, unitId, tipo, serviceName || '']
  );
  return rows.length > 0;
}

/** Duração gravada na oferta (minutos) ou null se não houver / não for positiva. */
async function duracaoDaOferta(db, { unitId, serviceName, tipo }) {
  const [[row]] = await db.query(
    `SELECT duration_minutes FROM unit_offers
     WHERE unit_id = ? AND kind = ? AND name = ? AND active = 1`,
    [unitId, tipo, serviceName]
  );
  const d = Number(row && row.duration_minutes);
  return Number.isFinite(d) && d > 0 ? d : null;
}

// ---------------------------------------------------------------------------
// Agendas de trabalho
// ---------------------------------------------------------------------------

/** Agendas ativas do profissional na unidade num dia da semana (0 = domingo). */
async function agendasDoDia(db, professionalId, unitId, weekday) {
  const [rows] = await db.query(
    `SELECT start_time, end_time, slot_minutes FROM work_schedules
     WHERE professional_id = ? AND unit_id = ? AND weekday = ? AND active = 1`,
    [professionalId, unitId, weekday]
  );
  return rows;
}

/** Todas as agendas ativas do profissional na unidade (a semana inteira). */
async function agendasDaSemana(db, professionalId, unitId) {
  const [rows] = await db.query(
    `SELECT weekday, start_time, end_time, slot_minutes FROM work_schedules
     WHERE professional_id = ? AND unit_id = ? AND active = 1`,
    [professionalId, unitId]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Horários ocupados
// ---------------------------------------------------------------------------

/**
 * Intervalos ocupados do profissional entre duas datas (YYYY-MM-DD, inclusivas):
 * atendimentos ativos de consultas E exames mais bloqueios de agenda.
 * `excludeId` tira da conta o registro em edição.
 *
 * @returns {Promise<Array<{start: number, end: number}>>} em ms
 */
async function intervalosOcupados(db, professionalId, fromStr, toStr, excludeId) {
  const intervals = [];
  for (const table of TABELAS_DE_ATENDIMENTO) {
    const [rows] = await db.query(
      `SELECT id, scheduled_at, duration_minutes FROM ${table}
       WHERE professional_id = ? AND ${ATIVOS}
         AND scheduled_at BETWEEN ? AND ?`,
      [professionalId, `${fromStr} 00:00:00`, `${toStr} 23:59:59`]
    );
    for (const row of rows) {
      if (excludeId && row.id === excludeId) continue;
      const start = parseDateTime(row.scheduled_at);
      if (start) intervals.push({ start: start.getTime(), end: start.getTime() + duracaoDe(row) * 60000 });
    }
  }
  const [blocks] = await db.query(
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
async function intervalosOcupadosEmLote(db, professionalIds, fromStr, toStr, excludeId) {
  const byProf = new Map();
  const ids = [...new Set((professionalIds || []).filter(Boolean))];
  if (!ids.length) return byProf;
  const ensure = (id) => {
    if (!byProf.has(id)) byProf.set(id, []);
    return byProf.get(id);
  };

  for (const table of TABELAS_DE_ATENDIMENTO) {
    const [rows] = await db.query(
      `SELECT professional_id, id, scheduled_at, duration_minutes FROM ${table}
       WHERE professional_id IN (?) AND ${ATIVOS}
         AND scheduled_at BETWEEN ? AND ?`,
      [ids, `${fromStr} 00:00:00`, `${toStr} 23:59:59`]
    );
    for (const row of rows) {
      if (excludeId && row.id === excludeId) continue;
      const start = parseDateTime(row.scheduled_at);
      if (start) ensure(row.professional_id).push({ start: start.getTime(), end: start.getTime() + duracaoDe(row) * 60000 });
    }
  }
  const [blocks] = await db.query(
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

/**
 * Intervalos ocupados do USUÁRIO (consultas e exames ativos) entre duas datas.
 * @returns {Promise<Array<{start: number, end: number}>>} em ms
 */
async function intervalosOcupadosDoUsuario(db, userId, fromStr, toStr, excludeId) {
  const intervals = [];
  for (const table of TABELAS_DE_ATENDIMENTO) {
    const [rows] = await db.query(
      `SELECT id, scheduled_at, duration_minutes FROM ${table}
       WHERE user_id = ? AND ${ATIVOS}
         AND scheduled_at BETWEEN ? AND ?`,
      [userId, `${fromStr} 00:00:00`, `${toStr} 23:59:59`]
    );
    for (const row of rows) {
      if (excludeId && row.id === excludeId) continue;
      const inicio = parseDateTime(row.scheduled_at);
      if (inicio) intervals.push({ start: inicio.getTime(), end: inicio.getTime() + duracaoDe(row) * 60000 });
    }
  }
  return intervals;
}

// ---------------------------------------------------------------------------
// Catálogo: vagas por serviço em todas as unidades
// ---------------------------------------------------------------------------

/** Unidades ativas que oferecem o serviço, em ordem alfabética. */
async function unidadesQueOferecem(db, { tipo, servico }) {
  const [rows] = await db.query(
    `SELECT u.id, u.name, u.type, u.neighborhood
     FROM health_units u
     JOIN unit_offers o ON o.unit_id = u.id
     WHERE o.kind = ? AND o.name = ? AND o.active = 1 AND u.active = 1
     ORDER BY u.name`,
    [tipo, servico]
  );
  return rows;
}

/** Duração própria do serviço por unidade (só as positivas). @returns {Promise<Map<string, number>>} */
async function duracoesDoServicoPorUnidade(db, { tipo, servico, unitIds }) {
  const [rows] = await db.query(
    `SELECT unit_id, duration_minutes FROM unit_offers
     WHERE kind = ? AND name = ? AND active = 1 AND unit_id IN (?)`,
    [tipo, servico, unitIds]
  );
  return new Map(
    rows
      .filter((row) => Number(row.duration_minutes) > 0)
      .map((row) => [row.unit_id, Number(row.duration_minutes)])
  );
}

/** Profissionais ATIVOS vinculados ao serviço nas unidades, em ordem alfabética. */
async function profissionaisDoServico(db, { tipo, servico, unitIds }) {
  const [rows] = await db.query(
    `SELECT po.unit_id, po.professional_id, p.name AS professional_name, p.job_title
     FROM professional_offers po
     JOIN professionals p ON p.id = po.professional_id
     WHERE po.kind = ? AND po.name = ? AND p.active = 1 AND po.unit_id IN (?)
     ORDER BY p.name`,
    [tipo, servico, unitIds]
  );
  return rows;
}

/**
 * Agendas ativas dos pares (profissional, unidade) que de fato atendem o serviço.
 *
 * O filtro é pelo PAR, não só pelo profissional: o profissional que atende o
 * serviço na unidade A e tem agenda na unidade B não pode gerar vaga em B — o
 * POST devolveria 409 ("não atende este serviço nesta unidade") e a tela
 * ofereceria horários que nunca funcionam.
 */
async function agendasDosVinculos(db, { tipo, servico }) {
  const [rows] = await db.query(
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
  return rows;
}

module.exports = {
  prioridadeDoUsuario,
  unidadePorId,
  profissionalPorId,
  travarEnvolvidos,
  unidadeOfereceServico,
  profissionalAtendeServico,
  duracaoDaOferta,
  agendasDoDia,
  agendasDaSemana,
  intervalosOcupados,
  intervalosOcupadosEmLote,
  intervalosOcupadosDoUsuario,
  unidadesQueOferecem,
  duracoesDoServicoPorUnidade,
  profissionaisDoServico,
  agendasDosVinculos,
};
