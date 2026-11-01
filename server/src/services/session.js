/* ==========================================================================
   Saúde+ — sessão curta + refresh rotativo (Fase 0, item 0.3; A1 da Fase 6).

   Alinhado ao padrão RNDS de access de 15 min. O access continua Bearer; o
   refresh viaja em cookie httpOnly (e no corpo, para clientes sem cookie).
   Guarda-se só o SHA-256 do refresh; reuso de um token já rotacionado é tratado
   como roubo e revoga a FAMÍLIA inteira.

   Este arquivo concentra tudo o que mexe em `refresh_tokens` e no cookie, para
   que as rotas (login, MFA, Gov.br, refresh, logout, exclusão de conta) só
   chamem `iniciarSessao`, `rotacionarSessao` e `encerrarSessao`.
   ========================================================================== */
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../db');

const ACCESS_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '30d';
const REFRESH_COOKIE = 'saude_refresh';
// O cookie só deve voltar para as rotas de /auth, e o prefixo depende de onde a API está montada:
// `/auth` (API sozinha) ou `/api/auth` (origem única, Express servindo o front). Um path fixo
// '/auth' nunca era devolvido pelo navegador na origem única, então o cookie httpOnly não
// valia nada. `req.baseUrl` é o ponto de montagem do roteador, e `res.req` é a requisição.
const COOKIE_PATH_PADRAO = '/auth';
function cookiePath(res) {
  const base = res && res.req && res.req.baseUrl;
  return base && /^\/[\w\-/]*$/.test(base) ? base : COOKIE_PATH_PADRAO;
}

function refreshTtlMs() {
  const m = String(REFRESH_EXPIRES_IN).trim().match(/^(\d+)\s*([smhd])$/i);
  if (!m) return 30 * 24 * 60 * 60 * 1000;
  const n = Number(m[1]);
  const unit = { s: 1000, m: 60 * 1000, h: 3600 * 1000, d: 24 * 3600 * 1000 }[m[2].toLowerCase()];
  return n * unit;
}

function hashRefreshToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

function signAccessToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: ACCESS_EXPIRES_IN });
}

function setRefreshCookie(res, raw, ttlMs = refreshTtlMs()) {
  res.cookie(REFRESH_COOKIE, raw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: cookiePath(res),
    maxAge: ttlMs,
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, { path: cookiePath(res) });
}

/**
 * Prazo ABSOLUTO de uma família: o `expires_at` mais antigo que existe
 * nela, que é o do token original.
 *
 * A rotação precisa deste valor. Emitir com `Date.now() + TTL` a cada
 * vez faria o prazo andar junto com o uso — a família nunca venceria, e
 * um refresh token roubado viveria indefinidamente enquanto o titular
 * legítimo nunca perceberia. É o OAuth 2.0 BCP §4.14.2: rotacionar
 * preserva o prazo da família.
 */
async function prazoDaFamilia(family) {
  const [[minimo]] = await pool.query(
    'SELECT MIN(expires_at) AS prazo FROM refresh_tokens WHERE family = ?',
    [family]
  );
  if (!minimo || !minimo.prazo) return Date.now() + refreshTtlMs();
  const ms = new Date(minimo.prazo).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : Date.now() + refreshTtlMs();
}

/** Quanto ainda resta de vida, em ms, sem passar do prazo da família. */
function restanteDaFamilia(deadlineMs, agora = Date.now()) {
  return Math.max(0, Number(deadlineMs) - agora);
}

async function issueRefreshToken(userId, family, expiresAt = null) {
  const raw = crypto.randomBytes(48).toString('hex');
  const id = crypto.randomUUID();
  const fam = family || crypto.randomUUID();
  const prazo = expiresAt || new Date(Date.now() + refreshTtlMs());
  await pool.query(
    'INSERT INTO refresh_tokens (id, user_id, token_hash, family, expires_at) VALUES (?,?,?,?,?)',
    [id, userId, hashRefreshToken(raw), fam, prazo]
  );
  return { raw, id, family: fam, expiresAt: new Date(prazo).getTime() };
}

function readRefreshRaw(req) {
  return (req.body && req.body.refreshToken) || (req.cookies && req.cookies[REFRESH_COOKIE]) || null;
}

/** Conteúdo do access token (e do `user` devolvido no login) a partir da linha de `users`. */
function payloadDoUsuario(user) {
  return {
    id: user.id, email: user.email,
    role: user.role, admin_level: user.admin_level || null, full_name: user.full_name,
    job_role: user.job_role || null,
  };
}

/** Revoga todos os tokens de uma família (suspeita de roubo, conta desativada). */
async function revogarFamilia(family) {
  await pool.query('UPDATE refresh_tokens SET revoked = 1 WHERE family = ?', [family]);
}

/**
 * Abre uma sessão: assina o access, emite o primeiro refresh de uma família nova
 * e grava o cookie. Devolve o que a resposta de login precisa.
 *
 * @param {object} res resposta Express (recebe o cookie)
 * @param {object} payload conteúdo do access token (id, email, role…)
 * @param {string} userId dono do refresh
 * @returns {Promise<{token: string, refreshToken: string}>}
 */
async function iniciarSessao(res, payload, userId) {
  const token = signAccessToken(payload);
  const { raw: refreshToken } = await issueRefreshToken(userId);
  setRefreshCookie(res, refreshToken);
  return { token, refreshToken };
}

/**
 * Encerra a sessão da requisição: revoga o refresh apresentado (se houver) e
 * limpa o cookie. Não falha se não houver refresh.
 */
async function encerrarSessao(req, res) {
  const raw = readRefreshRaw(req);
  if (raw) {
    await pool.query('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?', [hashRefreshToken(raw)]);
  }
  clearRefreshCookie(res);
}

const SESSAO_EXPIRADA = 'Sessão expirada. Entre novamente.';
const SESSAO_INVALIDADA = 'Sessão invalidada por segurança. Entre novamente.';
const CONTA_DESATIVADA = 'Conta desativada. Entre em contato com a administração.';

/**
 * Rotaciona o par access/refresh a partir do refresh apresentado.
 * Reuso de refresh já rotacionado = possível roubo ⇒ revoga a família inteira.
 *
 * Não toca na resposta HTTP: devolve a decisão e a rota aplica status, cookie e corpo.
 *
 * @returns {Promise<
 *   {ok: true, token: string, refreshToken: string, payload: object, cookieTtlMs: number} |
 *   {ok: false, status: number, error: string, limparCookie?: boolean}>}
 */
async function rotacionarSessao(raw) {
  if (!raw) return { ok: false, status: 401, error: SESSAO_EXPIRADA };

  const [rows] = await pool.query('SELECT * FROM refresh_tokens WHERE token_hash = ?', [hashRefreshToken(raw)]);
  if (!rows.length) return { ok: false, status: 401, error: SESSAO_EXPIRADA };

  const stored = rows[0];
  const expired = new Date(stored.expires_at).getTime() < Date.now();
  if (stored.revoked || expired) {
    // Token já usado/trocado e apresentado de novo: trata como comprometido.
    await revogarFamilia(stored.family);
    return { ok: false, status: 401, error: SESSAO_INVALIDADA, limparCookie: true };
  }

  // Emite o substituto ANTES de revogar o atual: se a emissão falhar,
  // a sessão antiga continua válida (sem logout acidental).
  // O prazo vem da FAMÍLIA, não de agora: rotacionar não pode estender a
  // vida da sessão, senão o par nunca expira.
  const deadline = await prazoDaFamilia(stored.family);
  const { raw: nextRaw, id: nextId } = await issueRefreshToken(stored.user_id, stored.family, new Date(deadline));
  const [upd] = await pool.query(
    'UPDATE refresh_tokens SET revoked = 1, replaced_by = ? WHERE id = ? AND revoked = 0',
    [nextId, stored.id]
  );
  if (upd.affectedRows === 0) {
    // Corrida: o token foi usado em paralelo — trata como reuso.
    await revogarFamilia(stored.family);
    return { ok: false, status: 401, error: SESSAO_INVALIDADA, limparCookie: true };
  }

  const [users] = await pool.query(
    'SELECT id, email, role, admin_level, full_name, job_role, account_status FROM users WHERE id = ?',
    [stored.user_id]
  );
  if (!users.length) return { ok: false, status: 401, error: SESSAO_EXPIRADA };
  const user = users[0];
  if (user.account_status !== 'ativo') {
    await revogarFamilia(stored.family);
    return { ok: false, status: 403, error: CONTA_DESATIVADA };
  }
  const payload = payloadDoUsuario(user);
  return {
    ok: true,
    token: signAccessToken(payload),
    refreshToken: nextRaw,
    payload,
    cookieTtlMs: restanteDaFamilia(deadline),
  };
}

module.exports = {
  REFRESH_COOKIE,
  cookiePath,
  refreshTtlMs,
  hashRefreshToken,
  signAccessToken,
  setRefreshCookie,
  clearRefreshCookie,
  prazoDaFamilia,
  restanteDaFamilia,
  issueRefreshToken,
  readRefreshRaw,
  payloadDoUsuario,
  revogarFamilia,
  iniciarSessao,
  encerrarSessao,
  rotacionarSessao,
};
