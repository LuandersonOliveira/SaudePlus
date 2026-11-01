/**
 * POST /auth/mfa/setup gerava um segredo TOTP novo e o devolvia em texto
 * puro, bastando um Bearer token válido. Quem tivesse um token vazado
 * (XSS, log de JWT, máquina compartilhada — o front guarda o refresh em
 * localStorage) podia:
 *   1. chamar mfa/setup e ler o segredo;
 *   2. chamar mfa/enable com um código gerado por ele mesmo;
 *   3. o segundo fator do usuário passava a pertencer ao atacante.
 *
 * mfa/disable já exigia a senha; setup não. Agora exige, e o caminho para
 * trocar o fator de um usuário que já tem MFA continua sendo disable.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'server');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const pool = require('../src/db');
const jwt = require(require.resolve('jsonwebtoken', { paths: [SERVER] }));
const bcrypt = require(require.resolve('bcryptjs', { paths: [SERVER] }));
const app = require('../src/app');

const SENHA = 'senha-de-teste-123';
const CRIADOS = [];

async function criarUsuario() {
  const id = crypto.randomUUID();
  const email = `mfa+${id.slice(0, 8)}@test.local`;
  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, account_status)
     VALUES (?,?,?,?,?,?)`,
    [id, 'Teste MFA', email, await bcrypt.hash(SENHA, 4), 'paciente', 'ativo']
  );
  CRIADOS.push(id);
  return { id, email };
}

function tokenPara(u) {
  return jwt.sign(
    { id: u.id, email: u.email, role: 'paciente', admin_level: null, full_name: 'Teste MFA' },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );
}

let server;
let base;

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((r) => server.close(r));
  for (const id of CRIADOS) {
    await pool.query('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
  }
  await pool.end().catch(() => {});
});

async function rota(rota, u, body) {
  const res = await fetch(`${base}${rota}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenPara(u)}`,
    },
    body: JSON.stringify(body || {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* sem corpo */ }
  return { status: res.status, body: json };
}

async function lerMfa(id) {
  const [[row]] = await pool.query(
    'SELECT totp_secret, totp_enabled FROM users WHERE id = ?',
    [id]
  );
  return row;
}

test('mfa/setup sem senha é recusado e não gera segredo', async () => {
  const u = await criarUsuario();
  const r = await rota('/auth/mfa/setup', u, {});
  assert.equal(r.status, 400);
  assert.match(r.body.error, /senha/i);

  const row = await lerMfa(u.id);
  assert.equal(row.totp_secret, null, 'nenhum segredo pode ter sido gravado');
  assert.equal(row.totp_enabled, 0);
});

test('mfa/setup com senha errada é recusado e não gera segredo', async () => {
  const u = await criarUsuario();
  const r = await rota('/auth/mfa/setup', u, { password: 'senha-errada-999' });
  assert.equal(r.status, 401);
  assert.match(r.body.error, /senha/i);

  const row = await lerMfa(u.id);
  assert.equal(row.totp_secret, null);
});

test('mfa/setup com a senha certa devolve o segredo e persiste', async () => {
  const u = await criarUsuario();
  const r = await rota('/auth/mfa/setup', u, { password: SENHA });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  // randomSecret() = 20 bytes em base64url → 160 bits de entropia, 27
  // caracteres sem padding.
  assert.match(
    r.body.secret,
    /^[A-Za-z0-9_-]{27}$/,
    `segredo fora do formato esperado: ${r.body.secret}`
  );
  assert.equal(
    Buffer.from(r.body.secret.replace(/-/g, '+').replace(/_/g, '/'), 'base64').length,
    20,
    'o segredo precisa ter 20 bytes (160 bits), não menos'
  );
  assert.match(r.body.otpauth_url, /^otpauth:\/\/totp\//);

  const row = await lerMfa(u.id);
  assert.equal(row.totp_secret, r.body.secret);
  assert.equal(row.totp_enabled, 0, 'ainda não está ativo: falta confirmar o código');
});

test('mfa/setup não devolve segredo quando o MFA já está ativo', async () => {
  const u = await criarUsuario();
  await rota('/auth/mfa/setup', u, { password: SENHA });
  await pool.query('UPDATE users SET totp_enabled = 1 WHERE id = ?', [u.id]);

  const r = await rota('/auth/mfa/setup', u, { password: SENHA });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /ativo/i);
  assert.equal(r.body.secret, undefined, 'o segredo ativo não pode ser lido por esta rota');
});

test('mfa/setup sem token é 401 antes de qualquer coisa', async () => {
  const res = await fetch(`${base}/auth/mfa/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: SENHA }),
  });
  assert.equal(res.status, 401);
});

test('mfa/disable continua exigindo a senha', async () => {
  const u = await criarUsuario();
  await rota('/auth/mfa/setup', u, { password: SENHA });
  await pool.query('UPDATE users SET totp_enabled = 1 WHERE id = ?', [u.id]);

  const semSenha = await rota('/auth/mfa/disable', u, {});
  assert.equal(semSenha.status, 401, 'sem senha não pode desligar');

  const comSenha = await rota('/auth/mfa/disable', u, { password: SENHA });
  assert.equal(comSenha.status, 200, JSON.stringify(comSenha.body));

  const row = await lerMfa(u.id);
  assert.equal(row.totp_secret, null);
  assert.equal(row.totp_enabled, 0);
});

test('mfa/enable só liga com o código do segredo pendente', async () => {
  const u = await criarUsuario();
  const setup = await rota('/auth/mfa/setup', u, { password: SENHA });
  const secret = setup.body.secret;

  const errado = await rota('/auth/mfa/enable', u, { code: '000000' });
  assert.equal(errado.status, 401);

  const { totpNow } = require('../src/utils/totp');
  const certo = await rota('/auth/mfa/enable', u, { code: totpNow(secret) });
  assert.equal(certo.status, 200, JSON.stringify(certo.body));

  const row = await lerMfa(u.id);
  assert.equal(row.totp_enabled, 1);
});