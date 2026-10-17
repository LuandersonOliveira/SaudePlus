const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { requireCapability } = require('../middleware/capabilities');

const router = express.Router();

const VALID_TYPES = ['ubs', 'hospital', 'clinica', 'caps', 'outro'];

// GET /health-units — catálogo ativo para preencher seletores
router.get('/', verifyToken, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, type, neighborhood FROM health_units WHERE active = 1 ORDER BY name'
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /health-units/manage — catálogo completo para administradores.
// P3: exige a permissão 'units' (não basta ser admin).
router.get('/manage', verifyToken, requireAdmin, requireCapability('units'), async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, type, neighborhood, active, created_at FROM health_units ORDER BY active DESC, name'
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/', verifyToken, requireAdmin, requireCapability('units'), async (req, res, next) => {
  try {
    const { name, type, neighborhood } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Nome da unidade é obrigatório.' });
    }
    const unitType = VALID_TYPES.includes(type) ? type : 'ubs';
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO health_units (id, name, type, neighborhood) VALUES (?,?,?,?)',
      [id, String(name).trim(), unitType, neighborhood || null]
    );
    await req.audit('create', 'health_unit', id, `${String(name).trim()} (${unitType})`);
    res.status(201).json({ id });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', verifyToken, requireAdmin, requireCapability('units'), async (req, res, next) => {
  try {
    const { name, type, neighborhood, active } = req.body || {};
    const updates = [];
    const params = [];
    const details = [];
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ error: 'Nome da unidade é obrigatório.' });
      updates.push('name=?'); params.push(String(name).trim()); details.push(`nome -> ${String(name).trim()}`);
    }
    if (type !== undefined) {
      if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: 'Tipo de unidade inválido.' });
      updates.push('type=?'); params.push(type); details.push(`tipo -> ${type}`);
    }
    if (neighborhood !== undefined) {
      updates.push('neighborhood=?'); params.push(neighborhood || null); details.push(`bairro -> ${neighborhood || 'não informado'}`);
    }
    if (active !== undefined) {
      const activeValue = Number(active) ? 1 : 0;
      updates.push('active=?'); params.push(activeValue); details.push(activeValue ? 'unidade ativada' : 'unidade desativada');
    }
    if (!updates.length) return res.status(400).json({ error: 'Nada para atualizar.' });
    params.push(req.params.id);
    const [result] = await pool.query(`UPDATE health_units SET ${updates.join(', ')} WHERE id=?`, params);
    if (!result.affectedRows) return res.status(404).json({ error: 'Unidade não encontrada.' });
    await req.audit('admin_update_unit', 'health_unit', req.params.id, details.join('; '));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// Ofertas da unidade (especialidades de consulta e tipos de exame).
// Fonte da verdade do que a unidade realmente atende — alimenta os
// seletores dependentes do paciente (TAREFAS V3, itens 4.4 e 2.7).
// ---------------------------------------------------------------------
const OFFER_KINDS = ['consulta', 'exame'];

router.get('/:id/offers', verifyToken, requireAdmin, requireCapability('units'), async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, kind, name, active FROM unit_offers WHERE unit_id = ? ORDER BY kind, name',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/:id/offers', verifyToken, requireAdmin, requireCapability('units'), async (req, res, next) => {
  try {
    const { kind, name } = req.body || {};
    if (!OFFER_KINDS.includes(kind)) return res.status(400).json({ error: 'Tipo inválido (consulta ou exame).' });
    const serviceName = String(name || '').trim();
    if (!serviceName) return res.status(400).json({ error: 'Informe a especialidade ou tipo de exame.' });
    const [[unit]] = await pool.query('SELECT id, name FROM health_units WHERE id = ?', [req.params.id]);
    if (!unit) return res.status(404).json({ error: 'Unidade não encontrada.' });

    const id = crypto.randomUUID();
    // Sem IGNORE: duplicata agora é 409 em vez de 201 com id fantasma. Mesmo
    // defeito do POST de professional_offers — o front acreditava no 201 e a
    // auditoria registrava uma criação que não aconteceu.
    try {
      await pool.query(
        'INSERT INTO unit_offers (id, unit_id, kind, name) VALUES (?,?,?,?)',
        [id, req.params.id, kind, serviceName]
      );
    } catch (erro) {
      if (erro && erro.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'Este serviço já está cadastrado nesta unidade.' });
      }
      throw erro;
    }
    await req.audit('create', 'unit_offer', id,
      `${serviceName} (${kind}) em ${unit.name}`);
    res.status(201).json({ id });
  } catch (err) { next(err); }
});

router.delete('/:id/offers/:offerId', verifyToken, requireAdmin, requireCapability('units'), async (req, res, next) => {
  try {
    const [[offer]] = await pool.query(
      'SELECT id, kind, name FROM unit_offers WHERE id = ? AND unit_id = ?',
      [req.params.offerId, req.params.id]
    );
    if (!offer) return res.status(404).json({ error: 'Oferta não encontrada.' });
    await pool.query('DELETE FROM unit_offers WHERE id = ?', [req.params.offerId]);
    await req.audit('delete', 'unit_offer', req.params.offerId,
      `${offer.name} (${offer.kind}) removida da unidade`);
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
