/* ==========================================================================
   Saúde+ — gestão administrativa de usuários (rotas).

   A rota valida a entrada, chama o serviço (services/adminUsers.js), audita e
   responde. A hierarquia entre administradores está em utils/adminHierarchy.js.
   ========================================================================== */
const express = require('express');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { requireCapability, pode } = require('../middleware/capabilities');
const { audit } = require('../middleware/audit');
const { validate } = require('../middleware/validate');
const { criarUsuarioBody, redefinirMfaBody } = require('../schemas/adminUsers');
const svc = require('../services/adminUsers');

const router = express.Router();
router.use(verifyToken, requireAdmin);

// Segurança (P0.4): a gestão de usuários exige a permissão 'users'. Antes, `admin_level`
// só era usado para trocar o nível de outro admin — qualquer admin (inclusive
// 'atendimento'/'alertas') tinha poder total aqui.
router.use(requireCapability('users'));

const recusar = (res, r) => res.status(r.status).json({ error: r.error });

// GET /admin/users — lista todos os usuários (SEM cpf/rg — só no endpoint individual)
router.get('/', async (req, res, next) => {
  try {
    res.json(await svc.listarUsuarios(req.query));
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
      const r = await svc.obterUsuario(req.params.id, { decrypt: req.decryptDoc });
      if (!r.ok) return recusar(res, r);
      res.json(r.user);
    } catch (err) {
      next(err);
    }
  });

// PATCH /admin/users/:id — altera dados cadastrais, status, cargo, papel, nível, senha e vínculo.
//
// A rota exige 'users' (no router.use acima). Alterar o NÍVEL administrativo, o e-mail ou a
// senha de um admin exige ainda a capability 'admins', que só o superadmin tem — decidida
// pelo payload (adminHierarchy), e não no middleware: um gestor pode sim ativar uma conta e
// ajustar um cargo.
router.patch('/:id', async (req, res, next) => {
  try {
    const podeAdmins = pode('admins', req.user);
    const r = await svc.atualizarUsuario({ actor: req.user, id: req.params.id, body: req.body, podeAdmins });
    if (!r.ok) return recusar(res, r);
    await req.audit('admin_update_user', 'user', req.params.id, r.auditoria);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /admin/users — criar novo usuário
router.post('/', validate(criarUsuarioBody), async (req, res, next) => {
  try {
    const podeAdmins = pode('admins', req.user);
    const r = await svc.criarUsuario({ actor: req.user, body: req.body, podeAdmins });
    if (!r.ok) return recusar(res, r);
    await req.audit('admin_create_user', 'user', r.id, r.auditoria);
    res.status(201).json({ ok: true, id: r.id });
  } catch (err) {
    next(err);
  }
});

// POST /admin/users/:id/mfa/reset — superadmin redefine o segundo fator de um atendente/admin que perdeu o
// aparelho (ADR-0010). Capability 'admins' (só superadmin) e a SENHA de quem redefine no corpo.
router.post('/:id/mfa/reset', requireCapability('admins'), validate(redefinirMfaBody), async (req, res, next) => {
  try {
    const r = await svc.redefinirMfa({ actor: req.user, id: req.params.id, password: req.body.password });
    if (!r.ok) return recusar(res, r);
    await req.audit('mfa_reset', 'user', req.params.id, r.auditoria);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /admin/users/:id — exclusão = anonimização, irreversível (ADR-0009). Para algo
// reversível, o admin usa PATCH com account_status = 'inativo'.
router.delete('/:id', async (req, res, next) => {
  try {
    const r = await svc.excluirUsuario({ actor: req.user, id: req.params.id });
    if (!r.ok) return recusar(res, r);
    await req.audit('admin_delete_user', 'user', req.params.id, r.auditoria);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
