/* ==========================================================================
   Saúde+ — Gestão administrativa de profissionais e agenda
   (TAREFAS V3, itens 4.4 e 4.6)

   Cada alteração é registrada na auditoria com administrador, data,
   unidade e motivo. A rota valida a permissão, chama o serviço
   (services/adminProfessionals.js) e registra a auditoria.
   ========================================================================== */
const express = require('express');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { requireCapability } = require('../middleware/capabilities');
const svc = require('../services/adminProfessionals');
const { motivoDe } = require('../schemas/adminProfessionals');

const router = express.Router();
// P3: gestão de profissionais/agenda exige a permissão 'units'.
router.use(verifyToken, requireAdmin, requireCapability('units'));

/**
 * Responde o resultado de um serviço de escrita: recusa com o status dele ou, em sucesso,
 * audita (`acao` sobre a entidade e o id que o serviço devolveu) e responde com o status
 * de sucesso (201 com { id } ou 204 sem corpo).
 */
async function responder(req, res, r, { acao, sucesso }) {
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  await req.audit(acao, r.entidade, r.id, r.auditoria);
  if (sucesso === 204) return res.status(204).end();
  return res.status(sucesso).json({ id: r.id });
}

// GET /admin/professionals — lista completa com vínculos, horários e bloqueios
router.get('/', async (req, res, next) => {
  try {
    res.json(await svc.listar());
  } catch (err) { next(err); }
});

// POST /admin/professionals — cadastrar profissional
router.post('/', async (req, res, next) => {
  try {
    const r = await svc.criarProfissional(req.body, motivoDe(req));
    await responder(req, res, r, { acao: 'create', sucesso: 201 });
  } catch (err) { next(err); }
});

// PATCH /admin/professionals/:id — editar, ativar/desativar.
// Desativar manda os atendimentos futuros para a fila "Para remarcar" (mesma transação).
router.patch('/:id', async (req, res, next) => {
  try {
    const r = await svc.atualizarProfissional({
      id: req.params.id, body: req.body, reason: motivoDe(req), actorId: req.user.id,
    });
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    await req.audit('admin_update_professional', 'professional', req.params.id, r.auditoria);
    await svc.avisarPacientes(r.userIds); // melhor esforço, depois do commit e da auditoria
    res.json({ ok: true, moved: r.moved });
  } catch (err) { next(err); }
});

// POST /admin/professionals/:id/offers — vínculo profissional <-> unidade <-> serviço
router.post('/:id/offers', async (req, res, next) => {
  try {
    const r = await svc.adicionarVinculo(req.params.id, req.body, motivoDe(req));
    await responder(req, res, r, { acao: 'create', sucesso: 201 });
  } catch (err) { next(err); }
});

router.delete('/:id/offers/:offerId', async (req, res, next) => {
  try {
    const r = await svc.removerVinculo(req.params.id, req.params.offerId, motivoDe(req));
    await responder(req, res, r, { acao: 'delete', sucesso: 204 });
  } catch (err) { next(err); }
});

// POST /admin/professionals/:id/schedules — dias/horários de atendimento
router.post('/:id/schedules', async (req, res, next) => {
  try {
    const r = await svc.adicionarHorario(req.params.id, req.body, motivoDe(req));
    await responder(req, res, r, { acao: 'create', sucesso: 201 });
  } catch (err) { next(err); }
});

router.delete('/:id/schedules/:scheduleId', async (req, res, next) => {
  try {
    const r = await svc.removerHorario(req.params.id, req.params.scheduleId, motivoDe(req));
    await responder(req, res, r, { acao: 'delete', sucesso: 204 });
  } catch (err) { next(err); }
});

// POST /admin/professionals/:id/blocks — folgas, intervalos e bloqueios
router.post('/:id/blocks', async (req, res, next) => {
  try {
    const r = await svc.adicionarBloqueio(req.params.id, req.body, motivoDe(req));
    await responder(req, res, r, { acao: 'create', sucesso: 201 });
  } catch (err) { next(err); }
});

router.delete('/:id/blocks/:blockId', async (req, res, next) => {
  try {
    const r = await svc.removerBloqueio(req.params.id, req.params.blockId, motivoDe(req));
    await responder(req, res, r, { acao: 'delete', sucesso: 204 });
  } catch (err) { next(err); }
});

module.exports = router;
