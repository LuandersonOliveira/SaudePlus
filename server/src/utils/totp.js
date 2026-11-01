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

// --------------------------------------------------------------------------
// Formato do segredo: BASE32 (RFC 4648, sem padding).
//
// Google/Microsoft Authenticator e afins só aceitam base32 no `secret=` do
// otpauth:// e na digitação manual. O formato anterior (base64url) não era
// cadastrável em app real. Os segredos antigos continuam válidos: a migração
// `migrate:mfa:base32` recodifica os MESMOS bytes, então os códigos não mudam.
// --------------------------------------------------------------------------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s) {
  const clean = String(s).toUpperCase().replace(/=+$/, '').replace(/[\s-]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('Segredo base32 inválido.');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return Buffer.from(out);
}

function randomSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

function base64UrlDecode(s) {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64');
}

/**
 * Base32 de 20 bytes tem exatamente 32 caracteres de A-Z2-7; o legado base64url
 * de 20 bytes tem 27 (e usa minúsculas, dígitos 0-9, `-` e `_`). O comprimento
 * separa os dois sem ambiguidade para segredos gerados pelo app.
 */
function ehBase32(secret) {
  return /^[A-Z2-7]{32}$/.test(String(secret));
}

/** Bytes da chave, aceitando base32 (atual) e base64url (legado, até migrar). */
function secretToKey(secret) {
  return ehBase32(secret) ? base32Decode(secret) : base64UrlDecode(secret);
}

/** Recodifica um segredo legado (base64url) para base32 SEM mudar os bytes. */
function legacyToBase32(secret) {
  return ehBase32(secret) ? secret : base32Encode(base64UrlDecode(secret));
}

function hotp(secret, counter) {
  const key = secretToKey(secret);
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

module.exports = { base32Encode, base32Decode, ehBase32, legacyToBase32, randomSecret, totpNow, verifyTotp, matchStep, replayBloqueia, otpauthUrl, STEP, DIGITS };
