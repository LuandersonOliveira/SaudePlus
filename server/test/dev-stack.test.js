/**
 * As DUAS pontas juntas, do jeito que `npm run dev` sobe.
 *
 * Existe uma classe de defeito que nenhum teste unitário pega: a API e o front
 * sobem, cada um responde 200 no seu endereço, e mesmo assim a aplicação não
 * funciona — porque os dois discordam sobre QUAL É A URL. Foi exatamente o
 * que aconteceu:
 *
 *   serve-web.js anunciava  http://127.0.0.1:8080
 *   server/.env liberava    http://localhost:8080   (CORS)
 *   assets/api.js chamava    http://localhost:4000
 *
 * Abrir a página pelo host anunciado dava 403 em todo fetch. O navegador
 * mostra "Failed to fetch"; o terminal não mostra nada; o painel fica vazio.
 * Nenhum teste existente reclamou, porque cada ponta estava "funcionando".
 *
 * Este teste sobe a API e o servidor estático em portas efêmeras, faz login
 * de verdade e confere que a resposta volta com os devidos cabeçalhos de CORS.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createWebServer } = require('../../scripts/serve-web');

const SERVER = path.resolve(__dirname, '..', '..');
const RAIZ = SERVER; // este arquivo está em server/test/ → a raiz é o mesmo caminho

// `require('../src/app')` carrega o `.env` (primeira linha do app.js), então
// process.env.JWT_SECRET e CORS_ORIGIN já estão disponíveis aqui.
const app = require('../src/app');
const pool = require('../src/db');
const jwt = require('jsonwebtoken');

let api;
let web;
let frontBase;
let apiBase;
let admin;
let token;

// A allowlist do CORS é lida do `.env` quando o app carrega — não dá para
// injetar origem em runtime. Por isso este teste sobe o front na porta REAL
// (a de CORS_ORIGIN), e a API em porta efêmera. Se o `.env` estiver errado,
// o teste falha, que é exatamente o que ele precisa pegar.
const FRONT_PORT = Number(
  /https?:\/\/[^:]+:(\d+)/.exec(process.env.CORS_ORIGIN || 'http://localhost:8080')[1]
);

test.before(async () => {
  web = createWebServer();
  await new Promise((r) => web.listen(FRONT_PORT, '127.0.0.1', r));
  frontBase = `http://localhost:${FRONT_PORT}`;

  api = app.listen(0);
  await new Promise((r) => api.once('listening', r));
  apiBase = `http://localhost:${api.address().port}`;

  const [[u]] = await pool.query(
    "SELECT id, email, full_name, admin_level FROM users WHERE role = 'admin' AND account_status = 'ativo' AND email NOT LIKE 'removido%' LIMIT 1"
  );
  assert.ok(u, 'precisa de um admin ativo — rode npm run db:seed');
  admin = u;

  token = jwt.sign(
    { id: u.id, email: u.email, role: 'admin', admin_level: u.admin_level, full_name: u.full_name },
    process.env.JWT_SECRET,
    { expiresIn: '5m' }
  );
});

test.after(async () => {
  if (typeof api.closeAllConnections === 'function') api.closeAllConnections();
  await new Promise((r) => api.close(r));
  if (typeof web.closeAllConnections === 'function') web.closeAllConnections();
  await new Promise((r) => web.close(r));
  await pool.end().catch(() => {});
});

test('a página inicial e os assets saem do servidor estático', async () => {
  const home = await fetch(`${frontBase}/`, { redirect: 'manual' });
  assert.equal(home.status, 301);
  assert.equal(home.headers.get('location'), '/index.html');

  for (const p of ['/index.html', '/auth.html', '/dashboard.html', '/admin.html', '/atendente.html', '/privacy.html']) {
    assert.equal((await fetch(frontBase + p)).status, 200, `${p} deveria responder 200`);
  }
  assert.equal((await fetch(`${frontBase}/assets/api.js`)).status, 200);
  assert.equal((await fetch(`${frontBase}/assets/styles.css`)).status, 200);
});

test('a página sem extensão que ficou no histórico redireciona', async () => {
  // O sintoma reportado: abrir localhost:8080/admin (URL antiga, salva no
  // navegador) devolvia 404 e parecia "aplicação quebrada".
  const res = await fetch(`${frontBase}/admin`, { redirect: 'manual' });
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), '/admin.html');
  // E seguir o redirect entrega a página de verdade.
  assert.equal((await fetch(`${frontBase}/admin.html`)).status, 200);
});

test('a API responde à origem do front com o CORS liberado', async () => {
  const res = await fetch(`${apiBase}/admin/stats`, {
    headers: { Authorization: `Bearer ${token}`, Origin: frontBase },
  });
  assert.equal(res.status, 200, `/admin/stats deveria responder 200 com Origin ${frontBase}`);
  assert.equal(
    res.headers.get('access-control-allow-origin'),
    frontBase,
    'o navegador só libera a resposta quando este cabeçalho bate com a origem'
  );
});

test('o preflight do login é liberado para a origem do front', async () => {
  // É o OPTIONS que o navegador manda antes do POST. Se ele volta sem
  // Access-Control-Allow-Origin, o POST nem é tentado e o erro aparece
  // como "Failed to fetch" — exatamente o sintoma relatado.
  const res = await fetch(`${apiBase}/auth/login`, {
    method: 'OPTIONS',
    headers: {
      Origin: frontBase,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), frontBase);
});

test('origem de verdade diferente é recusada — o CORS não virou allow-all', async () => {
  const res = await fetch(`${apiBase}/admin/stats`, {
    headers: { Authorization: `Bearer ${token}`, Origin: 'https://evil.example' },
  });
  assert.equal(res.status, 403, 'origem fora da lista precisa continuar bloqueada');
});

test('os dois pontos de vista concordam sobre a URL', () => {
  // A regra que vale para sempre: a origem que o front anuncia tem que estar
  // na allowlist do CORS. É a mesma checagem que o doctor faz.
  const fs = require('node:fs');
  const serve = fs.readFileSync(path.join(RAIZ, 'scripts', 'serve-web.js'), 'utf8');
  const host = /WEB_HOST\s*\|\|\s*'([^']+)'/.exec(serve)[1];
  const { corsProblem } = require('../../scripts/doctor');
  assert.equal(
    corsProblem({ CORS_ORIGIN: 'http://localhost:8080' }, { webHost: host, webPort: 8080 }),
    null,
    `serve-web anuncia '${host}' mas o CORS padrão não cobre essa origem`
  );
});