const jwt = require('jsonwebtoken');
// Permissões vivem em capabilities.js (Fase 3); aqui só re-exporta.
const { requireCapability } = require('./capabilities');

// ADR-0010: sessão RESTRITA (atendente/admin sem segundo fator) só alcança a configuração do próprio
// MFA, o perfil e o logout. O resto responde 403 MFA_SETUP_REQUIRED.
const ROTAS_COM_MFA_PENDENTE = ['/auth/mfa/setup', '/auth/mfa/enable', '/auth/me', '/auth/logout'];
const MENSAGEM_MFA_PENDENTE = 'Configure o segundo fator de autenticação para continuar.';

/** Caminho da rota sem o prefixo `/api` (a API também monta na raiz). */
const rotaDe = (req) => `${req.baseUrl || ''}${req.path || ''}`.replace(/^\/api(?=\/)/, '').replace(/\/+$/, '');

function verifyToken(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token ausente.' });

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
  req.user = payload; // { id, email, role, full_name, mfa_setup? }

  if (payload.mfa_setup && !ROTAS_COM_MFA_PENDENTE.includes(rotaDe(req))) {
    return res.status(403).json({ error: MENSAGEM_MFA_PENDENTE, code: 'MFA_SETUP_REQUIRED' });
  }
  return next();
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
