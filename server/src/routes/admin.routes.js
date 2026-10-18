const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { requireCapability } = require('../middleware/capabilities');
const { verifyChain } = require('../utils/audit');
const { applyBookingChange } = require('../utils/booking');
const { parsePagination } = require('../utils/validators');
const { normalizeCounts } = require('../utils/stats');

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
       FROM users`
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
      FROM users`);
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
  const legacyLimit = Math.min(parseInt(req.query.limit, 10) || pageSize, 100);
  if (wantsPaged) {
    return pagedList(res, next, {
      baseSql: 'SELECT a.*, u.full_name AS user_name, u.email AS user_email FROM appointments a JOIN users u ON u.id = a.user_id ORDER BY a.scheduled_at DESC',
      countSql: 'SELECT COUNT(*) AS total FROM appointments',
      params: [], page, pageSize, offset, wantsPaged,
    });
  }
  try {
    const [rows] = await pool.query(
      'SELECT a.*, u.full_name AS user_name, u.email AS user_email FROM appointments a JOIN users u ON u.id = a.user_id ORDER BY a.scheduled_at DESC LIMIT ?',
      [legacyLimit]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/exams', requireCapability('appointments'), async (req, res, next) => {
  const { wantsPaged, page, pageSize, offset } = parsePagination(req.query, { defaultPageSize: 20 });
  const legacyLimit = Math.min(parseInt(req.query.limit, 10) || pageSize, 100);
  if (wantsPaged) {
    return pagedList(res, next, {
      baseSql: 'SELECT e.*, u.full_name AS user_name, u.email AS user_email FROM exams e JOIN users u ON u.id = e.user_id ORDER BY e.scheduled_at DESC',
      countSql: 'SELECT COUNT(*) AS total FROM exams',
      params: [], page, pageSize, offset, wantsPaged,
    });
  }
  try {
    const [rows] = await pool.query(
      'SELECT e.*, u.full_name AS user_name, u.email AS user_email FROM exams e JOIN users u ON u.id = e.user_id ORDER BY e.scheduled_at DESC LIMIT ?',
      [legacyLimit]
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
      'SELECT id, full_name, email, phone FROM users WHERE id = ?',
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
    });
    if (result.status !== 200) return res.status(result.status).json(result.body);
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

module.exports = router;
