const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const { verifyToken, requireStaff } = require('../middleware/auth');
const {
  TIPOS, applyBookingChange, validateBooking, validateScheduleWindow,
  duracaoMinutos, prioridadeDoUsuario, lockBookingActors,
} = require('../utils/booking');
const { listarEventos } = require('../services/booking-events');
const { registrarEvento } = require('../services/booking-events');
const { liberarVagaAposCancelamento } = require('../services/waitlist');
const { parsePagination } = require('../utils/validators');
const { isValidDateOnly, localDateStr, addDaysLocal } = require('../utils/local-date');

const router = express.Router();
router.use(verifyToken, requireStaff);

// Listagem paginável sem quebra: com ?page/?pageSize responde
// envelope {data,page,pageSize,total}; sem query mantém o array legado.
async function pagedList(res, next, { baseSql, countSql, params, page, pageSize, offset }) {
  try {
    const [rows] = await pool.query(`${baseSql} LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
    const [[countRow]] = await pool.query(countSql, params);
    return res.json({ data: rows, page, pageSize, total: Number(countRow.total) });
  } catch (err) {
    next(err);
  }
}

async function getLinkedProfessionalId(userId) {
  const [[row]] = await pool.query('SELECT id FROM professionals WHERE user_id = ? AND active = 1 LIMIT 1', [userId]);
  return row ? row.id : null;
}

const AGENDA_TIPOS = ['consulta', 'exame', 'all'];
const AGENDA_STATUS = ['pendente', 'confirmado', 'para_remarcar', 'concluido', 'cancelado'];

async function escopoAgenda(req) {
  const isAdmin = req.user && req.user.role === 'admin';
  const profId = isAdmin ? null : await getLinkedProfessionalId(req.user.id);
  return { isAdmin, profId };
}

function filtrosAgenda(req, escopo) {
  const tipo = String(req.query.tipo || 'all');
  if (!AGENDA_TIPOS.includes(tipo)) {
    return { error: 'Tipo inválido. Use consulta, exame ou all.' };
  }
  const status = req.query.status ? String(req.query.status) : null;
  if (status && !AGENDA_STATUS.includes(status)) {
    return { error: 'Status inválido. Use um status válido da agenda.' };
  }
  const unitId = req.query.unit_id ? String(req.query.unit_id) : null;
  const professionalId = escopo.isAdmin
    ? (req.query.professional_id ? String(req.query.professional_id) : null)
    : escopo.profId;
  if (!escopo.isAdmin && !professionalId) {
    return { vazio: true, tipo, unitId, professionalId: null, status };
  }
  return { tipo, unitId, professionalId, status };
}

function clausulaFiltros({ unitId, professionalId, status }, alias) {
  const where = [];
  const params = [];
  if (unitId) { where.push(`${alias}.unit_id = ?`); params.push(unitId); }
  if (professionalId) { where.push(`${alias}.professional_id = ?`); params.push(professionalId); }
  if (status) { where.push(`${alias}.status = ?`); params.push(status); }
  return { sql: where.length ? ` AND ${where.join(' AND ')}` : '', params };
}

function prioridadeRank(value) {
  return ['idoso', 'gestante', 'pcd', 'lactante'].includes(String(value || '').toLowerCase()) ? 0 : 1;
}

async function buscarDia(tipo, de, ate, filtros, _escopo) {
  const itens = [];
  for (const [kind, table, serviceColumn] of [
    ['consulta', 'appointments', 'specialty'],
    ['exame', 'exams', 'exam_type'],
  ]) {
    if (tipo !== 'all' && tipo !== kind) continue;
    const where = clausulaFiltros(filtros, 'b');
    const [rows] = await pool.query(
      `SELECT '${kind}' AS kind, b.id, b.scheduled_at, b.duration_minutes, b.status,
              b.outcome, b.reschedule_reason, b.notes,
              b.${serviceColumn} AS service_name,
              b.user_id, u.full_name AS user_name, u.email AS user_email, u.phone, u.mobile,
              u.priority AS user_priority,
              b.professional_id, p.name AS professional_name,
              b.unit_id, hu.name AS unit_name
       FROM ${table} b
       JOIN users u ON u.id = b.user_id
       LEFT JOIN professionals p ON p.id = b.professional_id
       LEFT JOIN health_units hu ON hu.id = b.unit_id
       WHERE b.scheduled_at >= ? AND b.scheduled_at < ?${where.sql}`,
      [de, ate, ...where.params]
    );
    itens.push(...rows);
  }
  itens.sort((a, b) => (String(a.scheduled_at) === String(b.scheduled_at)
    ? String(a.kind).localeCompare(String(b.kind))
    : String(a.scheduled_at).localeCompare(String(b.scheduled_at))));
  return itens;
}

function resumoDia(itens) {
  const resumo = { total: itens.length };
  for (const status of AGENDA_STATUS) resumo[status] = 0;
  for (const item of itens) {
    if (Object.prototype.hasOwnProperty.call(resumo, item.status)) resumo[item.status] += 1;
  }
  resumo.consultas = itens.filter((i) => i.kind === 'consulta').length;
  resumo.exames = itens.filter((i) => i.kind === 'exame').length;
  return resumo;
}

// Grade do dia (Fase 1.5). Para atendente sem vínculo, devolve vazio em vez de
// cair no caminho sem filtro do admin.
router.get('/agenda', async (req, res, next) => {
  try {
    const date = req.query.date ? String(req.query.date) : localDateStr();
    if (!isValidDateOnly(date)) return res.status(400).json({ error: 'Data inválida. Use YYYY-MM-DD.' });
    const escopo = await escopoAgenda(req);
    const filtros = filtrosAgenda(req, escopo);
    if (filtros.error) return res.status(400).json({ error: filtros.error });

    const de = `${date} 00:00:00`;
    const ate = `${localDateStr(addDaysLocal(new Date(`${date}T00:00:00`), 1))} 00:00:00`;
    let itens = filtros.vazio ? [] : await buscarDia(filtros.tipo, de, ate, filtros, escopo);
    if (req.query.queue === '1' || req.query.order === 'queue') {
      itens = itens.slice().sort(function (a, b) {
        return prioridadeRank(a.user_priority) - prioridadeRank(b.user_priority)
          || String(a.scheduled_at).localeCompare(String(b.scheduled_at));
      });
    }
    res.json({
      date,
      filtros: { tipo: filtros.tipo, status: filtros.status, unit_id: filtros.unitId, professional_id: filtros.professionalId },
      items: itens,
      summary: resumoDia(itens),
    });
  } catch (err) { next(err); }
});

// Visão mensal: contagens por dia, já no fuso local do serviço. O calendário
// usa isto para marcar os dias sem baixar todos os registros do mês.
router.get('/agenda/month', async (req, res, next) => {
  try {
    const month = req.query.month ? String(req.query.month) : localDateStr().slice(0, 7);
    const parsed = /^(\d{4})-(\d{2})$/.exec(month);
    const mes = parsed ? Number(parsed[2]) : 0;
    if (!parsed || mes < 1 || mes > 12) {
      return res.status(400).json({ error: 'Mês inválido. Use YYYY-MM.' });
    }
    const escopo = await escopoAgenda(req);
    const filtros = filtrosAgenda(req, escopo);
    if (filtros.error) return res.status(400).json({ error: filtros.error });

    const inicio = new Date(Number(parsed[1]), mes - 1, 1);
    const fim = new Date(Number(parsed[1]), mes, 1);
    const de = `${localDateStr(inicio)} 00:00:00`;
    const ate = `${localDateStr(fim)} 00:00:00`;

    const porDia = new Map();
    if (!filtros.vazio) {
      for (const [kind, table] of [['consulta', 'appointments'], ['exame', 'exams']]) {
        if (filtros.tipo !== 'all' && filtros.tipo !== kind) continue;
        const where = clausulaFiltros(filtros, 'b');
        const [rows] = await pool.query(
          `SELECT DATE_FORMAT(b.scheduled_at, '%Y-%m-%d') AS date, b.status, COUNT(*) AS total
           FROM ${table} b
           WHERE b.scheduled_at >= ? AND b.scheduled_at < ?${where.sql}
           GROUP BY date, b.status`,
          [de, ate, ...where.params]
        );
        for (const row of rows) {
          const dia = porDia.get(row.date) || {
            date: row.date, total: 0, consultas: 0, exames: 0,
            ...Object.fromEntries(AGENDA_STATUS.map((s) => [s, 0])),
          };
          dia.total += Number(row.total);
          if (kind === 'consulta') dia.consultas += Number(row.total);
          else dia.exames += Number(row.total);
          if (Object.prototype.hasOwnProperty.call(dia, row.status)) dia[row.status] += Number(row.total);
          porDia.set(row.date, dia);
        }
      }
    }

    res.json({
      month,
      filtros: { tipo: filtros.tipo, status: filtros.status, unit_id: filtros.unitId, professional_id: filtros.professionalId },
      days: [...porDia.values()].sort((a, b) => a.date.localeCompare(b.date)),
    });
  } catch (err) { next(err); }
});

/**
 * Criação pela recepção (Fase 1.4). O utente precisa existir; ao contrário da
 * rota do paciente, não há texto livre de nome/e-mail. A validação e o insert
 * ficam na MESMA transação, com utente e profissional travados na ordem
 * canônica, e o evento `created` entra junto do agendamento.
 */
function createStaffBooking(tipo) {
  const meta = TIPOS[tipo];
  return async (req, res, next) => {
    let conn = null;
    try {
      const body = req.body || {};
      const serviceName = tipo === 'consulta' ? body.specialty : body.exam_type;
      const { user_id, unit_id, professional_id, scheduled_at, notes } = body;
      const location = body.location;
      if (!user_id || !serviceName || !unit_id || !scheduled_at) {
        return res.status(400).json({ error: 'Informe utente, serviço, unidade e data/hora.' });
      }
      const windowError = validateScheduleWindow(scheduled_at);
      if (windowError) return res.status(400).json({ error: windowError });

      conn = await pool.getConnection();
      await conn.beginTransaction();

      const [[patient]] = await conn.query(
        `SELECT id, full_name FROM users
         WHERE id = ? AND role = 'paciente' AND account_status = 'ativo' AND deleted_at IS NULL`,
        [user_id]
      );
      if (!patient) {
        await conn.rollback();
        conn.release();
        conn = null;
        return res.status(404).json({ error: 'Paciente não encontrado ou conta inativa.' });
      }

      await lockBookingActors(conn, { userId: user_id, professionalId: professional_id || null });
      const bookingError = await validateBooking(conn, {
        tipo,
        userId: user_id,
        unitId: unit_id,
        professionalId: professional_id || null,
        serviceName,
        scheduledAt: scheduled_at,
        userPriority: await prioridadeDoUsuario(conn, user_id),
      });
      if (bookingError) {
        await conn.rollback();
        conn.release();
        conn = null;
        return res.status(409).json({ error: bookingError });
      }

      const [[unit]] = await conn.query('SELECT name FROM health_units WHERE id = ?', [unit_id]);
      let doctorName = null;
      if (tipo === 'consulta' && professional_id) {
        const [[prof]] = await conn.query('SELECT name FROM professionals WHERE id = ?', [professional_id]);
        doctorName = prof ? prof.name : null;
      }

      const duracao = await duracaoMinutos(conn, {
        unitId: unit_id,
        professionalId: professional_id || null,
        serviceName,
        tipo,
        scheduledAt: scheduled_at,
      });

      const id = crypto.randomUUID();
      const columns = ['id', 'user_id', meta.serviceColumn];
      const values = [id, user_id, serviceName];
      if (tipo === 'consulta') { columns.push('doctor'); values.push(doctorName); }
      columns.push('location', 'unit_id', 'professional_id', 'scheduled_at', 'notes', 'duration_minutes');
      values.push(location || unit.name, unit_id, professional_id || null, scheduled_at, notes || null, duracao);

      await conn.query(
        `INSERT INTO ${meta.table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(',')})`,
        values
      );
      await registrarEvento(conn, {
        kind: tipo,
        bookingId: id,
        eventType: 'created',
        toScheduledAt: scheduled_at,
        toProfessionalId: professional_id || null,
        actorUserId: req.user.id,
      });
      await conn.commit();
      conn.release();
      conn = null;

      await req.audit('staff_create', tipo === 'consulta' ? 'appointment' : 'exam', id,
        `${tipo} para ${patient.full_name} em ${scheduled_at} (${duracao} min)`);
      res.status(201).json({ id, duration_minutes: duracao });
    } catch (err) {
      if (conn) {
        await conn.rollback().catch(() => {});
        conn.release();
      }
      next(err);
    }
  };
}

router.post('/appointments', createStaffBooking('consulta'));
router.post('/exams', createStaffBooking('exame'));

router.get('/appointments', async (req, res, next) => {
  const { wantsPaged, page, pageSize, offset } = parsePagination(req.query, { defaultPageSize: 50, maxPageSize: 200 });
  const isAdmin = req.user && req.user.role === 'admin';
  const profId = isAdmin ? null : await getLinkedProfessionalId(req.user.id);
  // Fail-closed: atendente sem profissional vinculado não enxerga a agenda de
  // ninguém. Antes `profId` nulo caía no mesmo caminho do admin (sem WHERE).
  const where = isAdmin ? '' : 'WHERE a.professional_id = ?';
  const params = isAdmin ? [] : [profId];
  const countSql = isAdmin
    ? 'SELECT COUNT(*) AS total FROM appointments'
    : 'SELECT COUNT(*) AS total FROM appointments a WHERE a.professional_id = ?';
  if (wantsPaged) {
    return pagedList(res, next, {
      baseSql: `SELECT a.*, u.full_name AS user_name, u.email AS user_email
       FROM appointments a JOIN users u ON u.id = a.user_id
       ${where}
       ORDER BY a.scheduled_at DESC`,
      countSql,
      params, page, pageSize, offset,
    });
  }
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const [rows] = await pool.query(
      `SELECT a.*, u.full_name AS user_name, u.email AS user_email
       FROM appointments a JOIN users u ON u.id = a.user_id
       ${where}
       ORDER BY a.scheduled_at DESC LIMIT ?`, [...params, limit]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/exams', async (req, res, next) => {
  const { wantsPaged, page, pageSize, offset } = parsePagination(req.query, { defaultPageSize: 50, maxPageSize: 200 });
  const isAdmin = req.user && req.user.role === 'admin';
  const profId = isAdmin ? null : await getLinkedProfessionalId(req.user.id);
  // Mesmo fail-closed da agenda: sem vínculo, nenhum exame é listado.
  const where = isAdmin ? '' : 'WHERE e.professional_id = ?';
  const params = isAdmin ? [] : [profId];
  const countSql = isAdmin
    ? 'SELECT COUNT(*) AS total FROM exams'
    : 'SELECT COUNT(*) AS total FROM exams e WHERE e.professional_id = ?';
  if (wantsPaged) {
    return pagedList(res, next, {
      baseSql: `SELECT e.*, u.full_name AS user_name, u.email AS user_email
       FROM exams e JOIN users u ON u.id = e.user_id
       ${where}
       ORDER BY e.scheduled_at DESC`,
      countSql,
      params, page, pageSize, offset,
    });
  }
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const [rows] = await pool.query(
      `SELECT e.*, u.full_name AS user_name, u.email AS user_email
       FROM exams e JOIN users u ON u.id = e.user_id
       ${where}
       ORDER BY e.scheduled_at DESC LIMIT ?`, [...params, limit]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// NV03 — fila de espera vista pela recepção. Ordenada como o serviço de
// liberação automática: prioridade legal primeiro, depois chegada.
router.get('/waitlist', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT w.id, w.user_id, w.kind, w.service_name, w.unit_id, w.professional_id,
              w.status, w.record_id, w.created_at, w.fulfilled_at,
              u.full_name AS user_name, u.email AS user_email, u.phone, u.priority
       FROM waitlist w
       JOIN users u ON u.id = w.user_id
       WHERE w.status = 'aguardando' AND u.deleted_at IS NULL
       ORDER BY CASE WHEN u.priority IN ('idoso', 'gestante', 'pcd', 'lactante') THEN 0 ELSE 1 END,
                w.created_at ASC`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// Busca pacientes por nome ou e-mail (sem CPF/RG).
// Devolve também contas inativas/pendentes — o painel do atendente exibe
// um aviso para evitar cadastro duplicado (TAREFAS V3, item 3.2).
router.get('/patients', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json([]);
    const [rows] = await pool.query(
      `SELECT id, full_name, email, phone, mobile, birth_date, gender, blood_type, account_status
       FROM users WHERE role = 'paciente' AND deleted_at IS NULL
       AND (full_name LIKE ? OR email LIKE ?)
       ORDER BY CASE account_status WHEN 'ativo' THEN 0 WHEN 'pendente' THEN 1 ELSE 2 END,
                full_name
       LIMIT 20`,
      ['%' + q + '%', '%' + q + '%']
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// Histórico completo de um paciente (sem CPF/RG)
//
// Segurança (P0.2): só pacientes ATIVOS. Antes o filtro era só por `role`, e
// o front escondia o botão de histórico para contas inativas/pendentes — mas a
// API aceitava o `user_id` vindo de /staff/appointments. Agora o servidor
// bloqueia (front não é controle de segurança) e a LEITURA é auditada.
router.get('/patients/:id/history', async (req, res, next) => {
  try {
    const [[user]] = await pool.query(
      `SELECT id, full_name, email, phone, mobile, birth_date, gender, blood_type
       FROM users WHERE id = ? AND role = 'paciente' AND account_status = 'ativo'
       AND deleted_at IS NULL`, [req.params.id]
    );
    if (!user) return res.status(404).json({ error: 'Paciente não encontrado ou conta inativa.' });

    const [appointments] = await pool.query(
      'SELECT * FROM appointments WHERE user_id = ? ORDER BY scheduled_at DESC', [req.params.id]
    );
    const [exams] = await pool.query(
      'SELECT * FROM exams WHERE user_id = ? ORDER BY scheduled_at DESC', [req.params.id]
    );
    await req.audit('staff_view_history', 'user', req.params.id,
      `histórico lido: ${appointments.length} consulta(s), ${exams.length} exame(s)`);
    res.json({ user, appointments, exams });
  } catch (err) { next(err); }
});

// PATCH /:kind/:id — mesma lógica de confirmação/cancelamento/reagendamento do admin.
// Regra única em booking.js (Fase 2, item 3); aqui só chama e audita.
router.patch('/:kind/:id', async (req, res, next) => {
  try {
    // Sem motivo explícito do staff/admin, o reagendamento é recusado: a regra
    // de negócio exige justificativa. Status-only e outcome-only não exigem.
    const isReschedule = Boolean((req.body || {}).scheduled_at);
    const result = await applyBookingChange(pool, {
      kindKey: req.params.kind,
      id: req.params.id,
      body: req.body || {},
      actorUserId: req.user && req.user.id,
      reasonRequired: isReschedule,
    });
    if (result.status !== 200) return res.status(result.status).json(result.body);
    if ((req.body || {}).status === 'cancelado') {
      try {
        await liberarVagaAposCancelamento(pool, { kindKey: req.params.kind, id: req.params.id });
      } catch (err) {
        console.error(`Falha ao liberar a vaga cancelada ${req.params.id}: ${err.message}`);
      }
    }
    await req.audit('staff_update', result.audit.entityType, req.params.id, result.audit.details);
    res.json(result.body);
  } catch (err) { next(err); }
});

router.get('/agenda/reports', async (req, res, next) => {
  try {
    const from = req.query.from ? String(req.query.from) : localDateStr(addDaysLocal(new Date(), -30));
    const to = req.query.to ? String(req.query.to) : localDateStr();
    if (!isValidDateOnly(from) || !isValidDateOnly(to)) {
      return res.status(400).json({ error: 'Data inválida. Use YYYY-MM-DD.' });
    }
    const de = `${from} 00:00:00`;
    const ate = `${to} 23:59:59`;
    const tipo = req.query.tipo ? String(req.query.tipo) : 'all';
    const unitId = req.query.unit_id ? String(req.query.unit_id) : null;
    const professionalId = req.query.professional_id ? String(req.query.professional_id) : null;

    const filtros = { unitId, professionalId };
    const where = clausulaFiltros(filtros, 'b');

    const tabelas = [];
    if (tipo === 'all' || tipo === 'consulta') tabelas.push({ kind: 'consulta', table: 'appointments', serviceColumn: 'specialty' });
    if (tipo === 'all' || tipo === 'exame') tabelas.push({ kind: 'exame', table: 'exams', serviceColumn: 'exam_type' });

    let total = 0;
    const porStatus = new Map(AGENDA_STATUS.map((s) => [s, 0]));
    const porDesfecho = new Map();
    const porMotivo = new Map();
    const porTipo = { consulta: 0, exame: 0 };
    let faltas = 0;
    let concluidos = 0;
    let minutosAgendados = 0;

    for (const meta of tabelas) {
      const [rows] = await pool.query(
        `SELECT b.status, b.outcome, b.reschedule_reason, b.duration_minutes,
                b.user_id, u.priority
         FROM ${meta.table} b
         JOIN users u ON u.id = b.user_id
         WHERE b.scheduled_at BETWEEN ? AND ?${where.sql}`,
        [de, ate, ...where.params]
      );
       porTipo[meta.kind] += rows.length;
       total += rows.length;
       for (const row of rows) {
         if (porStatus.has(row.status)) porStatus.set(row.status, porStatus.get(row.status) + 1);
        if (row.outcome) {
          porDesfecho.set(row.outcome, (porDesfecho.get(row.outcome) || 0) + 1);
          if (row.outcome === 'faltou') faltas += 1;
        }
        if (row.status === 'concluido') concluidos += 1;
        if (row.reschedule_reason) {
          porMotivo.set(row.reschedule_reason, (porMotivo.get(row.reschedule_reason) || 0) + 1);
        }
        minutosAgendados += Number(row.duration_minutes) > 0 ? Number(row.duration_minutes) : 30;
      }
    }

    // Disponibilidade ofertada no período: soma as janelas ativas dos profissionais.
    const [schedules] = await pool.query(
      `SELECT professional_id, unit_id, weekday, start_time, end_time
       FROM work_schedules WHERE active = 1`
    );
    let minutosOfertados = 0;
    const inicio = new Date(de);
    const fim = new Date(ate);
    for (let d = new Date(inicio); d <= fim; d.setDate(d.getDate() + 1)) {
      const wd = d.getDay();
      for (const s of schedules) {
        if (Number(s.weekday) !== wd) continue;

        const start = String(s.start_time).slice(0, 5).split(':').map(Number);
        const end = String(s.end_time).slice(0, 5).split(':').map(Number);
        minutosOfertados += Math.max(0, (end[0] * 60 + end[1]) - (start[0] * 60 + start[1]));
      }
    }

    const ocupacao = minutosOfertados > 0 ? Math.min(1, minutosAgendados / minutosOfertados) : null;
    const absenteismo = faltas + concluidos > 0 ? faltas / (faltas + concluidos) : null;

    const [movimentos] = await pool.query(
      `SELECT TIMESTAMPDIFF(MINUTE, from_scheduled_at, to_scheduled_at) AS minutos
       FROM booking_events
       WHERE event_type = 'rescheduled' AND created_at BETWEEN ? AND ?`,
      [de, ate]
    );
    const tempos = movimentos.map((r) => Math.abs(Number(r.minutos) || 0)).filter((n) => n >= 0);
    const tempoMedioReagendamento = tempos.length
      ? tempos.reduce((a, b) => a + b, 0) / tempos.length
      : null;

    res.json({
      periodo: { de: from, ate: to },
      period: { from, to },
      filtros: { tipo, unit_id: unitId, professional_id: professionalId },
      total,
      totals: {
        agendamentos: total,
        total: total,
        confirmados: porStatus.get('confirmado') || 0,
        concluidos: porStatus.get('concluido') || 0,
        cancelados: porStatus.get('cancelado') || 0,
        para_remarcar: porStatus.get('para_remarcar') || 0,
        pendentes: porStatus.get('pendente') || 0,
        faltas: faltas,
        absenteismo: absenteismo,
        ocupacao: ocupacao,
      },
      by_status: Array.from(porStatus.entries()).map(([status, total]) => ({ status, total })),
      by_outcome: Array.from(porDesfecho.entries()).map(([outcome, total]) => ({ outcome, total })),
      by_reschedule_reason: Array.from(porMotivo.entries()).map(([reason, total]) => ({ reason, total })),
      by_type: porTipo,
      occupancy_rate: ocupacao,
      absence_rate: absenteismo,
      tempo_medio_reagendamento_minutos: tempoMedioReagendamento,
      tempo_medio_ate_reagendamento_minutos: tempoMedioReagendamento,
      average_reschedule_minutes: tempoMedioReagendamento,
    });
  } catch (err) { next(err); }
});

router.get('/booking-events', async (req, res, next) => {
  try {
    var kind = String(req.query.kind || '');
    var bookingId = String(req.query.booking_id || '');
    var events = await listarEventos(pool, { kind, bookingId, limit: Number(req.query.limit) || 50 });
    res.json(events);
  } catch (err) { next(err); }
});

module.exports = router;
