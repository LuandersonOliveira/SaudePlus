const express = require('express');
const pool = require('../db');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { requireCapability, pode } = require('../middleware/capabilities');
const { audit } = require('../middleware/audit');
const { emailSchema } = require('../utils/validators');

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

/**
 * Derruba as sessões e os links de redefinição pendentes do usuário.
 *
 * Sem isto, desativar, rebaixar ou trocar a senha pelo admin deixava o
 * refresh token anterior valendo por até 30 dias — a pessoa continuava
 * entrando mesmo depois da medida administrativa.
 */
async function revokeAccess(userId) {
  await pool.query('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ? AND revoked = 0', [userId]);
  await pool.query(
    'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL',
    [userId]
  );
}

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

    // Soft delete: contas excluídas não voltam na listagem, nem na contagem.
    const filters = ['deleted_at IS NULL'];
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
    const whereClause = ' WHERE ' + filters.join(' AND ');
    sql += whereClause;
    sql += ' ORDER BY full_name LIMIT ? OFFSET ?';
    params.push(pageSize, offset);

    const [rows] = await pool.query(sql, params);
    const [[countRow]] = await pool.query('SELECT COUNT(*) AS total FROM users u' + whereClause, params.slice(0, -2));
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
      `SELECT u.id, u.full_name, u.social_name, u.email, u.role, u.account_status,
              u.phone, u.mobile, u.birth_date, u.gender, u.blood_type, u.admin_level,
              u.priority, u.race, u.guardian_name,
              u.mother_name, u.father_name,
              u.cpf, u.rg, u.cns,
              u.cep, u.street, u.address_number, u.neighborhood, u.city, u.state,
              u.job_role, u.created_at,
              p.id AS professional_id, p.name AS professional_name
       FROM users u
       LEFT JOIN professionals p ON p.user_id = u.id
       WHERE u.id = ? AND u.deleted_at IS NULL`,
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

// PATCH /admin/users/:id — altera dados cadastrais, account_status e/ou job_role
// Papel (role) só pode ser alterado diretamente no banco de dados.
//
// A rota exige 'users' (no router.use acima). Alterar o NÍVEL administrativo
// exige ainda a capability 'admins', que só o superadmin tem — verificado
// aqui, e não no middleware da rota, porque o payload decide: um gestor pode
// sim ativar uma conta e ajustar um cargo.
router.patch('/:id', async (req, res, next) => {
  try {
    const {
      account_status, job_role, admin_level, role, password,
      professional_id, unlink_professional, full_name, email, mobile, phone,
    } = req.body || {};
    // O motivo vai para a auditoria; o teto é o mesmo do sanitizeDetails.
    const reason = req.body && req.body.reason ? String(req.body.reason).slice(0, 1000) : '';
    const updates = [];
    const params = [];

    const [[currentUser]] = await pool.query(
      'SELECT account_status, job_role, admin_level, role, email, full_name, mobile, phone FROM users WHERE id = ? AND deleted_at IS NULL',
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

    // Credenciais de conta administrativa (e-mail de login e senha) equivalem a
    // assumir a conta: e-mail novo + "esqueci a senha" dá acesso total. Por isso
    // exigem a capability 'admins', como promover ou mudar nível. Sem isto, um
    // gestor (tem 'users', não tem 'admins') tomava contas admin de nível menor.
    // Só vale quando o e-mail REALMENTE muda: os formulários reenviam o e-mail atual a cada gravação,
    // e isso não pode bloquear a edição de outros campos (celular, cargo…).
    const trocaEmail = email !== undefined
      && String(email ?? '').trim().toLowerCase() !== String(currentUser.email || '').trim().toLowerCase();
    if (
      currentUser.role === 'admin' &&
      (trocaEmail || (password !== undefined && password !== '')) &&
      !pode('admins', req.user)
    ) {
      return res.status(403).json({
        error: 'Seu nível administrativo não permite alterar e-mail ou senha de administradores.',
      });
    }

    // Dados cadastrais: o painel edita nome, e-mail e telefones no mesmo
    // formulário que ativa a conta. Antes o PATCH ignorava esses campos em
    // silêncio — o admin salvava e o valor antigo permanecia.
    let novoNome;
    let novoEmail;
    if (full_name !== undefined) {
      novoNome = String(full_name ?? '').trim();
      if (novoNome.length < 2 || novoNome.length > 150) {
        return res.status(400).json({ error: 'Nome deve ter entre 2 e 150 caracteres.' });
      }
      updates.push('full_name=?'); params.push(novoNome);
    }
    if (email !== undefined) {
      const parsed = emailSchema.safeParse(email);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0].message });
      }
      novoEmail = parsed.data;
      const [[emUso]] = await pool.query(
        'SELECT id FROM users WHERE LOWER(email) = ? AND id <> ? LIMIT 1',
        [novoEmail, req.params.id]
      );
      if (emUso) return res.status(409).json({ error: 'Este e-mail já está em uso por outra conta.' });
      updates.push('email=?'); params.push(novoEmail);
    }
    for (const [campo, valor] of [['mobile', mobile], ['phone', phone]]) {
      if (valor === undefined) continue;
      const texto = String(valor ?? '').trim();
      if (texto.length > 30) {
        return res.status(400).json({ error: `Campo "${campo}" excede o tamanho máximo (30 caracteres).` });
      }
      updates.push(`${campo}=?`); params.push(texto || null);
    }

    if (account_status !== undefined) {
      if (!SAFE_STATUSES.includes(account_status)) {
        return res.status(400).json({ error: 'Status inválido.' });
      }
      if (req.params.id === req.user.id) {
        return res.status(400).json({ error: 'Você não pode alterar o status da própria conta.' });
      }
      updates.push('account_status=?'); params.push(account_status);
    }
    if (job_role !== undefined) {
      updates.push('job_role=?'); params.push(job_role || null);
    }
    if (role !== undefined) {
      if (!SAFE_ROLES.includes(role)) return res.status(400).json({ error: 'Papel inválido.' });
      if (req.params.id === req.user.id) return res.status(400).json({ error: 'Você não pode alterar o próprio papel.' });
      // Promover a admin é criar um par de privilégio: exige a capability
      // 'admins'. Sem isto, um gestor (que tem 'users') promovia qualquer
      // conta a administrador.
      if (role === 'admin' && currentUser.role !== 'admin' && !pode('admins', req.user)) {
        return res.status(403).json({ error: 'Seu nível administrativo não permite criar administradores.' });
      }
      if (currentUser.role === 'admin' && role !== 'admin') {
        const targetRank = rankDe(currentUser.admin_level);
        if (actorRank(req.user) <= targetRank) {
          return res.status(403).json({ error: 'Você não pode rebaixar um administrador igual ou superior.' });
        }
      }
      updates.push('role=?'); params.push(role);
    }
    if (admin_level !== undefined) {
      if (!pode('admins', req.user)) return res.status(403).json({ error: 'Seu nível administrativo não permite alterar níveis de outros administradores.' });
      if (!SAFE_ADMIN_LEVELS.includes(admin_level)) return res.status(400).json({ error: 'Nível administrativo inválido.' });
      if ((LEVEL_RANK[admin_level] ?? 0) < actorRank(req.user)) {
        return res.status(403).json({ error: 'Você não pode definir um nível abaixo do seu.' });
      }
      updates.push('admin_level=?'); params.push(admin_level);
    }
    if (password !== undefined && password !== '') {
      if (String(password).length < 6) return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres.' });
      const bcrypt = require('bcryptjs');
      updates.push('password_hash=?'); params.push(await bcrypt.hash(String(password), 10));
    }

    if (updates.length) {
      params.push(req.params.id);
      const [result] = await pool.query(
        `UPDATE users SET ${updates.join(', ')} WHERE id=? AND deleted_at IS NULL`, params
      );
      if (result.affectedRows === 0) return res.status(400).json({ error: 'Nenhuma alteração foi realizada.' });
    }

    // Medidas administrativas que tiram poder do titular precisam encerrar a
    // sessão: senha trocada, papel rebaixado/trocado ou conta desativada.
    const desativa = account_status !== undefined && account_status !== 'ativo';
    const mudaPapel = role !== undefined && role !== currentUser.role;
    const mudaSenha = password !== undefined && password !== '';
    // Trocar o e-mail muda a identidade de login: a sessão antiga (emitida com
    // o e-mail anterior) precisa morrer junto.
    const mudaEmail = novoEmail !== undefined && novoEmail !== currentUser.email;
    if (desativa || mudaPapel || mudaSenha || mudaEmail) {
      await revokeAccess(req.params.id);
    }

    // Vincular/desvincular profissional / auto-sincronizar
    const targetRole = role !== undefined ? role : currentUser.role;
    if (role !== undefined && role !== currentUser.role && currentUser.role === 'atendente' && targetRole !== 'atendente') {
      await pool.query('UPDATE professionals SET user_id = NULL WHERE user_id = ?', [req.params.id]);
    }
    if (unlink_professional) {
      await pool.query('UPDATE professionals SET user_id = NULL WHERE user_id = ?', [req.params.id]);
    } else if (targetRole === 'atendente') {
      if (professional_id) {
        const [[p]] = await pool.query('SELECT id, user_id FROM professionals WHERE id = ? AND active = 1', [professional_id]);
        if (!p) return res.status(400).json({ error: 'Profissional não encontrado ou inativo.' });
        if (p.user_id && p.user_id !== req.params.id) return res.status(400).json({ error: 'Profissional já vinculado a outro atendente.' });
        await pool.query('UPDATE professionals SET user_id = NULL WHERE user_id = ?', [req.params.id]);
        await pool.query('UPDATE professionals SET user_id = ? WHERE id = ?', [req.params.id, professional_id]);
      }
      const [[existing]] = await pool.query('SELECT id FROM professionals WHERE user_id = ?', [req.params.id]);
      if (!existing) {
        const crypto = require('crypto');
        const [[u]] = await pool.query('SELECT full_name, job_role FROM users WHERE id = ?', [req.params.id]);
        const pid = crypto.randomUUID();
        await pool.query(
          'INSERT INTO professionals (id, name, job_title, registry, active, user_id) VALUES (?,?,?,?,1,?)',
          [pid, u.full_name || u.job_role || 'Atendente', u.job_role || 'Atendente', null, req.params.id]
        );
      } else if (job_role) {
        await pool.query('UPDATE professionals SET name = COALESCE(name, ?), job_title = ? WHERE user_id = ?', [job_role, job_role, req.params.id]);
      }
    } else if (targetRole !== 'atendente') {
      await pool.query('UPDATE professionals SET user_id = NULL WHERE user_id = ?', [req.params.id]);
    }

    const changes = [];
    if (novoNome !== undefined && novoNome !== currentUser.full_name) changes.push(`nome: ${currentUser.full_name||'-'}->${novoNome}`);
    if (mudaEmail) changes.push(`email: ${currentUser.email||'-'}->${novoEmail}`);
    if (mobile !== undefined && (String(mobile ?? '').trim() || null) !== (currentUser.mobile || null)) changes.push('celular alterado');
    if (phone !== undefined && (String(phone ?? '').trim() || null) !== (currentUser.phone || null)) changes.push('telefone alterado');
    if (account_status !== undefined && account_status !== currentUser.account_status) changes.push(`status: ${currentUser.account_status}->${account_status}`);
    if (role !== undefined && role !== currentUser.role) changes.push(`role: ${currentUser.role}->${role}`);
    if (job_role !== undefined && job_role !== currentUser.job_role) changes.push(`cargo: ${currentUser.job_role||'-'}->${job_role||'-'}`);
    if (admin_level !== undefined && admin_level !== currentUser.admin_level) changes.push(`admin_level: ${currentUser.admin_level||'-'}->${admin_level}`);
    if (password !== undefined && password !== '') changes.push('senha alterada');
    if (professional_id && targetRole === 'atendente') changes.push(`profissional vinculado: ${professional_id}`);
    if (unlink_professional) changes.push('profissional desvinculado');
    if (reason) changes.push(`motivo: ${reason}`);
    await req.audit('admin_update_user', 'user', req.params.id, changes.join('; ') || 'atualização');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /admin/users - criar novo usuário
router.post('/', async (req, res, next) => {
  try {
    const { full_name, email, password, role, account_status, job_role, admin_level, professional_id, mobile, phone } = req.body || {};
    if (!full_name || !email || !password) return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios.' });
    if (String(password).length < 6) return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres.' });
    const nome = String(full_name).trim();
    if (nome.length < 2 || nome.length > 150) return res.status(400).json({ error: 'Nome deve ter entre 2 e 150 caracteres.' });
    const parsedEmail = emailSchema.safeParse(email);
    if (!parsedEmail.success) return res.status(400).json({ error: parsedEmail.error.issues[0].message });
    const tel = (v) => { const t = String(v ?? '').trim(); return t || null; };
    if ((tel(mobile) || '').length > 30 || (tel(phone) || '').length > 30) {
      return res.status(400).json({ error: 'Telefone excede o tamanho máximo (30 caracteres).' });
    }
    const r = role && SAFE_ROLES.includes(role) ? role : 'paciente';
    if (r === 'admin' && !pode('admins', req.user)) return res.status(403).json({ error: 'Sem permissão para criar administradores.' });
    const s = account_status && SAFE_STATUSES.includes(account_status) ? account_status : (r === 'atendente' ? 'pendente' : 'ativo');
    const normalizedEmail = parsedEmail.data;
    // A coluna `email` é UNIQUE global: e-mail de conta soft-deleted continua
    // reservado. Filtrar `deleted_at` aqui deixava o INSERT estourar 500 em vez
    // de responder 409.
    const [[ex]] = await pool.query('SELECT id FROM users WHERE LOWER(email)=?', [normalizedEmail]);
    if (ex) return res.status(409).json({ error: 'E-mail já cadastrado.' });

    // Valida o vínculo ANTES de criar a conta: recusar depois deixaria um
    // usuário órfão no banco a cada tentativa inválida.
    if (r === 'atendente' && professional_id) {
      const [[p]] = await pool.query('SELECT id, user_id FROM professionals WHERE id = ? AND active = 1', [professional_id]);
      if (!p) return res.status(400).json({ error: 'Profissional não encontrado ou inativo.' });
      if (p.user_id) return res.status(400).json({ error: 'Profissional já vinculado a outro atendente.' });
    }

    const bcrypt = require('bcryptjs');
    const crypto = require('crypto');
    const id = crypto.randomUUID();
    const hash = await bcrypt.hash(String(password), 10);
    await pool.query(
      `INSERT INTO users (id, full_name, email, password_hash, role, account_status, job_role, admin_level, mobile, phone)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, nome, normalizedEmail, hash, r, s, job_role || null, r === 'admin' ? (admin_level || 'gestor') : null, tel(mobile), tel(phone)]
    );

    if (r === 'atendente') {
      if (professional_id) {
        await pool.query('UPDATE professionals SET user_id = ? WHERE id = ?', [id, professional_id]);
      } else {
        // Auto-criar profissional para o atendente
        const [[existing]] = await pool.query('SELECT id FROM professionals WHERE user_id = ?', [id]);
        if (!existing) {
          const pid = crypto.randomUUID();
          await pool.query(
            'INSERT INTO professionals (id, name, job_title, registry, active, user_id) VALUES (?,?,?,?,1,?)',
            [pid, nome, job_role || 'Atendente', null, id]
          );
        }
      }
    }

    await req.audit('admin_create_user', 'user', id, `criado: ${normalizedEmail} role=${r} status=${s}`);
    res.status(201).json({ ok: true, id });
  } catch (err) {
    next(err);
  }
});

// DELETE /admin/users/:id - soft delete
router.delete('/:id', async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'Você não pode excluir a própria conta.' });
    const [[currentUser]] = await pool.query(
      'SELECT full_name, email, role, admin_level FROM users WHERE id = ? AND deleted_at IS NULL',
      [req.params.id]
    );
    if (!currentUser) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (currentUser.role === 'admin') {
      const targetRank = rankDe(currentUser.admin_level);
      if (actorRank(req.user) <= targetRank) {
        return res.status(403).json({ error: 'Você não pode excluir um administrador igual ou superior.' });
      }
    }
    await pool.query('UPDATE professionals SET user_id = NULL WHERE user_id = ?', [req.params.id]);
    await pool.query('UPDATE users SET deleted_at = NOW() WHERE id = ?', [req.params.id]);
    await revokeAccess(req.params.id);
    await req.audit('admin_delete_user', 'user', req.params.id, `excluído: ${currentUser.email} (${currentUser.full_name})`);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
