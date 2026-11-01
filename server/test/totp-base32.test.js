/**
 * MFA em base32: o segredo precisa ser cadastrável em Google/Microsoft
 * Authenticator, e os segredos antigos (base64url) não podem parar de funcionar.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'server');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });
const mysql = require(require.resolve('mysql2/promise', { paths: [SERVER] }));
const { rewriteSchemaForDb } = require('../../scripts/db-setup');
const {
  base32Encode, base32Decode, ehBase32, legacyToBase32, randomSecret, totpNow, verifyTotp, otpauthUrl,
} = require('../src/utils/totp');

const legadoB64Url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

test('base32: vetores do RFC 4648', () => {
  const casos = [['', ''], ['f', 'MY'], ['fo', 'MZXQ'], ['foo', 'MZXW6'], ['foob', 'MZXW6YQ'], ['fooba', 'MZXW6YTB'], ['foobar', 'MZXW6YTBOI']];
  for (const [txt, b32] of casos) {
    assert.equal(base32Encode(Buffer.from(txt)), b32);
    assert.equal(base32Decode(b32).toString(), txt);
  }
});

test('base32Decode tolera minúsculas, espaços, hífens e padding; recusa símbolo inválido', () => {
  assert.equal(base32Decode('mzxw 6ytb-oi======').toString(), 'foobar');
  assert.throws(() => base32Decode('MZXW1'), /inválido/);
});

test('RFC 6238: vetor oficial (SHA-1, T=59s → 287082) com o segredo em base32', () => {
  const segredo = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(segredo, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(totpNow(segredo, 59 * 1000), '287082');
  assert.equal(totpNow(segredo, 1111111109 * 1000), '081804');
});

test('randomSecret: 32 caracteres base32 (20 bytes) e o app lê o mesmo texto no otpauth://', () => {
  const s = randomSecret();
  assert.match(s, /^[A-Z2-7]{32}$/);
  assert.equal(base32Decode(s).length, 20);
  assert.equal(ehBase32(s), true);
  assert.notEqual(randomSecret(), s);
  assert.match(otpauthUrl({ secret: s, email: 'a@b.c' }), new RegExp(`secret=${s}&`));
});

test('segredo legado (base64url) continua validando e dá os MESMOS códigos após converter', () => {
  for (let i = 0; i < 50; i += 1) {
    const bytes = crypto.randomBytes(20);
    const antigo = legadoB64Url(bytes);
    assert.equal(antigo.length, 27);
    assert.equal(ehBase32(antigo), false);
    const novo = legacyToBase32(antigo);
    assert.equal(novo, base32Encode(bytes));
    assert.equal(legacyToBase32(novo), novo, 'converter de novo não muda nada');
    const agora = Date.now();
    assert.equal(totpNow(antigo, agora), totpNow(novo, agora), 'a migração não pode trocar os códigos');
    assert.equal(verifyTotp(antigo, totpNow(novo, agora), agora), true);
  }
});

// ---------------------------------------------------------------------------
// Migração
// ---------------------------------------------------------------------------

const DB = `saude_mfab32_${process.pid}`;
const cfg = () => ({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  charset: 'utf8mb4',
});

test('migrate:mfa:base32 recodifica os segredos antigos, é idempotente e não imprime segredo', async (t) => {
  const admin = await mysql.createConnection(cfg());
  await admin.query('DROP DATABASE IF EXISTS `' + DB + '`');
  await admin.query('CREATE DATABASE `' + DB + '` CHARACTER SET utf8mb4');
  await admin.end();
  const conn = await mysql.createConnection({ ...cfg(), database: DB, multipleStatements: true });
  t.after(async () => {
    await conn.end().catch(() => {});
    const a = await mysql.createConnection(cfg());
    await a.query('DROP DATABASE IF EXISTS `' + DB + '`').catch(() => {});
    await a.end().catch(() => {});
  });
  await conn.query(rewriteSchemaForDb(fs.readFileSync(path.join(SERVER, 'schema.sql'), 'utf8'), DB));

  const mk = async (secret, enabled = 1) => {
    const id = crypto.randomUUID();
    await conn.query(
      "INSERT INTO users (id, full_name, email, password_hash, role, totp_secret, totp_enabled) VALUES (?,?,?,?, 'paciente', ?, ?)",
      [id, 'MFA', `mfa-${id}@test.local`, 'x'.repeat(60), secret, enabled]
    );
    return id;
  };
  const bytes = crypto.randomBytes(20);
  const antigo = legadoB64Url(bytes);
  const novo = randomSecret();
  const uAntigo = await mk(antigo);
  const uNovo = await mk(novo, 0);
  const uSem = await mk(null, 0);
  const lerSecret = async (id) => (await conn.query('SELECT totp_secret FROM users WHERE id = ?', [id]))[0][0].totp_secret;

  const rodar = () => spawnSync(process.execPath, [path.join(SERVER, 'scripts', 'migrate-mfa-base32.js')], {
    cwd: SERVER, env: { ...process.env, DB_NAME: DB }, encoding: 'utf8',
  });

  const r1 = rodar();
  assert.equal(r1.status, 0, r1.stderr);
  assert.match(r1.stdout, /1 convertido\(s\), 1 já em base32/);
  assert.equal(await lerSecret(uAntigo), base32Encode(bytes));
  assert.equal(await lerSecret(uNovo), novo, 'segredo já base32 não muda');
  assert.equal(await lerSecret(uSem), null);
  assert.ok(!(r1.stdout + r1.stderr).includes(antigo) && !(r1.stdout + r1.stderr).includes(base32Encode(bytes)), 'nunca imprime segredo');

  const r2 = rodar();
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(r2.stdout, /0 convertido\(s\), 2 já em base32/);
});

test('migrate:all executa mfa:base32 depois do mfa:replay', () => {
  const pkg = require('../package.json');
  assert.ok(pkg.scripts['migrate:mfa:base32']);
  assert.match(pkg.scripts['migrate:all'], /migrate:mfa:replay && npm run migrate:mfa:base32 && npm run migrate:booking:duration/);
});
