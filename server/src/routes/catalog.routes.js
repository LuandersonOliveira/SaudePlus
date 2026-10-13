/* ==========================================================================
   Saúde+ — Catálogo da agenda inteligente (TAREFAS V3, itens 2.7 e 2.8)

   Alimenta os seletores dependentes do painel do paciente:
   unidade -> especialidades/tipos de exame -> profissionais -> dias/horários.
   E o fluxo "serviço primeiro" (Fase 1, item 1): /services lista os serviços
   de todas as unidades; /slots devolve os cartões de unidades/dias com
   vagas livres de verdade para o serviço escolhido.
   Tudo lido do cadastro administrativo; nada de texto livre.
   ========================================================================== */
const express = require('express');
const pool = require('../db');
const { verifyToken } = require('../middleware/auth');
const { KINDS, TIPOS, getAvailability, findAvailabilityByService } = require('../utils/booking');

const router = express.Router();
router.use(verifyToken);

// GET /catalog/offers?unit_id=&kind=consulta|exame
// Especialidades (ou tipos de exame) oferecidos pela unidade.
router.get('/offers', async (req, res, next) => {
  try {
    const { unit_id: unitId, kind } = req.query;
    if (!unitId || !KINDS.includes(kind)) {
      return res.status(400).json({ error: 'unit_id e kind são obrigatórios.' });
    }
    const [[unit]] = await pool.query('SELECT active FROM health_units WHERE id = ?', [unitId]);
    if (!unit) return res.status(404).json({ error: 'Unidade não encontrada.' });
    if (!Number(unit.active)) return res.json([]);
    const [rows] = await pool.query(
      'SELECT name FROM unit_offers WHERE unit_id = ? AND kind = ? AND active = 1 ORDER BY name',
      [unitId, kind]
    );
    res.json(rows.map(r => r.name));
  } catch (err) { next(err); }
});

// GET /catalog/professionals?unit_id=&kind=&name=
// Profissionais ativos vinculados à unidade e habilitados para o serviço.
router.get('/professionals', async (req, res, next) => {
  try {
    const { unit_id: unitId, kind, name } = req.query;
    if (!unitId || !KINDS.includes(kind) || !name) {
      return res.status(400).json({ error: 'unit_id, kind e name são obrigatórios.' });
    }
    const [rows] = await pool.query(
      `SELECT p.id, p.name, p.job_title FROM professional_offers po
       JOIN professionals p ON p.id = po.professional_id
       JOIN health_units u ON u.id = po.unit_id
       WHERE po.unit_id = ? AND po.kind = ? AND po.name = ? AND p.active = 1 AND u.active = 1
       ORDER BY p.name`,
      [unitId, kind, name]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /catalog/availability?unit_id=&kind=&name=&professional_id=&days=30
// Dias com horários livres + horários de cada dia (já com conflitos removidos).
router.get('/availability', async (req, res, next) => {
  try {
    const { unit_id: unitId, kind, name, professional_id: professionalId } = req.query;
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 60);
    const excludeId = String(req.query.exclude_id || '').trim() || null;
    if (!unitId || !KINDS.includes(kind)) {
      return res.status(400).json({ error: 'unit_id e kind são obrigatórios.' });
    }
    const from = new Date();
    const fromDate = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
    const result = await getAvailability(pool, {
      unitId,
      professionalId: professionalId || null,
      kind,
      serviceName: name || '',
      fromDate,
      days,
      excludeId,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// GET /catalog/services?tipo=consulta|exame
// Catálogo de serviços (todas as unidades ativas) — 1º passo do fluxo
// "serviço primeiro" (Fase 1, item 1). Não depende de unidade.
router.get('/services', async (req, res, next) => {
  try {
    const tipo = req.query.tipo || req.query.kind;
    if (!TIPOS[tipo]) {
      return res.status(400).json({ error: 'tipo deve ser consulta ou exame.' });
    }
    const [rows] = await pool.query(
      `SELECT o.name, COUNT(DISTINCT o.unit_id) AS unidades
       FROM unit_offers o
       JOIN health_units u ON u.id = o.unit_id
       WHERE o.kind = ? AND o.active = 1 AND u.active = 1
       GROUP BY o.name
       ORDER BY o.name`,
      [tipo]
    );
    res.json(rows.map((r) => ({ name: r.name, unidades: Number(r.unidades) })));
  } catch (err) { next(err); }
});

// GET /catalog/slots?tipo=&name=&days=30&exclude_id=
// Cartões de unidades e dias com VAGAS LIVRES DE VERDADE para o serviço
// (Fase 1, item 1). Agrega todos os profissionais; conflitos de 30 min e
// bloqueios já vêm removidos. Só retorna unidades/dias com pelo menos 1 vaga.
router.get('/slots', async (req, res, next) => {
  try {
    const tipo = req.query.tipo || req.query.kind;
    const name = String(req.query.name || '').trim();
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 60);
    const excludeId = String(req.query.exclude_id || '').trim() || null;
    if (!TIPOS[tipo]) {
      return res.status(400).json({ error: 'tipo deve ser consulta ou exame.' });
    }
    if (!name) {
      return res.status(400).json({ error: 'name (nome do serviço) é obrigatório.' });
    }
    const from = new Date();
    const fromDate = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
    const result = await findAvailabilityByService(pool, {
      tipo,
      servico: name,
      fromDate,
      days,
      excludeId,
    });
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
