/**
 * services/session.js (A1): a rotação do refresh token sem passar por HTTP.
 * Os testes de rota (refresh-prazo, mfa-replay-http…) seguem cobrindo o contrato HTTP.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

const SERVER = path.resolve(__dirname, '..');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const pool = require('../src/db');
const jwt = require(require.resolve('jsonwebtoken', { paths: [SERVER] }));
const {
  issueRefreshToken, rotacionarSessao, iniciarSessao, encerrarSessao, hashRefreshToken, REFRESH_COOKIE,
} = require('../src/services/session');

const CRIADOS = [];
async function usuario(status = 'ativo') {
  const id = crypto.randomUUID();
  await pool.query(
    "INSERT INTO users (id, full_name, email, password_hash, role, account_status) VALUES (?,?,?,?, 'paciente', ?)",
    [id, 'Sessão', `sess-${id}@test.local`, 'x'.repeat(60), status]
  );
  CRIADOS.push(id);
  return id;
}
const revogado = async (raw) => Number((await pool.query('SELECT revoked FROM refresh_tokens WHERE token_hash = ?', [hashRefreshToken(raw)]))[0][0].revoked);

test.after(async () => {
  for (const id of CRIADOS) await pool.query('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
  await pool.end().catch(() => {});
});

test('rotacionarSessao: sem refresh ou desconhecido → 401 sem limpar cookie', async () => {
  for (const raw of [null, '', 'nao-existe']) {
    const r = await rotacionarSessao(raw);
    assert.equal(r.ok, false);
    assert.equal(r.status, 401);
    assert.ok(!r.limparCookie);
  }
});

test('rotacionarSessao: refresh válido gira o par, revoga o antigo e mantém a família', async () => {
  const id = await usuario();
  const a = await issueRefreshToken(id);
  const r = await rotacionarSessao(a.raw);
  assert.equal(r.ok, true);
  assert.notEqual(r.refreshToken, a.raw);
  assert.equal(r.payload.id, id);
  assert.equal(jwt.verify(r.token, process.env.JWT_SECRET).id, id);
  assert.ok(r.cookieTtlMs > 0);
  assert.equal(await revogado(a.raw), 1);
  assert.equal(await revogado(r.refreshToken), 0);
  const [fam] = await pool.query('SELECT DISTINCT family FROM refresh_tokens WHERE user_id = ?', [id]);
  assert.equal(fam.length, 1, 'rotação permanece na mesma família');
});

test('rotacionarSessao: reapresentar o token já rotacionado revoga a família inteira', async () => {
  const id = await usuario();
  const a = await issueRefreshToken(id);
  const novo = await rotacionarSessao(a.raw);
  const reuso = await rotacionarSessao(a.raw);
  assert.equal(reuso.ok, false);
  assert.equal(reuso.status, 401);
  assert.equal(reuso.limparCookie, true);
  assert.equal(await revogado(novo.refreshToken), 1, 'o token novo também cai: pode estar nas mãos do ladrão');
});

test('rotacionarSessao: conta desativada → 403 e família revogada', async () => {
  const id = await usuario('inativo');
  const a = await issueRefreshToken(id);
  const r = await rotacionarSessao(a.raw);
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
  assert.equal(await revogado(a.raw), 1);
});

test('iniciarSessao grava o cookie httpOnly e devolve access + refresh; encerrarSessao revoga e limpa', async () => {
  const id = await usuario();
  const cookies = [];
  const cleared = [];
  const res = {
    cookie: (nome, valor, opts) => cookies.push({ nome, valor, opts }),
    clearCookie: (nome, opts) => cleared.push({ nome, opts }),
  };
  const { token, refreshToken } = await iniciarSessao(res, { id, email: 'a@b.c', role: 'paciente' }, id);
  assert.equal(jwt.verify(token, process.env.JWT_SECRET).id, id);
  assert.equal(cookies[0].nome, REFRESH_COOKIE);
  assert.equal(cookies[0].valor, refreshToken);
  assert.equal(cookies[0].opts.httpOnly, true);
  assert.equal(cookies[0].opts.sameSite, 'lax');

  await encerrarSessao({ body: {}, cookies: { saude_refresh: refreshToken } }, res);
  assert.equal(await revogado(refreshToken), 1);
  assert.equal(cleared[0].nome, REFRESH_COOKIE);

  await encerrarSessao({ body: {}, cookies: {} }, res); // sem refresh: só limpa o cookie, não falha
  assert.equal(cleared.length, 2);
});
