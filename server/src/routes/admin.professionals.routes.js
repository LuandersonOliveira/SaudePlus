/* ==========================================================================
   Saúde+ — Gestão administrativa de profissionais e agenda
   (TAREFAS V3, itens 4.4 e 4.6)

   Cada alteração é registrada na auditoria com administrador, data,
   unidade e motivo. A rota valida a permissão, chama o serviço
   (services/adminProfessionals.js) e registra a auditoria; a desativação (PATCH)
   segue aqui até o passo 8d do A1.
   ========================================================================== */
const express = require('express');
const pool = require('../db');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { requireCapability } = require('../middleware/capabilities');
const { registrarEvento } = require('../services/booking-events');
const mailer = require('../services/mailer');
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

// PATCH /admin/professionals/:id - editar, ativar/desativar
router.patch('/:id', async (req, res, next) => {
  const { name, job_title: jobTitle, registry, active } = req.body || {};
  const updates = [];
  const params = [];
  const details = [];

  try {
    const [[current]] = await pool.query(
      'SELECT name, job_title, registry, active FROM professionals WHERE id = ?',
      [req.params.id]
    );
    if (!current) return res.status(404).json({ error: 'Profissional não encontrado.' });

    if (name !== undefined) {
      const v = String(name).trim();
      if (!v) return res.status(400).json({ error: 'Nome do profissional é obrigatório.' });
      if (v !== current.name) { updates.push('name=?'); params.push(v); details.push(`nome -> ${v}`); }
    }
    if (jobTitle !== undefined) {
      updates.push('job_title=?'); params.push(jobTitle || null);
      details.push(`cargo -> ${jobTitle || 'não informado'}`);
    }
    if (registry !== undefined) {
      updates.push('registry=?'); params.push(registry || null);
      details.push(`registro -> ${registry || 'não informado'}`);
    }

    const desativando = active !== undefined && !Number(active) && Number(current.active) === 1;
    if (active !== undefined) {
      const v = Number(active) ? 1 : 0;
      if (v !== Number(current.active)) {
        updates.push('active=?'); params.push(v);
        details.push(v ? 'profissional ativado' : 'profissional desativado');
      }
    }
    if (!updates.length) return res.status(400).json({ error: 'Nada para atualizar.' });

    let affected = [];
    let conn = null;
    try {
      if (desativando) {
        conn = await pool.getConnection();
        await conn.beginTransaction();
      }
      const exec = conn || pool;
      params.push(req.params.id);
      await exec.query(`UPDATE professionals SET ${updates.join(', ')} WHERE id=?`, params);

      if (desativando) {
        const [futureAppointments] = await exec.query(
          `SELECT id, user_id, scheduled_at FROM appointments
           WHERE professional_id = ? AND status IN ('pendente', 'confirmado')
             AND scheduled_at >= NOW()`,
          [req.params.id]
        );
        const [futureExams] = await exec.query(
          `SELECT id, user_id, scheduled_at FROM exams
           WHERE professional_id = ? AND status IN ('pendente', 'confirmado')
             AND scheduled_at >= NOW()`,
          [req.params.id]
        );

        for (const rec of futureAppointments) {
          await exec.query(
            `UPDATE appointments SET status = 'para_remarcar', reschedule_reason = 'profissional_inativado'
             WHERE id = ?`,
            [rec.id]
          );
          await registrarEvento(exec, {
            kind: 'consulta',
            bookingId: rec.id,
            eventType: 'professional_deactivated',
            fromScheduledAt: rec.scheduled_at,
            toScheduledAt: rec.scheduled_at,
            fromProfessionalId: req.params.id,
            toProfessionalId: req.params.id,
            reason: 'profissional_inativado',
            actorUserId: req.user.id,
          });
        }
        for (const rec of futureExams) {
          await exec.query(
            `UPDATE exams SET status = 'para_remarcar', reschedule_reason = 'profissional_inativado'
             WHERE id = ?`,
            [rec.id]
          );
          await registrarEvento(exec, {
            kind: 'exame',
            bookingId: rec.id,
            eventType: 'professional_deactivated',
            fromScheduledAt: rec.scheduled_at,
            toScheduledAt: rec.scheduled_at,
            fromProfessionalId: req.params.id,
            toProfessionalId: req.params.id,
            reason: 'profissional_inativado',
            actorUserId: req.user.id,
          });
        }
        affected = [...futureAppointments, ...futureExams];
        details.push(`${affected.length} registro(s) movido(s) para remarcar`);
        if (conn) {
          await conn.commit();
          conn.release();
          conn = null;
        }
      }

      const reason = motivoDe(req);
      await req.audit('admin_update_professional', 'professional', req.params.id,
        `${details.join('; ')}${reason ? `; motivo: ${reason}` : ''}`);

      if (affected.length) {
        const ids = [...new Set(affected.map((r) => r.user_id))];
        const [users] = await pool.query(
          `SELECT id, full_name, email FROM users WHERE id IN (?)`, [ids]
        );
        for (const u of users) {
          if (!u.email) continue;
          try {
            await mailer.enviar({
              para: u.email,
              assunto: 'Profissional indisponível - reagendamento',
              texto: `Olá ${u.full_name || ''}, seu atendimento foi movido para a fila de remarcação.`,
            });
          } catch (err) { /* best-effort */ }
        }
      }

      res.json({ ok: true, moved: affected.length });
    } catch (err) {
      if (conn) {
        await conn.rollback().catch(() => {});
        conn.release();
      }
      next(err);
    }
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
