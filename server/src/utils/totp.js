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

function verifyTotp(secret, code, atMs = Date.now()) {
  const clean = String(code || '').replace(/\D/g, '');
  if (clean.length !== DIGITS) return false;
  const step = Math.floor(atMs / 1000 / STEP);
  for (let d = -WINDOW; d <= WINDOW; d++) {
    const expected = hotp(secret, step + d);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return true;
  }
  return false;
}

function otpauthUrl({ secret, email, issuer = 'Saude+' }) {
  const label = `${issuer}:${email}`;
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

module.exports = { randomSecret, totpNow, verifyTotp, otpauthUrl, STEP, DIGITS };
