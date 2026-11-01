// ==========================================================================
// Saúde+ — Interoperabilidade SUS (Fase 2)
// GET  /interop/status     — o que está configurado (sem segredos).
// POST /interop/rnds/send  — monta o Bundle RAC de um agendamento e envia.
//   body: { kind: 'appointment'|'exam', id: '<uuid>' }
//   Exige staff; sem certificado RNDS responde 501 (fluxo local inalterado).
// ==========================================================================
const express = require('express');
const pool = require('../db');
const { verifyToken, requireStaff } = require('../middleware/auth');
const { requireCapability } = require('../middleware/capabilities');
const { rndsConfig, buildRACBundle, validateBundle, sendBundle } = require('../services/rnds');
const { govbrConfig } = require('../services/govbr');
const { cnsConfig } = require('../services/cns');

const router = express.Router();
router.use(verifyToken, requireStaff);

const ENTITY = {
  appointment: { table: 'appointments' },
  exam: { table: 'exams' },
};

router.get('/status', (req, res) => {
  const rnds = rndsConfig();
  const govbr = govbrConfig();
  const cns = cnsConfig();
  res.json({
    cnes: { municipio: process.env.CNES_MUNICIPIO_CODE || '260850' },
    infodengue: { geocode: process.env.INFODENGUE_GEOCODE || '2608503' },
    rnds: { env: rnds.env, uf: rnds.uf, base: rnds.base, configured: rnds.configured },
    govbr: { base: govbr.base, configured: govbr.configured },
    cns: { base: cns.base, configured: cns.configured },
  });
});

// --------------------------------------------------------------------------
// POST /interop/rnds/send — monta o Bundle RAC e envia à RNDS.
//
// Segurança (P0.3): decifra CPF/CNS e transmite a terceiro (MS). Antes era
// `requireStaff`, então qualquer atendente podia causar o envio de documentos
// de qualquer paciente. Agora exige admin com a permissão 'reports'.
// --------------------------------------------------------------------------
router.post('/rnds/send', requireCapability('reports'), async (req, res, next) => {
  try {
    const { kind, id } = req.body || {};
    const entity = ENTITY[kind];
    if (!entity || !id) {
      return res.status(400).json({ error: "Informe { kind: 'appointment'|'exam', id }." });
    }
    const [[record]] = await pool.query(`SELECT * FROM ${entity.table} WHERE id = ?`, [id]);
    if (!record) return res.status(404).json({ error: 'Registro não encontrado.' });
    const [[user]] = await pool.query('SELECT * FROM users WHERE id = ?', [record.user_id]);
    if (!user) return res.status(404).json({ error: 'Paciente não encontrado.' });

    let patient;
    try {
      patient = {
        id: user.id, full_name: user.full_name,
        cns: req.decryptDoc(user.cns), cpf: req.decryptDoc(user.cpf),
        birth_date: user.birth_date,
        gender: user.gender,
      };
      // Auditoria da LEITURA dos documentos, separada do envio.
      await req.audit('rnds_read_documents', 'user', user.id,
      `documentos decifrados p/ envio RAC (${kind} ${id})`);
    } catch {
      return res.status(500).json({ error: 'Documentos ilegíveis: confira DATA_ENCRYPTION_KEY.', code: 'CRIPTO_CHAVE_AUSENTE' });
    }
    let professional = null;
    if (record.professional_id) {
      const [[prof]] = await pool.query('SELECT * FROM professionals WHERE id = ?', [record.professional_id]);
      if (prof) professional = { id: prof.id, name: prof.name, registry: prof.registry };
    }
    let unit = null;
    if (record.unit_id) {
      const [[u]] = await pool.query('SELECT * FROM health_units WHERE id = ?', [record.unit_id]);
      if (u) unit = { id: u.id, name: u.name, cnes_code: u.cnes_code };
    }

    const bundle = buildRACBundle({
      appointment: {
        id: record.id,
        specialty: record.specialty || null,
        exam_type: record.exam_type || null,
        scheduled_at: record.scheduled_at,
      },
      patient, professional, unit,
    });
    const check = validateBundle(bundle);
    if (!check.ok) return res.status(422).json({ error: 'Bundle inválido: ' + check.errors.join('; ') });

    const result = await sendBundle(bundle);
    await req.audit('rnds_send', kind === 'appointment' ? 'appointment' : 'exam', id, 'Bundle RAC enviado à RNDS');
    res.json({ ok: true, result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
