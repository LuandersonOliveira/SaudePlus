const jwt = require('jsonwebtoken');
// Permissões vivem em capabilities.js (Fase 3); aqui só re-exporta.
const { requireCapability } = require('./capabilities');

function verifyToken(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token ausente.' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, email, role, full_name }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
  }
  next();
}

function requireStaff(req, res, next) {
  if (!req.user || (req.user.role !== 'atendente' && req.user.role !== 'admin')) {
    return res.status(403).json({ error: 'Acesso restrito a atendentes e administradores.' });
  }
  next();
}

module.exports = { verifyToken, requireAdmin, requireStaff, requireCapability };
