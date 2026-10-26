const express = require('express');
const pool = require('../db');
const { verifyToken, requireStaff } = require('../middleware/auth');
const { applyBookingChange } = require('../utils/booking');
const { parsePagination } = require('../utils/validators');

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
    const result = await applyBookingChange(pool, {
      kindKey: req.params.kind,
      id: req.params.id,
      body: req.body || {},
    });
    if (result.status !== 200) return res.status(result.status).json(result.body);
    await req.audit('staff_update', result.audit.entityType, req.params.id, result.audit.details);
    res.json(result.body);
  } catch (err) { next(err); }
});

module.exports = router;
