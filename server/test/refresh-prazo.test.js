/**
 * `POST /auth/refresh` emitia o token substituto com
 * `expires_at = Date.now() + refreshTtlMs()` — 30 dias a partir de CADA
 * rotação. A família, portanto, nunca expirava: bastava usar o par de
 * tokens pelo menos uma vez a cada 30 dias para a sessão existir para
 * sempre. O cookie httpOnly tinha o mesmo problema (`maxAge` fixo em 30
 * dias), então mesmo com o banco corrigido o navegador guardaria o token
 * por mais 30 dias.
 *
 * A doc de dívida técnica descreveu isso como "falta teto de tentativas por
 * família" e sugeriu `mfaAttempts`. Esse teto não é a correção — e seria
 * pior que o defeito: um usuário legítimo renova o access token a cada ~15
 * minutos, o que dá ~2.900 rotações em 30 dias, e qualquer teto por contagem
 * derrubaria sessões normais.
 *
 * O controle certo é o do OAuth 2.0 BCP §4.14.2: a rotação preserva o
 * PRAZO ABSOLUTO da família. O primeiro token emitido é o prazo; os
 * seguintes herdam dele e nunca o estendem. Com isso, um token roubado
 * tem no máximo o prazo original — o mesmo do titular legítimo — e a
 * detecção de reuso (que já existe) derruba a família.
 *
 * Os testes retrodatam o token original para provar que a rotação respeita
 * o prazo da família: sem isso, rotacionar dentro do mesmo segundo não
 * diferencia nada e o teste passa mesmo com o defeito.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'server');
const { rewriteSchemaForDb } = require('../../scripts/db-setup');

const DB = `saude_refresh_prazo_${process.pid}`;

require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const CFG = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  charset: 'utf8mb4',
};

process.env.DB_NAME = DB;

const mysql = require(require.resolve('mysql2/promise', { paths: [SERVER] }));
const pool = require('../src/db');
const bcrypt = require(require.resolve('bcryptjs', { paths: [SERVER] }));
const app = require('../src/app');

const USUARIO = '00000000-0000-4000-8000-0000000c1001';
const SENHA = 'senha-de-teste-123';

const sha = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');

let server;
let baseUrl;

async function req(metodo, caminho, corpo) {
  const res = await fetch(baseUrl + caminho, {
    method: metodo,
    headers: { 'content-type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return {
    status: res.status,
    body: await res.json().catch(() => null),
    setCookie: res.headers.getSetCookie(),
  };
}

test.before(async () => {
  const admin = await mysql.createConnection({ ...CFG, multipleStatements: true });
  await admin.query(`DROP DATABASE IF EXISTS \`${DB}\``);
  await admin.query(`CREATE DATABASE \`${DB}\` CHARACTER SET utf8mb4`);
  await admin.query(
    rewriteSchemaForDb(fs.readFileSync(path.join(SERVER, 'schema.sql'), 'utf8'), DB)
  );
  await admin.end();

  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, account_status)
     VALUES (?, 'Prazo Teste', 'prazo@test.local', ?, 'paciente', 'ativo')`,
    [USUARIO, await bcrypt.hash(SENHA, 4)]
  );
});

test.after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await pool.end().catch(() => {});
  const admin = await mysql.createConnection(CFG);
  await admin.query(`DROP DATABASE IF EXISTS \`${DB}\``).catch(() => {});
  await admin.end().catch(() => {});
});

async function login() {
  const { body } = await req('POST', '/auth/login', { email: 'prazo@test.local', password: SENHA });
  assert.ok(body && body.refreshToken, `login falhou: ${JSON.stringify(body)}`);
  return body.refreshToken;
}

test('a rotação normal continua devolvendo um par novo', async () => {
  const refreshToken = await login();
  const { status, body } = await req('POST', '/auth/refresh', { refreshToken });
  assert.equal(status, 200, `refresh falhou: ${JSON.stringify(body)}`);
  assert.ok(body.token, 'devolve access token novo');
  assert.ok(body.refreshToken, 'devolve refresh token novo');
  assert.notEqual(body.refreshToken, refreshToken, 'o refresh precisa ser rotacionado de verdade');
});

test('a rotação NÃO estende o prazo original da família', async () => {
  const refreshToken = await login();

  // Sessão já velha: o token original vence em 1 hora. Sem isto a rotação
  // acontece no mesmo segundo e o teste passaria mesmo com o defeito.
  const prazoDaFamilia = new Date(Date.now() + 60 * 60 * 1000);
  await pool.query('UPDATE refresh_tokens SET expires_at = ? WHERE token_hash = ?', [prazoDaFamilia, sha(refreshToken)]);

  const { status, body } = await req('POST', '/auth/refresh', { refreshToken });
  assert.equal(status, 200, `refresh falhou: ${JSON.stringify(body)}`);

  const [[novo]] = await pool.query('SELECT expires_at FROM refresh_tokens WHERE token_hash = ?', [sha(body.refreshToken)]);
  assert.ok(novo, 'o token rotacionado precisa existir no banco');

  assert.ok(
    new Date(novo.expires_at).getTime() <= prazoDaFamilia.getTime() + 1000,
    `o token novo venceu ${novo.expires_at}, depois do prazo da família (${prazoDaFamilia.toISOString()}) — a família é imortal`
  );
});

test('o cookie httpOnly também respeita o prazo original', async () => {
  const refreshToken = await login();

  const prazoDaFamilia = new Date(Date.now() + 60 * 60 * 1000);
  await pool.query('UPDATE refresh_tokens SET expires_at = ? WHERE token_hash = ?', [prazoDaFamilia, sha(refreshToken)]);

  const { setCookie } = await req('POST', '/auth/refresh', { refreshToken });
  const cookie = (setCookie || []).find((c) => c.startsWith('saude_refresh='));
  assert.ok(cookie, `a resposta deve trazer o cookie de refresh; veio: ${JSON.stringify(setCookie)}`);

  const maxAge = Number((cookie.match(/Max-Age=(\d+)/i) || [])[1]);
  assert.ok(Number.isFinite(maxAge), `Max-Age deveria ser número; cookie: ${cookie}`);
  assert.ok(
    maxAge <= 3600 + 5,
    `Max-Age ${maxAge}s passa do prazo da família (3600s) — o navegador guardaria o token por mais 30 dias`
  );
});

test('prazo vencido derruba a família inteira, como já fazia o token', async () => {
  const refreshToken = await login();

  // Só a família desta sessão — os testes anteriores criaram as suas.
  const [[linha]] = await pool.query('SELECT family FROM refresh_tokens WHERE token_hash = ?', [sha(refreshToken)]);
  const familia = linha.family;

  await pool.query('UPDATE refresh_tokens SET expires_at = ? WHERE family = ?', [new Date(Date.now() - 1000), familia]);

  const { status } = await req('POST', '/auth/refresh', { refreshToken });
  assert.equal(status, 401, 'prazo vencido precisa ser 401');

  const [[n]] = await pool.query('SELECT COUNT(*) AS n FROM refresh_tokens WHERE family = ? AND revoked = 0', [familia]);
  assert.equal(n.n, 0, 'a família precisa estar revogada, não só expirada');
});