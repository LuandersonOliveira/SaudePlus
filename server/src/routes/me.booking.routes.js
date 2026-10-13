/* ==========================================================================
   Saúde+ — CRUD próprio de agendamentos (Fase 2, item 3)

   Uma única fábrica serve consultas e exames. As URLs continuam idênticas
   (/me/appointments e /me/exams); só a implementação foi unificada.
   Auditoria NÃO mora aqui (Fase 3, item 2) — só CRUD + validação.
   ========================================================================== */
const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const { verifyToken } = require('../middleware/auth');
const { TIPOS, validateBooking, validateScheduleWindow } = require('../utils/booking');

const LABELS = {
  consulta: {
    required: 'Especialidade, local e data/hora são obrigatórios.',
    noUnit: 'Selecione a unidade de saúde.',
    notFound: 'Consulta não encontrada.',
    closed: 'Esta consulta já está concluída ou cancelada.',
    editClosed: 'Não é possível editar uma consulta já concluída ou cancelada.',
  },
  exame: {
    required: 'Tipo de exame, local e data/hora são obrigatórios.',
    noUnit: 'Selecione a unidade de saúde.',
    notFound: 'Exame não encontrado.',
    closed: 'Este exame já está concluído ou cancelado.',
    editClosed: 'Não é possível editar um exame já concluído ou cancelado.',
  },
};

function createBookingRouter(tipo) {
  const meta = TIPOS[tipo];
  if (!meta) throw new Error(`tipo de agendamento inválido: ${tipo}`);
  const { table, serviceColumn } = meta;
  const msg = LABELS[tipo];
  const hasDoctor = tipo === 'consulta';

  const router = express.Router();
  router.use(verifyToken);

  // GET / — somente os registros do usuário logado
  router.get('/', async (req, res, next) => {
    try {
      const [rows] = await pool.query(
        `SELECT * FROM ${table} WHERE user_id = ? ORDER BY scheduled_at DESC`,
        [req.user.id]
      );
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const body = req.body || {};
      const serviceName = hasDoctor ? body.specialty : body.exam_type;
      const { location, scheduled_at, unit_id, professional_id, notes } = body;
      if (!serviceName || !location || !scheduled_at) {
        return res.status(400).json({ error: msg.required });
      }
      if (!unit_id) {
        return res.status(400).json({ error: msg.noUnit });
      }

      // Regras de disponibilidade validadas no servidor (item 4.5)
      const bookingError = await validateBooking(pool, {
        tipo,
        unitId: unit_id,
        professionalId: professional_id || null,
        serviceName,
        scheduledAt: scheduled_at,
      });
      if (bookingError) return res.status(409).json({ error: bookingError });

      let doctorName = hasDoctor ? (body.doctor || null) : null;
      if (hasDoctor && professional_id) {
        const [[prof]] = await pool.query('SELECT name FROM professionals WHERE id = ?', [professional_id]);
        if (prof) doctorName = prof.name;
      }

      const id = crypto.randomUUID();
      const columns = ['id', 'user_id', serviceColumn];
      const values = [id, req.user.id, serviceName];
      if (hasDoctor) { columns.push('doctor'); values.push(doctorName); }
      columns.push('location', 'unit_id', 'professional_id', 'scheduled_at', 'notes');
      values.push(location, unit_id, professional_id || null, scheduled_at, notes || null);

      await pool.query(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(',')})`,
        values
      );
      res.status(201).json({ id });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /:id/cancel — soft-cancel: marca como cancelado, NÃO apaga do banco
  router.patch('/:id/cancel', async (req, res, next) => {
    try {
      const [[existing]] = await pool.query(
        `SELECT status FROM ${table} WHERE id = ? AND user_id = ?`,
        [req.params.id, req.user.id]
      );
      if (!existing) return res.status(404).json({ error: msg.notFound });
      if (existing.status === 'concluido' || existing.status === 'cancelado') {
        return res.status(409).json({ error: msg.closed });
      }
      await pool.query(
        `UPDATE ${table} SET status = ? WHERE id = ? AND user_id = ?`,
        ['cancelado', req.params.id, req.user.id]
      );
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.put('/:id', async (req, res, next) => {
    try {
      const body = req.body || {};
      const serviceName = hasDoctor ? body.specialty : body.exam_type;
      const { location, scheduled_at, unit_id, professional_id, notes } = body;
      if (!serviceName || !location || !scheduled_at) {
        return res.status(400).json({ error: msg.required });
      }
      const [[existing]] = await pool.query(
        `SELECT status, unit_id FROM ${table} WHERE id = ? AND user_id = ?`,
        [req.params.id, req.user.id]
      );
      if (!existing) return res.status(404).json({ error: msg.notFound });
      if (existing.status === 'concluido' || existing.status === 'cancelado') {
        return res.status(409).json({ error: msg.editClosed });
      }

      // Agendamentos novos sempre têm unidade; registros antigos (sem unit_id)
      // continuam editáveis preservando o vínculo original.
      const effectiveUnitId = unit_id || existing.unit_id || null;
      if (!effectiveUnitId) {
        const windowError = validateScheduleWindow(scheduled_at);
        if (windowError) return res.status(400).json({ error: windowError });
      } else {
        const bookingError = await validateBooking(pool, {
          tipo,
          unitId: effectiveUnitId,
          professionalId: professional_id || null,
          serviceName,
          scheduledAt: scheduled_at,
          excludeId: req.params.id,
        });
        if (bookingError) return res.status(409).json({ error: bookingError });
      }

      let doctorName = hasDoctor ? (body.doctor || null) : null;
      if (hasDoctor && professional_id) {
        const [[prof]] = await pool.query('SELECT name FROM professionals WHERE id = ?', [professional_id]);
        if (prof) doctorName = prof.name;
      }

      const setCols = [`${serviceColumn}=?`];
      const setVals = [serviceName];
      if (hasDoctor) { setCols.push('doctor=?'); setVals.push(doctorName); }
      setCols.push('location=?', 'unit_id=?', 'professional_id=?', 'scheduled_at=?', 'notes=?');
      setVals.push(location, effectiveUnitId, professional_id || null, scheduled_at, notes || null);

      await pool.query(
        `UPDATE ${table} SET ${setCols.join(', ')} WHERE id=? AND user_id=?`,
        [...setVals, req.params.id, req.user.id]
      );
      res.json({ id: req.params.id });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createBookingRouter };
