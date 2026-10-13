/* ==========================================================================
   Saúde+ — Rotas públicas (vitrine)
   Dados agregados sem PII para a home. Sem autenticação de propósito.
   ========================================================================== */
const express = require('express');
const pool = require('../db');

const router = express.Router();

// GET /public/stats — contagens agregadas para a vitrine
router.get('/stats', async (req, res, next) => {
  try {
    const [[units]] = await pool.query(
      'SELECT COUNT(*) AS total FROM health_units WHERE active = 1'
    );
    const [[offers]] = await pool.query(
      'SELECT COUNT(DISTINCT name) AS total FROM unit_offers WHERE active = 1'
    );
    const [[pros]] = await pool.query(
      'SELECT COUNT(*) AS total FROM professionals WHERE active = 1'
    );
    res.json({
      units: Number(units.total) || 0,
      services: Number(offers.total) || 0,
      professionals: Number(pros.total) || 0,
    });
  } catch (err) {
    next(err);
  }
});

// GET /public/dpo — canal do Encarregado (LGPD art. 41). Público de propósito:
// o titular precisa achar o contato sem precisar de login.
router.get('/dpo', (req, res) => {
  res.json({
    name: process.env.DPO_NAME || null,
    email: process.env.DPO_EMAIL || null,
    configured: !!(process.env.DPO_NAME && process.env.DPO_EMAIL),
  });
});

module.exports = router;
