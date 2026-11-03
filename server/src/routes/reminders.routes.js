const express = require('express');
const { verifyToken } = require('../middleware/auth');
const svc = require('../services/lembretes');

const router = express.Router();
router.use(verifyToken);

// GET /me/reminders — lembretes do usuário logado. Quem os cria é o job de lembretes.
router.get('/', async (req, res, next) => {
  try {
    res.json(await svc.listar(req.user.id));
  } catch (err) {
    next(err);
  }
});

// PATCH /me/reminders/:id/read — o paciente marca o PRÓPRIO lembrete como lido (idempotente).
router.patch('/:id/read', async (req, res, next) => {
  try {
    const r = await svc.marcarComoLido(req.user.id, req.params.id);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
