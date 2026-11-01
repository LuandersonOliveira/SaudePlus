/**
 * O Express entrega o build do React (web/dist) e a API passa a viver só em /api.
 *
 * Sem isto, a produção teria dois servidores e CORS de ponta a ponta; com isto
 * errado, uma rota do React (/auth, /admin) viraria 404 JSON da API, ou um asset
 * ausente viraria HTML e o navegador tentaria executá-lo como script.
 *
 * Os testes montam um dist falso (não dependem de `npm run build:web`) e carregam
 * o app de novo a cada cenário, porque o modo é decidido na carga do módulo.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP = require.resolve('../src/app');
const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'saude-dist-'));
fs.mkdirSync(path.join(dist, 'assets'));
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Saude+ React</title><div id="root"></div>');
fs.writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'console.log("ok")');
fs.writeFileSync(path.join(dist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');

const savedEnv = { SERVE_WEB: process.env.SERVE_WEB, WEB_DIST: process.env.WEB_DIST, NODE_ENV: process.env.NODE_ENV };
const servers = [];

async function boot(env) {
  Object.assign(process.env, { WEB_DIST: dist }, env);
  for (const k of Object.keys(env)) if (env[k] === undefined) delete process.env[k];
  delete require.cache[APP];
  const app = require('../src/app');
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

test.after(async () => {
  for (const s of servers) {
    if (typeof s.closeAllConnections === 'function') s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  fs.rmSync(dist, { recursive: true, force: true });
  await require('../src/db').end().catch(() => {});
});

test('SERVE_WEB=1: rota do React devolve o index.html sem cache', async () => {
  const base = await boot({ SERVE_WEB: '1' });
  for (const rota of ['/', '/privacy', '/auth', '/admin/cadastros/rede', '/dashboard/agendar']) {
    const r = await fetch(base + rota);
    assert.equal(r.status, 200, rota);
    assert.match(r.headers.get('content-type'), /text\/html/, rota);
    assert.equal(r.headers.get('cache-control'), 'no-cache', rota);
    assert.match(await r.text(), /Saude\+ React/, rota);
  }
});

test('SERVE_WEB=1: assets têm cache longo; arquivo que não existe é 404, não HTML', async () => {
  const base = await boot({ SERVE_WEB: '1' });
  const ok = await fetch(base + '/assets/app-abc123.js');
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('cache-control'), /immutable/);
  assert.equal((await fetch(base + '/favicon.svg')).headers.get('cache-control'), 'no-cache');
  const faltando = await fetch(base + '/assets/velho.js');
  assert.equal(faltando.status, 404);
  assert.doesNotMatch(await faltando.text(), /<!doctype/i);
});

test('SERVE_WEB=1: a API responde só em /api; na raiz /auth é página do React', async () => {
  const base = await boot({ SERVE_WEB: '1' });
  const api = await fetch(base + '/api/auth/me');
  assert.equal(api.status, 401);
  assert.match(api.headers.get('content-type'), /json/);
  const desconhecida = await fetch(base + '/api/nao-existe');
  assert.equal(desconhecida.status, 404);
  assert.match(desconhecida.headers.get('content-type'), /json/);
  assert.match(await (await fetch(base + '/auth/me')).text(), /Saude\+ React/);
});

test('SERVE_WEB=1: POST fora da API não vira HTML; /health continua na raiz', async () => {
  const base = await boot({ SERVE_WEB: '1' });
  const post = await fetch(base + '/privacy', { method: 'POST' });
  assert.equal(post.status, 404);
  assert.match(post.headers.get('content-type'), /json/);
  assert.equal((await fetch(base + '/health')).status, 200);
});

test('SERVE_WEB=1: CSP libera o ViaCEP e continua bloqueando script de fora', async () => {
  const base = await boot({ SERVE_WEB: '1' });
  const csp = (await fetch(base + '/')).headers.get('content-security-policy');
  assert.match(csp, /connect-src 'self' https:\/\/viacep\.com\.br/);
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /upgrade-insecure-requests/, 'em http (dev/teste) quebraria os assets');
});

test('SERVE_WEB=0: modo legado — API na raiz, sem front embutido', async () => {
  const base = await boot({ SERVE_WEB: '0' });
  assert.equal((await fetch(base + '/auth/me')).status, 401);
  assert.equal((await fetch(base + '/api/auth/me')).status, 401, '/api também responde (o React em dev usa)');
  const pagina = await fetch(base + '/privacy');
  assert.equal(pagina.status, 404);
  assert.match(pagina.headers.get('content-type'), /json/);
});

test('sem SERVE_WEB: só liga em produção', async () => {
  const dev = await boot({ SERVE_WEB: undefined, NODE_ENV: 'test' });
  assert.equal((await fetch(dev + '/privacy')).status, 404);
  const prod = await boot({ SERVE_WEB: undefined, NODE_ENV: 'production' });
  assert.equal((await fetch(prod + '/privacy')).status, 200);
});

test('SERVE_WEB=1 sem build: segue só com a API (não derruba o servidor)', async () => {
  const vazio = fs.mkdtempSync(path.join(os.tmpdir(), 'saude-vazio-'));
  const aviso = console.warn;
  let avisou = '';
  console.warn = (m) => { avisou += m; };
  try {
    const base = await boot({ SERVE_WEB: '1', WEB_DIST: vazio });
    assert.equal((await fetch(base + '/privacy')).status, 404);
    assert.equal((await fetch(base + '/auth/me')).status, 401, 'cai no modo legado');
    assert.match(avisou, /build:web/);
  } finally {
    console.warn = aviso;
    fs.rmSync(vazio, { recursive: true, force: true });
  }
});
