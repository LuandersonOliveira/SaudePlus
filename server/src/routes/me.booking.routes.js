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
const { registrarEvento } = require('../services/booking-events');
const {
  TIPOS, validateBooking, duracaoMinutos, validateScheduleWindow,
  prioridadeDoUsuario, lockBookingActors,
} = require('../utils/booking');
const { liberarVagaAposCancelamento } = require('../services/waitlist');

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
    let conn = null;
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

      // Validação e inserção na MESMA transação, com lock na linha do
      // profissional. Antes eram duas round-trips independentes: a validação
      // lia os intervalos ocupados, decidia "livre" e devolvia; o insert
      // vinha depois. Dois cliques (ou duas abas, ou um retry depois de um
      // 502) faziam os dois passarem na validação antes de qualquer um
      // inserir, e os dois agendamentos entravam no mesmo horário.
      //
      // `SELECT … FOR UPDATE` na linha do profissional serializa as
      // requisições concorrentes: a segunda espera a primeira terminar a
      // transação e só então lê os ocupados — já com o primeiro registro.
      conn = await pool.getConnection();
      await conn.beginTransaction();
      await lockBookingActors(conn, {
        userId: req.user.id,
        professionalId: professional_id || null,
      });

      const bookingError = await validateBooking(conn, {
        tipo,
        userId: req.user.id,
        unitId: unit_id,
        professionalId: professional_id || null,
        serviceName,
        scheduledAt: scheduled_at,
        userPriority: await prioridadeDoUsuario(conn, req.user.id),
      });
      if (bookingError) {
        await conn.rollback().catch(() => {});
        conn.release();
        conn = null;
        return res.status(409).json({ error: bookingError });
      }

      let doctorName = hasDoctor ? (body.doctor || null) : null;
      if (hasDoctor && professional_id) {
        const [[prof]] = await conn.query('SELECT name FROM professionals WHERE id = ?', [professional_id]);
        if (prof) doctorName = prof.name;
      }

      const id = crypto.randomUUID();
      const columns = ['id', 'user_id', serviceColumn];
      const values = [id, req.user.id, serviceName];
      if (hasDoctor) { columns.push('doctor'); values.push(doctorName); }
      columns.push('location', 'unit_id', 'professional_id', 'scheduled_at', 'notes');
      values.push(location, unit_id, professional_id || null, scheduled_at, notes || null);

      // A duração vai gravada junto. Sem ela, o cálculo de conflito trataria
      // este atendimento como 30 min para sempre — e um atendimento de 60 min
      // deixaria livre o horário seguinte da grade de 30.
      const duracao = await duracaoMinutos(conn, {
        unitId: unit_id,
        professionalId: professional_id || null,
        serviceName,
        tipo,
        scheduledAt: scheduled_at,
      });
      columns.push('duration_minutes');
      values.push(duracao);

      await conn.query(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(',')})`,
        values
      );
      await conn.commit();
      conn.release();
      conn = null;
      res.status(201).json({ id });
    } catch (err) {
      if (conn) {
        await conn.rollback().catch(() => {});
        conn.release();
      }
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
      const [cancelado] = await pool.query(
        `UPDATE ${table} SET status = ? WHERE id = ? AND user_id = ?
           AND status NOT IN ('concluido', 'cancelado')`,
        ['cancelado', req.params.id, req.user.id]
      );
      if (cancelado.affectedRows === 0) {
        return res.status(409).json({ error: msg.closed });
      }
      try {
        await liberarVagaAposCancelamento(pool, { kindKey: table, id: req.params.id });
      } catch (err) {
        console.error(`Falha ao liberar a vaga cancelada ${req.params.id}: ${err.message}`);
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // PUT /:id — reagendamento. Mesma validação do POST, na MESMA transação:
  // antes a checagem lia os ocupados e o UPDATE vinha depois, então um
  // reagendamento concorrente com um novo agendamento podia ocupar o mesmo
  // horário (o POST já usava lock; esta rota ficou para trás).
  router.put('/:id', async (req, res, next) => {
    let conn = null;
    try {
      const body = req.body || {};
      const serviceName = hasDoctor ? body.specialty : body.exam_type;
      const { location, scheduled_at, unit_id, professional_id, notes } = body;
      if (!serviceName || !location || !scheduled_at) {
        return res.status(400).json({ error: msg.required });
      }
      // Janela é regra de entrada, não conflito de agenda: 400. Sem esta
      // checagem explícita, o erro vindo de `validateBooking` saía como 409.
      const windowError = validateScheduleWindow(scheduled_at);
      if (windowError) return res.status(400).json({ error: windowError });

      conn = await pool.getConnection();
      await conn.beginTransaction();

      const falhar = async (status, payload) => {
        await conn.rollback().catch(() => {});
        conn.release();
        conn = null;
        return res.status(status).json(payload);
      };

      // FOR UPDATE no próprio registro: dois reagendamentos do mesmo item em
      // abas diferentes serializam, e o segundo enxerga o status já gravado.
      const [[existing]] = await conn.query(
        `SELECT status, unit_id, professional_id, scheduled_at FROM ${table}
         WHERE id = ? AND user_id = ? FOR UPDATE`,
        [req.params.id, req.user.id]
      );
      if (!existing) return falhar(404, { error: msg.notFound });
      if (existing.status === 'concluido' || existing.status === 'cancelado') {
        return falhar(409, { error: msg.editClosed });
      }

      // Mesma serialização do POST: sem o lock na linha do profissional, dois
      // reagendamentos para o mesmo horário passavam na validação antes de
      // qualquer um gravar.
      await lockBookingActors(conn, {
        userId: req.user.id,
        professionalId: professional_id || existing.professional_id || null,
      });

      // Agendamentos novos sempre têm unidade; registros antigos (sem unit_id)
      // continuam editáveis preservando o vínculo original.
      const effectiveUnitId = unit_id || existing.unit_id || null;
      if (effectiveUnitId) {
        const bookingError = await validateBooking(conn, {
          tipo,
          userId: req.user.id,
          unitId: effectiveUnitId,
          professionalId: professional_id || null,
          serviceName,
          scheduledAt: scheduled_at,
          excludeId: req.params.id,
          userPriority: await prioridadeDoUsuario(conn, req.user.id),
          currentScheduledAt: existing.scheduled_at,
        });
        if (bookingError) return falhar(409, { error: bookingError });
      }

      let doctorName = hasDoctor ? (body.doctor || null) : null;
      if (hasDoctor && professional_id) {
        const [[prof]] = await conn.query('SELECT name FROM professionals WHERE id = ?', [professional_id]);
        if (prof) doctorName = prof.name;
      }

      const setCols = [`${serviceColumn}=?`];
      const setVals = [serviceName];
      if (hasDoctor) { setCols.push('doctor=?'); setVals.push(doctorName); }
      setCols.push('location=?', 'unit_id=?', 'professional_id=?', 'scheduled_at=?', 'notes=?');
      setVals.push(location, effectiveUnitId, professional_id || null, scheduled_at, notes || null);

      // Reagendar muda a grade, então muda a duração: o registro não pode
      // carregar a duração do horário antigo (mesmo defeito coberto pela rota
      // administrativa). Sem profissional alocado, o padrão histórico é 30.
      const duracao = await duracaoMinutos(conn, {
        unitId: effectiveUnitId,
        professionalId: professional_id || null,
        serviceName,
        tipo,
        scheduledAt: scheduled_at,
      });
      setCols.push('duration_minutes=?');
      setVals.push(duracao);

      await conn.query(
        `UPDATE ${table} SET ${setCols.join(', ')} WHERE id=? AND user_id=?`,
        [...setVals, req.params.id, req.user.id]
      );

      // Ao reagendar, a solicitação veio do paciente: motivo automático.
      if (String(scheduled_at) !== String(existing.scheduled_at)) {
        await registrarEvento(conn, {
          kind: tipo,
          bookingId: req.params.id,
          eventType: 'rescheduled',
          fromScheduledAt: existing.scheduled_at,
          toScheduledAt: scheduled_at,
          fromProfessionalId: existing.professional_id,
          toProfessionalId: professional_id || null,
          reason: 'solicitado_pelo_paciente',
          actorUserId: req.user.id,
        });
        // A coluna reschedule_reason também fica preenchida, para a fila e os relatórios.
        await conn.query(
          `UPDATE ${table} SET reschedule_reason = ? WHERE id = ? AND user_id = ?`,
          ['solicitado_pelo_paciente', req.params.id, req.user.id]
        );
      }
      await conn.commit();
      conn.release();
      conn = null;
      res.json({ id: req.params.id });
    } catch (err) {
      if (conn) {
        await conn.rollback().catch(() => {});
        conn.release();
      }
      next(err);
    }
  });

  return router;
}

module.exports = { createBookingRouter };
