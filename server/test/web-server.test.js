/**
 * O front é HTML/JS/CSS puro servido por scripts/serve-web.js.
 * O teste mais importante deste arquivo NÃO é "a página abre": é que o
 * servidor NÃO expõe server/.env (que tem DB_PASSWORD, JWT_SECRET e
 * DATA_ENCRYPTION_KEY) nem server/backups/.
 *
 * Se alguém trocar o servidor por `serve`/`http-server` na raiz do
 * repositório, estes testes falham — e isso é o objetivo.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWebServer } = require('../../scripts/serve-web');

async function withServer(fn) {
  const server = createWebServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const PAGINAS = [
  '/index.html',
  '/auth.html',
  '/dashboard.html',
  '/admin.html',
  '/atendente.html',
  '/privacy.html',
];

const ASSETS = [
  '/assets/styles.css',
  '/assets/api.js',
  '/assets/ui.js',
  '/assets/fonts/inter-latin.woff2',
];

test('não expõe segredos nem arquivos de infraestrutura', async () => {
  await withServer(async (base) => {
    const proibidos = [
      '/server/.env',
      '/server/.env.example',
      '/server/package.json',
      '/server/schema.sql',
      '/server/src/app.js',
      '/server/scripts/seed-admin.js',
      '/.gitignore',
      '/package.json',
      '/README.md',
      '/docs/PSI.md',
      '/scripts/doctor.js',
    ];
    for (const p of proibidos) {
      const res = await fetch(base + p);
      assert.equal(res.status, 404, `${p} não deveria ser servido`);
    }
  });
});

test('entrega as seis páginas', async () => {
  await withServer(async (base) => {
    for (const p of PAGINAS) {
      const res = await fetch(base + p);
      assert.equal(res.status, 200, `${p} deveria dar 200`);
      const body = await res.text();
      assert.ok(body.includes('</html>'), `${p} deveria ser HTML completo`);
      assert.match(res.headers.get('content-type') || '', /text\/html/);
    }
  });
});

test('entrega os assets do design system', async () => {
  await withServer(async (base) => {
    for (const p of ASSETS) {
      const res = await fetch(base + p);
      assert.equal(res.status, 200, `${p} deveria dar 200`);
      assert.ok((await res.arrayBuffer()).byteLength > 0, `${p} não pode estar vazio`);
    }
  });
});

test('/ redireciona para /index.html', async () => {
  await withServer(async (base) => {
    const res = await fetch(base + '/', { redirect: 'manual' });
    assert.equal(res.status, 301);
    assert.equal(res.headers.get('location'), '/index.html');
  });
});

test('rejeita travessia de caminho', async () => {
  await withServer(async (base) => {
    const alvos = [
      '/assets/../../server/.env',
      '/assets/%2e%2e/%2e%2e/server/.env',
      '/./server/.env',
      '/index.html/../../server/.env',
    ];
    for (const p of alvos) {
      const res = await fetch(base + p, { redirect: 'manual' });
      assert.ok(res.status === 404 || res.status === 400, `${p} deveria dar 404/400, deu ${res.status}`);
      const body = await res.text();
      assert.ok(!body.includes('DB_PASSWORD'), `${p} vazou segredo`);
    }
  });
});

test('rota desconhecida devolve 404 em JSON', async () => {
  await withServer(async (base) => {
    const res = await fetch(base + '/inexistente.html');
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type') || '', /application\/json/);
  });
});

test('cache: HTML e CSS revalidados, fonte imutável', async () => {
  await withServer(async (base) => {
    const html = await fetch(base + '/index.html');
    assert.match(html.headers.get('cache-control') || '', /no-cache/);

    const css = await fetch(base + '/assets/styles.css');
    assert.match(css.headers.get('cache-control') || '', /no-cache/);

    const font = await fetch(base + '/assets/fonts/inter-latin.woff2');
    assert.match(font.headers.get('cache-control') || '', /immutable/);
  });
});