const express = require('express');
const pool = require('../db');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { requireCapability, pode } = require('../middleware/capabilities');
const { audit } = require('../middleware/audit');

const router = express.Router();
router.use(verifyToken, requireAdmin);

// Segurança (P0.4): a gestão de usuários passa a exigir a permissão 'users'.
// Até aqui `admin_level` só era usado para trocar o nível de outro admin —
// qualquer admin (inclusive 'atendimento'/'alertas') tinha poder total aqui.
router.use(requireCapability('users'));

// Hierarquia de privilégio — impede escalonamento lateral (P0.4).
// Um admin não pode alterar o status de alguém de nível igual ou superior.
const LEVEL_RANK = { superadmin: 4, gestor: 3, atendimento: 2, alertas: 1 };

// Sem `?? LEVEL_RANK.gestor`: nível ausente não pode virar gestor no cálculo
// de rank — era o mesmo fail-open do middleware, aqui numa segunda forma.
// Um alvo admin sem nível explícito simplesmente não é rebaixável por esta via.
function rankDe(adminLevel) {
  const r = LEVEL_RANK[adminLevel];
  return typeof r === 'number' ? r : 0;
}

function actorRank(user) {
  return rankDe(user && user.admin_level);
}

const SAFE_ROLES = ['paciente', 'atendente', 'admin'];
const SAFE_STATUSES = ['ativo', 'inativo', 'pendente'];
const SAFE_ADMIN_LEVELS = ['superadmin', 'gestor', 'atendimento', 'alertas'];

// GET /admin/users — lista todos os usuários (SEM cpf/rg — só no endpoint individual)
router.get('/', async (req, res, next) => {
  try {
    const role = req.query.role;
    const status = req.query.status;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 50, 1), 100);
    const offset = (page - 1) * pageSize;
    const query = req.query.q !== undefined ? req.query.q : req.query.email;
    const search = query ? String(query).toLowerCase().trim() : null;

    const filters = [];
    let sql = `SELECT id, full_name, social_name, email, role, account_status,
                      phone, mobile, birth_date, gender, priority, race, job_role, admin_level, created_at, last_login_at
           FROM users`;
    const params = [];
    if (role && SAFE_ROLES.includes(role)) { filters.push('role = ?'); params.push(role); }
    if (status && SAFE_STATUSES.includes(status)) { filters.push('account_status = ?'); params.push(status); }
    if (search) {
      filters.push('(LOWER(full_name) LIKE ? OR LOWER(email) LIKE ? OR phone LIKE ? OR mobile LIKE ?)');
      const pattern = '%' + search + '%';
      params.push(pattern, pattern, pattern, pattern);
    }
    const whereClause = filters.length ? ' WHERE ' + filters.join(' AND ') : '';
    sql += whereClause;
    sql += ' ORDER BY full_name LIMIT ? OFFSET ?';
    params.push(pageSize, offset);

    const [rows] = await pool.query(sql, params);
    const [[countRow]] = await pool.query('SELECT COUNT(*) AS total FROM users' + whereClause, params.slice(0, -2));
    res.json({ data: rows, page, pageSize, total: Number(countRow.total) });
  } catch (err) {
    next(err);
  }
});

// GET /admin/users/:id — perfil completo incluindo CPF/RG (admin only).
// A leitura dos documentos é auditada pelo middleware declarativo (Fase 3).
router.get('/:id',
  audit('admin_view_user_docs', 'user', (req) => req.params.id, 'visualizou documentos'),
  async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, full_name, social_name, email, role, account_status,
              phone, mobile, birth_date, gender, blood_type, admin_level,
              priority, race, guardian_name,
              mother_name, father_name,
              cpf, rg, cns,
              cep, street, address_number, neighborhood, city, state,
              job_role, created_at
       FROM users WHERE id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado.' });
    // Fase 1: documentos saem cifrados do banco e são decifrados só aqui,
    // no endpoint que já exige requireAdmin.
    const user = rows[0];
    for (const col of ['cpf', 'rg', 'cns']) {
      try { user[col] = req.decryptDoc(user[col]); } catch { user[col] = '[ilegível: chave ausente]'; }
    }
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// PATCH /admin/users/:id — altera account_status e/ou job_role
// Papel (role) só pode ser alterado diretamente no banco de dados.
//
// A rota exige 'users' (no router.use acima). Alterar o NÍVEL administrativo
// exige ainda a capability 'admins', que só o superadmin tem — verificado
// aqui, e não no middleware da rota, porque o payload decide: um gestor pode
// sim ativar uma conta e ajustar um cargo.
router.patch('/:id', async (req, res, next) => {
  try {
    const { account_status, job_role, admin_level, reason, status_notes } = req.body || {};
    const updates = [];
    const params = [];
    const logParts = [];

    const [[currentUser]] = await pool.query(
      'SELECT account_status, job_role, admin_level, role FROM users WHERE id = ?',
      [req.params.id]
    );
    if (!currentUser) return res.status(404).json({ error: 'Usuário não encontrado.' });

    // Segurança (P0.4): escalonamento lateral. Um admin de nível inferior
    // (ou igual) não pode desativar nem rebaixar alguém de nível superior —
    // antes isso permitia, por exemplo, um 'atendimento' desativar o superadmin.
    if (currentUser.role === 'admin') {
      const targetRank = rankDe(currentUser.admin_level);
      if (actorRank(req.user) <= targetRank) {
        return res.status(403).json({
          error: 'Você não pode alterar uma conta de nível administrativo igual ou superior ao seu.',
        });
      }
    }

    if (account_status !== undefined) {
      if (!SAFE_STATUSES.includes(account_status)) {
        return res.status(400).json({ error: 'Status inválido.' });
      }
      if (req.params.id === req.user.id) {
        return res.status(400).json({ error: 'Você não pode alterar o status da própria conta.' });
      }
      // O motivo vai para o details da auditoria. Teto de 1000 = o mesmo do
      // sanitizeDetails; sem ele o campo aceitaria payload ilimitado.
      const statusReason = String(reason || status_notes || '').trim().slice(0, 1000);
      if (account_status !== currentUser.account_status && !statusReason) {
        return res.status(400).json({ error: 'Informe o motivo da alteração de status.' });
      }
      updates.push('account_status=?'); params.push(account_status); logParts.push(`status -> ${account_status}`);
      if (statusReason) logParts.push(`motivo: ${statusReason}`);
    }
    if (job_role !== undefined) {
      updates.push('job_role=?'); params.push(job_role || null); logParts.push(`cargo -> ${job_role}`);
    }
    if (admin_level !== undefined) {
      if (!pode('admins', req.user)) return res.status(403).json({ error: 'Seu nível administrativo não permite alterar níveis de outros administradores.' });
      if (!SAFE_ADMIN_LEVELS.includes(admin_level)) return res.status(400).json({ error: 'Nível administrativo inválido.' });
      // Não pode rebaixar para baixo do próprio nível.
      if ((LEVEL_RANK[admin_level] ?? 0) < actorRank(req.user)) {
        return res.status(403).json({ error: 'Você não pode definir um nível abaixo do seu.' });
      }
      updates.push('admin_level=?'); params.push(admin_level); logParts.push(`nível admin -> ${admin_level}`);
    }

    if (!updates.length) return res.status(400).json({ error: 'Nada para atualizar.' });

    params.push(req.params.id);
    const [result] = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id=?`, params
    );
    if (result.affectedRows === 0) return res.status(400).json({ error: 'Nenhuma alteração foi realizada.' });

    const previous = [];
    if (account_status !== undefined && account_status !== currentUser.account_status) {
      previous.push(`status: ${currentUser.account_status} -> ${account_status}`);
    }
    if (job_role !== undefined && job_role !== currentUser.job_role) {
      previous.push(`cargo: ${currentUser.job_role || 'não informado'} -> ${job_role || 'não informado'}`);
    }
    if (admin_level !== undefined && admin_level !== currentUser.admin_level) {
      previous.push(`nível admin: ${currentUser.admin_level || 'gestor'} -> ${admin_level}`);
    }
    await req.audit('admin_update_user', 'user', req.params.id,
      `${previous.join('; ')}${logParts.length ? `; ${logParts.join('; ')}` : ''}`);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
