// ==========================================================================
// Saúde+ — TOTP / MFA (Aulas 1/6: autenticidade + controle preventivo)
// Implementação manual RFC 6238/4226 (HMAC-SHA1, 30s, 6 dígitos) sem
// dependências — didático e auditável. Compatível com Google/Microsoft
// Authenticator via otpauth:// URL (o usuário digita o segredo ou o app lê
// o texto; sem lib de QR para não puxar dependência nativa).
// ==========================================================================
const crypto = require('crypto');

const STEP = 30;
const DIGITS = 6;
const WINDOW = 1; // aceita ±1 passo (relógio dessincronizado)

function randomSecret(bytes = 20) {
  return crypto.randomBytes(bytes).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(s) {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64');
}

function hotp(secret, counter) {
  const key = base64UrlDecode(secret);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return String(code % 10 ** DIGITS).padStart(DIGITS, '0');
}

function totpNow(secret, atMs = Date.now()) {
  return hotp(secret, Math.floor(atMs / 1000 / STEP));
}

/**
 * Verifica o código e devolve QUAL passo casou.
 *
 * A rota precisa do passo, não só do booleano: sem ele não dá para impedir
 * replay (RFC 6238 §5.2 — um código não pode ser usado duas vezes, nem
 * durante a janela de tolerância).
 *
 * @returns {{ok: boolean, step?: number}}
 */
function matchStep(secret, code, atMs = Date.now()) {
  const clean = String(code || '').replace(/\D/g, '');
  if (clean.length !== DIGITS) return { ok: false };
  const step = Math.floor(atMs / 1000 / STEP);
  for (let d = -WINDOW; d <= WINDOW; d += 1) {
    const candidate = step + d;
    const expected = hotp(secret, candidate);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) {
      return { ok: true, step: candidate };
    }
  }
  return { ok: false };
}

function verifyTotp(secret, code, atMs = Date.now()) {
  return matchStep(secret, code, atMs).ok;
}

/**
 * O passo `tentado` é replay de `ultimoUsado`?
 *
 * Bloqueia o passo usado E todos os anteriores: pela janela ±1, o passo -1 é
 * literalmente o mesmo código validado por outra via da função. Passos futuros
 * são livres — é o próximo código de verdade.
 *
 * @param {number|null|undefined} ultimoUsado passo do último código aceito
 * @param {number} tentado passo do código agora apresentado
 */
function replayBloqueia(ultimoUsado, tentado) {
  if (typeof ultimoUsado !== 'number' || !Number.isFinite(ultimoUsado)) return false;
  if (typeof tentado !== 'number' || !Number.isFinite(tentado)) return true;
  return tentado <= ultimoUsado;
}

function otpauthUrl({ secret, email, issuer = 'Saude+' }) {
  const label = `${issuer}:${email}`;
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

module.exports = { randomSecret, totpNow, verifyTotp, matchStep, replayBloqueia, otpauthUrl, STEP, DIGITS };
