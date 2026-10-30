const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { requireCapability } = require('../middleware/capabilities');
const { verifyChain } = require('../utils/audit');
const { applyBookingChange, BOOKING_STATUS } = require('../utils/booking');
const { liberarVagaAposCancelamento } = require('../services/waitlist');
const { parsePagination } = require('../utils/validators');
const { normalizeCounts } = require('../utils/stats');
const { isValidDateOnly } = require('../utils/local-date');

// Listagem paginável sem quebra: com ?page/?pageSize responde
// envelope {data,page,pageSize,total}; sem query mantém o array legado.
async function pagedList(res, next, { baseSql, countSql, params, page, pageSize, offset, wantsPaged }) {
  try {
    const [rows] = await pool.query(`${baseSql} LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
    if (!wantsPaged) return res.json(rows);
    const [[countRow]] = await pool.query(countSql, params);
    return res.json({ data: rows, page, pageSize, total: Number(countRow.total) });
  } catch (err) {
    next(err);
  }
}

// RF17: os filtros da listagem precisam ir ao SQL. Filtrar no cliente só
// enxerga a página carregada e faz o `total` mentir. O alias entra aqui e
// nunca vem da query string, então não há superfície de injeção.
function bookingFilters(query, alias) {
  const where = [];
  const params = [];
  const status = String(query.status || '').trim();
  const unitId = String(query.unit_id || '').trim();
  const dateFrom = String(query.date_from || '').trim();
  const dateTo = String(query.date_to || '').trim();

  if (status) {
    if (!BOOKING_STATUS.includes(status)) return { error: 'Status inválido.' };
    where.push(`${alias}.status = ?`);
    params.push(status);
  }
  if (unitId) {
    where.push(`${alias}.unit_id = ?`);
    params.push(unitId);
  }
  if (dateFrom) {
    if (!isValidDateOnly(dateFrom)) return { error: 'Data inicial inválida. Use AAAA-MM-DD.' };
    where.push(`${alias}.scheduled_at >= ?`);
    params.push(`${dateFrom} 00:00:00`);
  }
  if (dateTo) {
    if (!isValidDateOnly(dateTo)) return { error: 'Data final inválida. Use AAAA-MM-DD.' };
    where.push(`${alias}.scheduled_at < DATE_ADD(?, INTERVAL 1 DAY)`);
    params.push(dateTo);
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    return { error: 'Data inicial não pode ser posterior à data final.' };
  }

  return {
    sql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
}

const router = express.Router();
// Toda rota abaixo exige login E papel de admin — é a fronteira de
// privilégio mais sensível do app, então fica isolada num único arquivo.
router.use(verifyToken, requireAdmin);


router.get('/stats', async (req, res, next) => {
  try {
    // COALESCE(SUM(...), 0): no MySQL, SUM() sobre zero linhas devolve NULL.
    // Instalação nova (tabela vazia) mandava `pending: null` e o painel
    // mostrava "null" no contador. normalizeCounts é a segunda parede: se
    // algum outro campo novo entrar sem COALESCE, ele ainda não vaza null.
    const [[users]] = await pool.query(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(account_status = 'pendente'), 0) AS pending,
              COALESCE(SUM(account_status = 'inativo'), 0) AS inactive
       FROM users WHERE deleted_at IS NULL`
    );
    const [[units]] = await pool.query(
      'SELECT COUNT(*) AS total, COALESCE(SUM(active = 1), 0) AS active FROM health_units'
    );
    const [[diseases]] = await pool.query(
      'SELECT COUNT(*) AS total, COALESCE(SUM(active = 1), 0) AS active FROM diseases'
    );
    res.json({
      users: normalizeCounts(users),
      units: normalizeCounts(units),
      diseases: normalizeCounts(diseases),
    });
  } catch (err) { next(err); }
});

router.get('/export/summary.csv', requireCapability('reports'), async (req, res, next) => {
  try {
    // Mesmo motivo do /stats: COALESCE para que o CSV nunca traga "null" numa
    // célula de número.
    const [[users]] = await pool.query(`SELECT
      COUNT(*) AS total,
      COALESCE(SUM(account_status = 'ativo'), 0) AS active,
      COALESCE(SUM(account_status = 'pendente'), 0) AS pending,
      COALESCE(SUM(account_status = 'inativo'), 0) AS inactive
      FROM users WHERE deleted_at IS NULL`);
    const [[appointments]] = await pool.query(`SELECT
      COUNT(*) AS total,
      COALESCE(SUM(status = 'pendente'), 0) AS pending,
      COALESCE(SUM(status = 'confirmado'), 0) AS confirmed,
      COALESCE(SUM(status = 'cancelado'), 0) AS cancelled,
      COALESCE(SUM(status = 'concluido'), 0) AS completed
      FROM appointments`);
    const [[exams]] = await pool.query(`SELECT
      COUNT(*) AS total,
      COALESCE(SUM(status = 'pendente'), 0) AS pending,
      COALESCE(SUM(status = 'confirmado'), 0) AS confirmed,
      COALESCE(SUM(status = 'cancelado'), 0) AS cancelled,
      COALESCE(SUM(status = 'concluido'), 0) AS completed
      FROM exams`);
    const [[units]] = await pool.query(
      'SELECT COUNT(*) AS total, COALESCE(SUM(active = 1), 0) AS active, COALESCE(SUM(active = 0), 0) AS inactive FROM health_units'
    );
    const [[diseases]] = await pool.query(
      'SELECT COUNT(*) AS total, COALESCE(SUM(active = 1), 0) AS active, COALESCE(SUM(active = 0), 0) AS inactive FROM diseases'
    );

    const rows = [
      ['Indicador', 'Total', 'Ativos/Pendentes', 'Inativos/Confirmados', 'Cancelados/Concluidos'],
      ['Usuários', users.total, users.active, users.pending, users.inactive],
      ['Consultas', appointments.total, appointments.pending, appointments.confirmed, `${appointments.cancelled}/${appointments.completed}`],
      ['Exames', exams.total, exams.pending, exams.confirmed, `${exams.cancelled}/${exams.completed}`],
      ['Unidades de saúde', units.total, units.active, units.inactive, ''],
      ['Alertas epidemiológicos', diseases.total, diseases.active, diseases.inactive, ''],
    ];
    const csv = rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="saude-plus-resumo-administrativo.csv"');
    res.send('\ufeff' + csv);
  } catch (err) {
    next(err);
  }
});

router.get('/appointments', requireCapability('appointments'), async (req, res, next) => {
  const { wantsPaged, page, pageSize, offset } = parsePagination(req.query, { defaultPageSize: 20 });
  const filtros = bookingFilters(req.query, 'a');
  if (filtros.error) return res.status(400).json({ error: filtros.error });
  const legacyLimit = Math.min(parseInt(req.query.limit, 10) || pageSize, 100);
  const from = 'FROM appointments a JOIN users u ON u.id = a.user_id';
  if (wantsPaged) {
    return pagedList(res, next, {
      baseSql: `SELECT a.*, u.full_name AS user_name, u.email AS user_email ${from} ${filtros.sql} ORDER BY a.scheduled_at DESC`,
      countSql: `SELECT COUNT(*) AS total ${from} ${filtros.sql}`,
      params: filtros.params, page, pageSize, offset, wantsPaged,
    });
  }
  try {
    const [rows] = await pool.query(
      `SELECT a.*, u.full_name AS user_name, u.email AS user_email ${from} ${filtros.sql} ORDER BY a.scheduled_at DESC LIMIT ?`,
      [...filtros.params, legacyLimit]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/exams', requireCapability('appointments'), async (req, res, next) => {
  const { wantsPaged, page, pageSize, offset } = parsePagination(req.query, { defaultPageSize: 20 });
  const filtros = bookingFilters(req.query, 'e');
  if (filtros.error) return res.status(400).json({ error: filtros.error });
  const legacyLimit = Math.min(parseInt(req.query.limit, 10) || pageSize, 100);
  const from = 'FROM exams e JOIN users u ON u.id = e.user_id';
  if (wantsPaged) {
    return pagedList(res, next, {
      baseSql: `SELECT e.*, u.full_name AS user_name, u.email AS user_email ${from} ${filtros.sql} ORDER BY e.scheduled_at DESC`,
      countSql: `SELECT COUNT(*) AS total ${from} ${filtros.sql}`,
      params: filtros.params, page, pageSize, offset, wantsPaged,
    });
  }
  try {
    const [rows] = await pool.query(
      `SELECT e.*, u.full_name AS user_name, u.email AS user_email ${from} ${filtros.sql} ORDER BY e.scheduled_at DESC LIMIT ?`,
      [...filtros.params, legacyLimit]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// NOTA: existia aqui um `router.get('/users')` (busca por e-mail) que nunca
// executava — `app.use('/admin/users', adminUsersRoutes)` é montado ANTES do
// `app.use('/admin', adminRoutes)`, então este caminho já era servido por
// admin.users.routes.js. Duas implementações da mesma rota, uma delas morta:
// quem fosse mexer aqui editaria código que ninguém executa. Removida.

// Histórico de um usuário — exige a permissão 'users' (P0.4) e audita a leitura.
router.get('/history', requireCapability('users'), async (req, res, next) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'userId é obrigatório.' });

    const [[user]] = await pool.query(
      'SELECT id, full_name, email, phone FROM users WHERE id = ? AND deleted_at IS NULL',
      [userId]
    );
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const [appointments] = await pool.query(
      'SELECT * FROM appointments WHERE user_id = ? ORDER BY scheduled_at DESC',
      [userId]
    );
    const [exams] = await pool.query(
      'SELECT * FROM exams WHERE user_id = ? ORDER BY scheduled_at DESC',
      [userId]
    );

    await req.audit('admin_view_history', 'user', userId,
      `histórico lido: ${appointments.length} consulta(s), ${exams.length} exame(s)`);
    res.json({ user, appointments, exams });
  } catch (err) {
    next(err);
  }
});

// CRUD de doenças — permissão 'diseases' (o nível 'alertas' é o dono desta área).
router.get('/diseases', requireCapability('diseases'), async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM diseases ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.patch('/diseases/:id', requireCapability('diseases'), async (req, res, next) => {
  try {
    const { name, region, alert_level, description, active } = req.body || {};
    const updates = [];
    const params = [];
    const details = [];
    if (name !== undefined) { if (!String(name).trim()) return res.status(400).json({ error: 'Nome é obrigatório.' }); updates.push('name=?'); params.push(String(name).trim()); details.push(`nome -> ${name}`); }
    if (region !== undefined) { updates.push('region=?'); params.push(region || null); details.push(`região -> ${region || 'não informada'}`); }
    if (alert_level !== undefined) { if (!['baixo', 'medio', 'alto'].includes(alert_level)) return res.status(400).json({ error: 'Nível inválido.' }); updates.push('alert_level=?'); params.push(alert_level); details.push(`nível -> ${alert_level}`); }
    if (description !== undefined) { updates.push('description=?'); params.push(description || null); }
    if (active !== undefined) { updates.push('active=?'); params.push(Number(active) ? 1 : 0); details.push(Number(active) ? 'alerta ativado' : 'alerta desativado'); }
    if (!updates.length) return res.status(400).json({ error: 'Nada para atualizar.' });
    params.push(req.params.id);
    const [result] = await pool.query(`UPDATE diseases SET ${updates.join(', ')} WHERE id=?`, params);
    if (!result.affectedRows) return res.status(404).json({ error: 'Alerta não encontrado.' });
    await req.audit('admin_update_disease', 'disease', req.params.id, details.join('; '));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/diseases', requireCapability('diseases'), async (req, res, next) => {
  try {
    const { name, region, alert_level, description } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Nome é obrigatório.' });

    const validLevels = ['baixo', 'medio', 'alto'];
    const level = validLevels.includes(alert_level) ? alert_level : 'baixo';

    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO diseases (id, name, region, alert_level, description) VALUES (?,?,?,?,?)',
      [id, name, region || null, level, description || null]
    );
    await req.audit('create', 'disease', id, `"${name}" (${level})`);
    res.status(201).json({ id });
  } catch (err) {
    next(err);
  }
});

router.delete('/diseases/:id', requireCapability('diseases'), async (req, res, next) => {
  try {
    await pool.query('DELETE FROM diseases WHERE id = ?', [req.params.id]);
    await req.audit('delete', 'disease', req.params.id, null);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get('/waitlist', requireCapability('appointments'), async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT w.id, w.user_id, w.kind, w.service_name, w.unit_id, w.professional_id,
              w.status, w.record_id, w.created_at, w.fulfilled_at,
              u.full_name AS user_name, u.email AS user_email, u.priority
       FROM waitlist w
       JOIN users u ON u.id = w.user_id
       WHERE w.status = 'aguardando' AND u.deleted_at IS NULL
       ORDER BY CASE WHEN u.priority IN ('idoso', 'gestante', 'pcd', 'lactante') THEN 0 ELSE 1 END,
                w.created_at ASC`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// PATCH /admin/:kind/:id — confirmar, cancelar e/ou reagendar (admin pode agir
// sobre o agendamento de QUALQUER usuário; diferente das rotas /me/*, que só
// deixam cada usuário mexer no próprio registro).
// DEPOIS das rotas específicas: o Express casa na ordem de definição, e um
// PATCH /admin/diseases/:id cairia aqui (kind='diseases') se viesse antes.
// Regra única em booking.js (Fase 2, item 3); aqui só chama e audita.
router.patch('/:kind/:id', requireCapability('appointments'), async (req, res, next) => {
  try {
    const result = await applyBookingChange(pool, {
      kindKey: req.params.kind,
      id: req.params.id,
      body: req.body || {},
      actorUserId: req.user && req.user.id,
    });
    if (result.status !== 200) return res.status(result.status).json(result.body);
    if ((req.body || {}).status === 'cancelado') {
      try {
        await liberarVagaAposCancelamento(pool, { kindKey: req.params.kind, id: req.params.id });
      } catch (err) {
        console.error(`Falha ao liberar a vaga cancelada ${req.params.id}: ${err.message}`);
      }
    }
    await req.audit('admin_update', result.audit.entityType, req.params.id, result.audit.details);
    res.json(result.body);
  } catch (err) {
    next(err);
  }
});

// GET /admin/audit-log — histórico de ações administrativas
// Trilha de auditoria — permissão 'audit' (não é para todo admin ver tudo
// que os outros fizeram; ver docs/SOA_27001.md §5.3 segregação de funções).
router.get('/audit-log', requireCapability('audit'), async (req, res, next) => {
  const entityType = String(req.query.entityType || '').trim();
  const action = String(req.query.action || '').trim();
  const actorId = String(req.query.actorId || '').trim();
  const filters = [];
  const params = [];
  if (entityType) { filters.push('al.entity_type = ?'); params.push(entityType); }
  if (action) { filters.push('al.action = ?'); params.push(action); }
  if (actorId) { filters.push('al.actor_id = ?'); params.push(actorId); }
  const where = filters.length ? 'WHERE ' + filters.join(' AND ') : '';
  // LEFT JOIN, não INNER: `audit_log.actor_id` é ON DELETE RESTRICT, mas um
  // ator ainda pode ter sumido por carga de dump restaurada ou inconsistência
  // antiga. Com INNER essas linhas sumiam da tela — enquanto `verifyChain`
  // (que não usa join) continuava contando, então a lista e o verificador
  // discordavam. `actor_missing` marca a linha para a UI exibir
  // "(usuário removido)".
  const SELECT_AUDIT = `SELECT al.*, u.full_name AS actor_name, u.email AS actor_email,
       CASE WHEN u.id IS NULL THEN 1 ELSE 0 END AS actor_missing
       FROM audit_log al LEFT JOIN users u ON u.id = al.actor_id`;
  const { wantsPaged, page, pageSize, offset } = parsePagination(req.query, { defaultPageSize: 50, maxPageSize: 200 });
  if (wantsPaged) {
    return pagedList(res, next, {
      baseSql: `${SELECT_AUDIT}
       ${where} ORDER BY al.created_at DESC`,
      countSql: `SELECT COUNT(*) AS total FROM audit_log al ${where}`,
      params, page, pageSize, offset, wantsPaged,
    });
  }
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const [rows] = await pool.query(
      `${SELECT_AUDIT}
       ${where}
       ORDER BY al.created_at DESC LIMIT ?`,
      [...params, limit]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /admin/audit-log/verify — verifica a cadeia de hashes (Aulas 1/6).
// Detecta alteração, remoção ou inserção fora de ordem na trilha.
router.get('/audit-log/verify', requireCapability('audit'), async (req, res, next) => {
  try {
    const result = await verifyChain(pool);
    await req.audit('audit_verify', 'audit', 'chain', result.ok ? `cadeia íntegra (${result.checked} linhas)` : `FALHA na linha ${result.firstBad}: ${result.reason}`);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /admin/catalog-health — serviços ativos sem profissional ativo ou sem escala.
router.get('/catalog-health', requireCapability('units'), async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT o.id, o.unit_id, u.name AS unit_name, o.kind, o.name,
              (SELECT COUNT(*) FROM professional_offers po
                 JOIN professionals p ON p.id = po.professional_id
                WHERE po.unit_id = o.unit_id AND po.kind = o.kind
                  AND po.name = o.name AND p.active = 1) AS active_professionals,
              (SELECT COUNT(*) FROM work_schedules ws
                 JOIN professional_offers po
                   ON po.professional_id = ws.professional_id
                  AND po.unit_id = ws.unit_id
                WHERE po.unit_id = o.unit_id AND po.kind = o.kind
                  AND po.name = o.name AND ws.active = 1) AS active_schedules
       FROM unit_offers o
       JOIN health_units u ON u.id = o.unit_id
       WHERE o.active = 1 AND u.active = 1
       HAVING active_professionals = 0 OR active_schedules = 0
       ORDER BY u.name, o.kind, o.name`
    );
    const data = rows.map((row) => ({
      id: row.id,
      unit_id: row.unit_id,
      unit_name: row.unit_name,
      kind: row.kind,
      name: row.name,
      issue: Number(row.active_professionals) === 0 ? 'sem_profissional' : 'sem_escala',
      active_professionals: Number(row.active_professionals),
      active_schedules: Number(row.active_schedules),
    }));
    res.json({ data, total: data.length });
  } catch (err) { next(err); }
});

module.exports = router;
