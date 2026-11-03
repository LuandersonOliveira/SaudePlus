/* ==========================================================================
   Saúde+ — CRUD próprio de agendamentos (Fase 2, item 3)

   Uma única fábrica serve consultas e exames. As URLs continuam idênticas
   (/me/appointments e /me/exams); só a implementação foi unificada.
   Criar, cancelar e editar deixam rastro (E-12): evento em booking_events (criação e cancelamento pelo
   serviço único / applyBookingChange) e linha em audit_log (`patient_create`, `patient_cancel`,
   `patient_update`), sem dado pessoal no `details` (ADR-0012).
   ========================================================================== */
const express = require('express');
const pool = require('../db');
const { verifyToken } = require('../middleware/auth');
const { registrarEvento } = require('../services/booking-events');
const {
  TIPOS, validateBooking, duracaoMinutos, validateScheduleWindow,
  prioridadeDoUsuario, lockBookingActors,
} = require('../utils/booking');
const { liberarVagaAposCancelamento } = require('../services/waitlist');
const { applyBookingChange } = require('../services/bookingChange');
const { criarAtendimento } = require('../services/bookingCreate');

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
      // Travas, validação, duração e INSERT: o caminho único de criação (services/bookingCreate.js, E-06).
      const criado = await criarAtendimento(conn, {
        tipo,
        userId: req.user.id,
        unitId: unit_id,
        professionalId: professional_id || null,
        serviceName,
        scheduledAt: scheduled_at,
        location,
        doctor: hasDoctor ? body.doctor : undefined,
        notes,
        actorUserId: req.user.id,
      });
      if (!criado.ok) {
        await conn.rollback().catch(() => {});
        conn.release();
        conn = null;
        return res.status(409).json({ error: criado.error });
      }
      await conn.commit();
      conn.release();
      conn = null;
      // Só dados operacionais: nada de nome, e-mail nem do texto livre das notas (ADR-0012).
      await req.audit('patient_create', meta.entityType, criado.id, `${tipo} em ${scheduled_at} (${criado.duracao} min)`);
      res.status(201).json({ id: criado.id });
    } catch (err) {
      if (conn) {
        await conn.rollback().catch(() => {});
        conn.release();
      }
      next(err);
    }
  });

  // PATCH /:id/cancel — soft-cancel: marca como cancelado, NÃO apaga do banco.
  // Mesmo caminho de staff e admin (applyBookingChange, E-08): UMA transação com o registro travado e o
  // evento `canceled`, escopo no próprio paciente e só o que ainda está aberto.
  router.patch('/:id/cancel', async (req, res, next) => {
    try {
      const r = await applyBookingChange(pool, {
        kindKey: table,
        id: req.params.id,
        body: { status: 'cancelado' },
        actorUserId: req.user.id,
        ownerUserId: req.user.id,
        somenteSeAberto: true,
        mensagemFechado: msg.closed,
        mensagemNaoEncontrado: msg.notFound,
      });
      if (r.status !== 200) return res.status(r.status).json(r.body);
      try {
        await liberarVagaAposCancelamento(pool, { kindKey: table, id: req.params.id });
      } catch (err) {
        console.error(`Falha ao liberar a vaga cancelada ${req.params.id}: ${err.message}`);
      }
      await req.audit('patient_cancel', meta.entityType, req.params.id, r.audit.details);
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
      // Dado operacional apenas: o texto livre das notas e o local não vão para a trilha (ADR-0012).
      const mudouHorario = String(scheduled_at) !== String(existing.scheduled_at);
      await req.audit(
        'patient_update', meta.entityType, req.params.id,
        mudouHorario ? `reagendado de ${existing.scheduled_at} para ${scheduled_at}` : 'dados do agendamento alterados'
      );
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
