const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const { verifyToken } = require('../middleware/auth');
const { KINDS } = require('../utils/booking');

const router = express.Router();
router.use(verifyToken);

const SERVICE_MAX = 120;

function validarEntrada(body) {
  const kind = String((body && body.kind) || '').trim();
  const serviceName = String((body && body.service_name) || '').trim();
  const unitId = String((body && body.unit_id) || '').trim() || null;
  const professionalId = String((body && body.professional_id) || '').trim() || null;

  if (!KINDS.includes(kind)) return { error: 'Informe um tipo válido: consulta ou exame.' };
  if (!serviceName) return { error: 'Informe o serviço desejado.' };
  if (serviceName.length > SERVICE_MAX) return { error: 'O nome do serviço é longo demais.' };
  return { kind, serviceName, unitId, professionalId };
}

router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, kind, service_name, unit_id, professional_id, status, record_id,
              created_at, fulfilled_at
       FROM waitlist
       WHERE user_id = ?
       ORDER BY (status = 'aguardando') DESC, created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const entrada = validarEntrada(req.body || {});
    if (entrada.error) return res.status(400).json({ error: entrada.error });

    if (entrada.unitId) {
      const [[unit]] = await pool.query('SELECT id, active FROM health_units WHERE id = ?', [entrada.unitId]);
      if (!unit) return res.status(404).json({ error: 'Unidade de saúde não encontrada.' });
      if (!Number(unit.active)) return res.status(409).json({ error: 'Esta unidade está inativada.' });
    }
    if (entrada.professionalId) {
      const [[prof]] = await pool.query('SELECT id, active FROM professionals WHERE id = ?', [entrada.professionalId]);
      if (!prof) return res.status(404).json({ error: 'Profissional não encontrado.' });
      if (!Number(prof.active)) return res.status(409).json({ error: 'Este profissional está inativo.' });
    }

    const [[duplicada]] = await pool.query(
      `SELECT id FROM waitlist
       WHERE user_id = ? AND status = 'aguardando' AND kind = ? AND service_name = ?
         AND unit_id <=> ? AND professional_id <=> ?
       LIMIT 1`,
      [req.user.id, entrada.kind, entrada.serviceName, entrada.unitId, entrada.professionalId]
    );
    if (duplicada) {
      return res.status(409).json({ error: 'Você já está na lista de espera para este serviço.' });
    }

    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO waitlist (id, user_id, kind, service_name, unit_id, professional_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, req.user.id, entrada.kind, entrada.serviceName, entrada.unitId, entrada.professionalId]
    );
    res.status(201).json({
      id,
      kind: entrada.kind,
      service_name: entrada.serviceName,
      unit_id: entrada.unitId,
      professional_id: entrada.professionalId,
      status: 'aguardando',
    });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const [result] = await pool.query(
      `UPDATE waitlist SET status = 'cancelado'
       WHERE id = ? AND user_id = ? AND status = 'aguardando'`,
      [req.params.id, req.user.id]
    );
    if (result.affectedRows === 0) {
      const [[existing]] = await pool.query(
        'SELECT status FROM waitlist WHERE id = ? AND user_id = ?',
        [req.params.id, req.user.id]
      );
      if (!existing) return res.status(404).json({ error: 'Entrada da lista de espera não encontrada.' });
      return res.status(409).json({ error: 'Esta entrada da lista de espera não está mais aguardando.' });
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
