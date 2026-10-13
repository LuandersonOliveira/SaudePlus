const rateLimit = require('express-rate-limit');

function jsonHandler(message) {
  return (req, res /* , next, options */) => {
    res.status(429).json({ error: message });
  };
}

// Global: teto generoso anti-abuso (não deve afetar uso normal nem o smoke-test).
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: jsonHandler('Muitas requisições. Tente novamente em alguns minutos.'),
});

// Auth: camada externa além do bloqueio por IP já existente em auth.routes.js.
// Mantém a mensagem em PT-BR consistente com o restante da API.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: jsonHandler('Muitas tentativas de autenticação. Tente novamente em alguns minutos.'),
});

module.exports = { globalLimiter, authLimiter };
