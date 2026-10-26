const rateLimit = require('express-rate-limit');

function jsonHandler(message) {
  return (req, res /* , next, options */) => {
    res.status(429).json({ error: message });
  };
}

// Permite elevar o teto em suítes E2E, que abrem vários painéis e fazem
// dezenas de chamadas em poucos minutos. O padrão de produção não muda.
function envLimit(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

// Global: teto generoso anti-abuso (não deve afetar uso normal nem o smoke-test).
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: envLimit('RATE_LIMIT_GLOBAL_MAX', 300),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: jsonHandler('Muitas requisições. Tente novamente em alguns minutos.'),
});

// Auth: camada externa além do bloqueio por IP já existente em auth.routes.js.
// Mantém a mensagem em PT-BR consistente com o restante da API.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: envLimit('RATE_LIMIT_AUTH_MAX', 60),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: jsonHandler('Muitas tentativas de autenticação. Tente novamente em alguns minutos.'),
});

// Sonda de prontidão: `/health` e `/ready` ficam ANTES do globalLimiter
// (um balanceador consultando a cada 5s estourava a janela de 300 req/15min em
// ~25 min e passava a receber 429 no lugar de tráfego real).
//
// Isso abriu outro problema: /ready é público e roda `SELECT 1` no pool a cada
// chamada. Com `connectionLimit: 10`, um laço de requisições esgota o pool e
// mata a API inteira — que é o oposto do que a mudança queria.
//
// Um limiter próprio, alto o bastante para o balanceador real (cada 5s = 12/min)
// e baixo o bastante para não ser uma via livre para o banco.
const readinessLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // /health não consulta nada e nem precisa de limite; ele é o liveness.
  skip: (req) => req.path === '/health',
  handler: jsonHandler('Muitas sondas de prontidão. Tente em instantes.'),
});

module.exports = { globalLimiter, authLimiter, readinessLimiter };
