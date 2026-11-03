/**
 * ADR-0011 (E-21): o refresh token só trafega por cookie HttpOnly e a API confere a origem.
 *
 *  - nenhuma resposta (login, refresh) devolve `refreshToken` no corpo, e o corpo não é aceito;
 *  - POST /auth/refresh e /auth/logout recusam `Origin` de outro site (defesa de CSRF do cookie
 *    SameSite=Lax). Sem `Origin` (curl, scripts, testes) segue valendo.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');

const SERVER = path.resolve(__dirname, '..');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const pool = require('../src/db');
const bcrypt = require(require.resolve('bcryptjs', { paths: [SERVER] }));
const app = require('../src/app');

const SENHA = 'Senha-Forte-123';
const USUARIOS = [];
let server;
let porta;

// http puro: o `fetch` do Node trata `Origin` como cabeçalho proibido em alguns ambientes.
function chamar(method, rota, { cookie, origin, body } = {}) {
  return new Promise((resolve, reject) => {
    const dados = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1', port: porta, path: `/api${rota}`, method,
        headers: {
          'Content-Type': 'application/json',
          ...(dados ? { 'Content-Length': Buffer.byteLength(dados) } : {}),
          ...(cookie ? { Cookie: `saude_refresh=${cookie}` } : {}),
          ...(origin ? { Origin: origin } : {}),
        },
      },
      (res) => {
        let txt = '';
        res.on('data', (c) => { txt += c; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(txt); } catch { /* sem corpo JSON */ }
          resolve({ status: res.statusCode, body: json, setCookie: res.headers['set-cookie'] || [] });
        });
      }
    );
    req.on('error', reject);
    if (dados) req.write(dados);
    req.end();
  });
}

const valorDoCookie = (setCookie) => {
  const c = setCookie.find((x) => x.startsWith('saude_refresh='));
  return c ? decodeURIComponent(c.split(';')[0].slice('saude_refresh='.length)) : null;
};
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const revogado = async (raw) => Number((await pool.query('SELECT revoked FROM refresh_tokens WHERE token_hash = ?', [sha(raw)]))[0][0].revoked);

async function loginNovo() {
  const id = crypto.randomUUID();
  const email = `cookie-${id}@test.local`;
  await pool.query(
    'INSERT INTO users (id, full_name, email, password_hash, role, account_status) VALUES (?,?,?,?,?,?)',
    [id, 'Paciente Cookie', email, await bcrypt.hash(SENHA, 4), 'paciente', 'ativo']
  );
  USUARIOS.push(id);
  const r = await chamar('POST', '/auth/login', { body: { email, password: SENHA } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { id, email, resposta: r, refresh: valorDoCookie(r.setCookie) };
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  porta = server.address().port;
});
test.after(async () => {
  await new Promise((r) => server.close(r));
  for (const id of USUARIOS) {
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = ?', [id]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
  }
  await pool.end().catch(() => {});
});

// ---------------------------------------------------------------------------
// o corpo não carrega refresh token
// ---------------------------------------------------------------------------

test('login: o corpo traz o access token mas NÃO o refresh; o refresh vai no cookie HttpOnly', async () => {
  const { resposta, refresh } = await loginNovo();
  assert.ok(resposta.body.token, 'access token no corpo');
  assert.equal(resposta.body.refreshToken, undefined, 'refresh token fora do corpo');
  assert.ok(refresh, 'refresh token no cookie');
  assert.match(resposta.setCookie.find((c) => c.startsWith('saude_refresh=')), /HttpOnly/i);
});

test('refresh: rotaciona pelo cookie e também não devolve o refresh no corpo', async () => {
  const { refresh } = await loginNovo();
  const r = await chamar('POST', '/auth/refresh', { cookie: refresh, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.token);
  assert.equal(r.body.refreshToken, undefined);
  const novo = valorDoCookie(r.setCookie);
  assert.ok(novo && novo !== refresh, 'cookie novo, diferente do anterior');
});

test('refresh enviado no CORPO é ignorado: 401 e o token não é consumido', async () => {
  const { refresh } = await loginNovo();
  const r = await chamar('POST', '/auth/refresh', { body: { refreshToken: refresh } });
  assert.equal(r.status, 401);
  assert.equal(await revogado(refresh), 0, 'o token enviado no corpo não pode ser rotacionado');
});

// ---------------------------------------------------------------------------
// checagem de Origin
// ---------------------------------------------------------------------------

test('refresh com Origin de OUTRO site: 403 e nada é rotacionado', async () => {
  const { refresh } = await loginNovo();
  const r = await chamar('POST', '/auth/refresh', { cookie: refresh, origin: 'https://site-malicioso.example', body: {} });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'Origem não permitida.');
  assert.equal(r.setCookie.length, 0, 'sem cookie novo');
  assert.equal(await revogado(refresh), 0, 'o token continua válido');
});

test('logout com Origin de outro site: 403 e a sessão NÃO é revogada', async () => {
  const { refresh } = await loginNovo();
  const r = await chamar('POST', '/auth/logout', { cookie: refresh, origin: 'https://site-malicioso.example', body: {} });
  assert.equal(r.status, 403);
  assert.equal(await revogado(refresh), 0);
});

test('Origin igual ao host da requisição passa (origem única)', async () => {
  const { refresh } = await loginNovo();
  const r = await chamar('POST', '/auth/refresh', { cookie: refresh, origin: `http://127.0.0.1:${porta}`, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test('Origin da lista CORS_ORIGIN passa (padrão de desenvolvimento: http://localhost:8080)', async () => {
  const { refresh } = await loginNovo();
  const permitida = (process.env.CORS_ORIGIN || 'http://localhost:8080').split(',')[0].trim();
  const r = await chamar('POST', '/auth/refresh', { cookie: refresh, origin: permitida, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test('sem Origin (curl, scripts) passa', async () => {
  const { refresh } = await loginNovo();
  const r = await chamar('POST', '/auth/refresh', { cookie: refresh, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test('Origin malformado ("null") é recusado', async () => {
  const { refresh } = await loginNovo();
  const r = await chamar('POST', '/auth/refresh', { cookie: refresh, origin: 'null', body: {} });
  assert.equal(r.status, 403);
});

test('logout legítimo revoga o refresh do cookie', async () => {
  const { refresh } = await loginNovo();
  const r = await chamar('POST', '/auth/logout', { cookie: refresh, body: {} });
  assert.equal(r.status, 200);
  assert.equal(await revogado(refresh), 1);
});
