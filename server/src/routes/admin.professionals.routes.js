/* ==========================================================================
   Saúde+ — Gestão administrativa de profissionais e agenda
   (TAREFAS V3, itens 4.4 e 4.6)

   Cada alteração é registrada na auditoria com administrador, data,
   unidade e motivo.
   ========================================================================== */
const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { requireCapability } = require('../middleware/capabilities');
const { registrarEvento } = require('../services/booking-events');
const mailer = require('../services/mailer');

const router = express.Router();
// P3: gestão de profissionais/agenda exige a permissão 'units'.
router.use(verifyToken, requireAdmin, requireCapability('units'));

const KINDS = ['consulta', 'exame'];
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

// Aceita "HH:MM" ou "HH:MM:SS" e normaliza para "HH:MM:SS" — mas só se hora e
// minuto existirem de verdade. O regex sozinho aceitou "99:99" e "12:99": o
// INSERT passava, o MySQL reclamava, e a rota devolvia **500** (não 400). Pior:
// um horário assim some de todos os filtros de disponibilidade, então o
// profissional desaparece do próprio dia de atendimento sem ninguém perceber.
function cleanTime(value) {
  if (typeof value !== 'string' || !TIME_RE.test(value)) return null;
  const [h, m] = value.split(':').map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

function minutesOf(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

// Motivo entra na trilha de auditoria (concatenado ao restante do details).
// O teto é o mesmo do sanitizeDetails: sem ele, um motivo enorme só gastaria
// memória e bandwidth numa resposta 204 que ninguém lê. Também é aceito via
// query string (?reason=), que tem limite de URL.
function reasonOf(req) {
  const bruto = String((req.body && req.body.reason) || req.query.reason || '').trim();
  return bruto.slice(0, 1000);
}

async function unitLabel(unitId) {
  if (!unitId) return 'unidade não informada';
  const [[unit]] = await pool.query('SELECT name FROM health_units WHERE id = ?', [unitId]);
  return unit ? unit.name : `unidade ${unitId}`;
}

// GET /admin/professionals — lista completa com vínculos, horários e bloqueios
router.get('/', async (req, res, next) => {
  try {
    const [professionals] = await pool.query(
      `SELECT p.id, p.name, p.job_title, p.registry, p.active, p.user_id, p.created_at,
              u.full_name AS user_name, u.email AS user_email, u.role AS user_role
       FROM professionals p
       LEFT JOIN users u ON u.id = p.user_id AND u.deleted_at IS NULL
       ORDER BY p.name`
    );
    const [offers] = await pool.query(
      `SELECT po.id, po.professional_id, po.unit_id, po.kind, po.name, u.name AS unit_name
       FROM professional_offers po JOIN health_units u ON u.id = po.unit_id
       ORDER BY u.name, po.kind, po.name`
    );
    const [schedules] = await pool.query(
      `SELECT ws.id, ws.professional_id, ws.unit_id, ws.weekday, ws.start_time, ws.end_time,
              ws.slot_minutes, ws.active, u.name AS unit_name
       FROM work_schedules ws JOIN health_units u ON u.id = ws.unit_id
       ORDER BY u.name, ws.weekday, ws.start_time`
    );
    const [blocks] = await pool.query(
      `SELECT sb.id, sb.professional_id, sb.unit_id, sb.starts_at, sb.ends_at, sb.reason,
              u.name AS unit_name
       FROM schedule_blocks sb JOIN health_units u ON u.id = sb.unit_id
       WHERE sb.ends_at >= NOW() ORDER BY sb.starts_at LIMIT 100`
    );
    res.json({ professionals, offers, schedules, blocks });
  } catch (err) { next(err); }
});

// POST /admin/professionals — cadastrar profissional
router.post('/', async (req, res, next) => {
  try {
    const { name, job_title: jobTitle, registry } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Nome do profissional é obrigatório.' });
    }
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO professionals (id, name, job_title, registry) VALUES (?,?,?,?)',
      [id, String(name).trim(), jobTitle || null, registry || null]
    );
    const reason = reasonOf(req);
    await req.audit('create', 'professional', id,
      `profissional "${String(name).trim()}"${reason ? `; motivo: ${reason}` : ''}`);
    res.status(201).json({ id });
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

      const reason = reasonOf(req);
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
    const { unit_id: unitId, kind, name } = req.body || {};
    if (!unitId) return res.status(400).json({ error: 'Selecione a unidade.' });
    if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Tipo inválido (consulta ou exame).' });
    const serviceName = String(name || '').trim();
    if (!serviceName) return res.status(400).json({ error: 'Informe a especialidade ou tipo de exame.' });

    const [[prof]] = await pool.query('SELECT id FROM professionals WHERE id = ?', [req.params.id]);
    if (!prof) return res.status(404).json({ error: 'Profissional não encontrado.' });
    const [[unit]] = await pool.query('SELECT id, name FROM health_units WHERE id = ?', [unitId]);
    if (!unit) return res.status(404).json({ error: 'Unidade não encontrada.' });

    const id = crypto.randomUUID();
    // Sem IGNORE: a duplicata precisa ser VISÍVEL.
    //
    // `INSERT IGNORE` engolia o ER_DUP_ENTRY e a rota respondia 201 com o id
    // recém-gerado — que nunca existiu. O front mostrava o vínculo na lista e
    // a auditoria registrava "criou vínculo" para nada. Agora a duplicata é um
    // 409 honesto e nada é auditado, porque nada mudou.
    try {
      await pool.query(
        'INSERT INTO professional_offers (id, professional_id, unit_id, kind, name) VALUES (?,?,?,?,?)',
        [id, req.params.id, unitId, kind, serviceName]
      );
    } catch (erro) {
      if (erro && erro.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'Este vínculo já existe para este profissional nesta unidade.' });
      }
      throw erro;
    }
    const reason = reasonOf(req);
    await req.audit('create', 'professional_offer', id,
      `vínculo: ${serviceName} (${kind}) em ${unit.name}${reason ? `; motivo: ${reason}` : ''}`);
    res.status(201).json({ id });
  } catch (err) { next(err); }
});

router.delete('/:id/offers/:offerId', async (req, res, next) => {
  try {
    const [[offer]] = await pool.query(
      `SELECT po.id, po.kind, po.name, u.name AS unit_name
       FROM professional_offers po JOIN health_units u ON u.id = po.unit_id
       WHERE po.id = ? AND po.professional_id = ?`,
      [req.params.offerId, req.params.id]
    );
    if (!offer) return res.status(404).json({ error: 'Vínculo não encontrado.' });
    await pool.query('DELETE FROM professional_offers WHERE id = ?', [req.params.offerId]);
    const reason = reasonOf(req);
    await req.audit('delete', 'professional_offer', req.params.offerId,
      `vínculo removido: ${offer.name} (${offer.kind}) em ${offer.unit_name}${reason ? `; motivo: ${reason}` : ''}`);
    res.status(204).end();
  } catch (err) { next(err); }
});

// POST /admin/professionals/:id/schedules — dias/horários de atendimento
router.post('/:id/schedules', async (req, res, next) => {
  try {
    const { unit_id: unitId, weekday, start_time: startTime, end_time: endTime } = req.body || {};
    const slot = Number(req.body && req.body.slot_minutes) || 30;
    const wd = Number(weekday);
    if (!unitId) return res.status(400).json({ error: 'Selecione a unidade.' });
    if (!Number.isInteger(wd) || wd < 0 || wd > 6) {
      return res.status(400).json({ error: 'Dia da semana inválido (0 = domingo a 6 = sábado).' });
    }
    const start = cleanTime(startTime);
    const end = cleanTime(endTime);
    if (!start || !end) return res.status(400).json({ error: 'Horários no formato HH:MM.' });
    if (minutesOf(start) >= minutesOf(end)) {
      return res.status(400).json({ error: 'O horário final deve ser depois do inicial.' });
    }
    if (slot < 5 || slot > 240) return res.status(400).json({ error: 'Duração do atendimento entre 5 e 240 minutos.' });

    const [[prof]] = await pool.query('SELECT id FROM professionals WHERE id = ?', [req.params.id]);
    if (!prof) return res.status(404).json({ error: 'Profissional não encontrado.' });
    const label = await unitLabel(unitId);

    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO work_schedules (id, professional_id, unit_id, weekday, start_time, end_time, slot_minutes)
       VALUES (?,?,?,?,?,?,?)`,
      [id, req.params.id, unitId, wd, start, end, slot]
    );
    const reason = reasonOf(req);
    const WEEK = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    await req.audit('create', 'work_schedule', id,
      `${WEEK[wd]} ${start.slice(0, 5)}-${end.slice(0, 5)} (${slot} min) em ${label}${reason ? `; motivo: ${reason}` : ''}`);
    res.status(201).json({ id });
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Este horário já está cadastrado para o profissional.' });
    }
    next(err);
  }
});

router.delete('/:id/schedules/:scheduleId', async (req, res, next) => {
  try {
    const [[row]] = await pool.query(
      'SELECT id FROM work_schedules WHERE id = ? AND professional_id = ?',
      [req.params.scheduleId, req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Horário não encontrado.' });
    await pool.query('DELETE FROM work_schedules WHERE id = ?', [req.params.scheduleId]);
    const reason = reasonOf(req);
    await req.audit('delete', 'work_schedule', req.params.scheduleId,
      `horário de atendimento removido${reason ? `; motivo: ${reason}` : ''}`);
    res.status(204).end();
  } catch (err) { next(err); }
});

// POST /admin/professionals/:id/blocks — folgas, intervalos e bloqueios
router.post('/:id/blocks', async (req, res, next) => {
  try {
    const { unit_id: unitId, starts_at: startsAt, ends_at: endsAt } = req.body || {};
    const reason = reasonOf(req);
    if (!unitId) return res.status(400).json({ error: 'Selecione a unidade.' });
    const start = String(startsAt || '').replace('T', ' ');
    const end = String(endsAt || '').replace('T', ' ');
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(start) ||
        !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(end)) {
      return res.status(400).json({ error: 'Informe início e fim do bloqueio.' });
    }
    if (new Date(start) >= new Date(end)) {
      return res.status(400).json({ error: 'O fim do bloqueio deve ser depois do início.' });
    }

    const [[prof]] = await pool.query('SELECT id FROM professionals WHERE id = ?', [req.params.id]);
    if (!prof) return res.status(404).json({ error: 'Profissional não encontrado.' });
    const label = await unitLabel(unitId);

    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO schedule_blocks (id, professional_id, unit_id, starts_at, ends_at, reason) VALUES (?,?,?,?,?,?)',
      [id, req.params.id, unitId, start, end, reason || null]
    );
    await req.audit('create', 'schedule_block', id,
      `bloqueio de ${start} a ${end} em ${label}${reason ? `; motivo: ${reason}` : ''}`);
    res.status(201).json({ id });
  } catch (err) { next(err); }
});

router.delete('/:id/blocks/:blockId', async (req, res, next) => {
  try {
    const [[row]] = await pool.query(
      'SELECT id FROM schedule_blocks WHERE id = ? AND professional_id = ?',
      [req.params.blockId, req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Bloqueio não encontrado.' });
    await pool.query('DELETE FROM schedule_blocks WHERE id = ?', [req.params.blockId]);
    const reason = reasonOf(req);
    await req.audit('delete', 'schedule_block', req.params.blockId,
      `bloqueio removido${reason ? `; motivo: ${reason}` : ''}`);
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
// cleanTime é testado diretamente (server/test/admin-silent-failures.test.js):
// a validação de hora/minuto é o tipo de coisa que a review "de olho" aprova
// e que o MySQL só revela com um 500 confuso.
module.exports.cleanTime = cleanTime;
