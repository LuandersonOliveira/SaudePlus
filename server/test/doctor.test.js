/**
 * Os checks do doctor que não tocam rede nem MySQL são funções puras e
 * são testados aqui. Os que tocam (mysql, banco, migrations, portas) são
 * verificados rodando `npm run doctor` contra o ambiente real.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  nodeOk,
  secretsProblems,
  escapingProblems,
  dpoWarning,
  parsePairs,
} = require('../../scripts/doctor');

test('nodeOk aceita >= 18 e rejeita abaixo', () => {
  assert.equal(nodeOk('v20.11.0'), true);
  assert.equal(nodeOk('v18.0.0'), true);
  assert.equal(nodeOk('v24.18.0'), true);
  assert.equal(nodeOk('v16.20.0'), false);
  assert.equal(nodeOk('v14.0.0'), false);
  assert.equal(nodeOk(''), false);
});

test('secretsProblems aceita o .env de desenvolvimento', () => {
  const env = {
    JWT_SECRET: 'a'.repeat(128),
    DATA_ENCRYPTION_KEY: 'f0'.repeat(32),
    ADMIN_PASSWORD: '123456789',
  };
  assert.deepEqual(secretsProblems(env), []);
});

test('secretsProblems aponta cada segredo fraco sem expor o valor', () => {
  const problemas = secretsProblems({
    JWT_SECRET: 'curto',
    DATA_ENCRYPTION_KEY: 'a'.repeat(63), // 63 em vez de 64
    ADMIN_PASSWORD: '123',
  });
  const nomes = problemas.map((p) => p.name);
  assert.ok(nomes.includes('JWT_SECRET'));
  assert.ok(nomes.includes('DATA_ENCRYPTION_KEY'));
  assert.ok(nomes.includes('ADMIN_PASSWORD'));
  for (const p of problemas) {
    // O detalhe pode dizer o comprimento, jamais o segredo.
    assert.ok(!p.detail.includes('curto'), 'o valor do segredo não pode aparecer no detalhe');
  }
});

test('secretsProblems aceita DATA_ENCRYPTION_KEY vazia em dev sem quebrar o setup', () => {
  // Chave vazia não impede o dev local (crypto degrada com warning), mas
  // precisa aparecer no relatório para não passar despercebida.
  const problemas = secretsProblems({ JWT_SECRET: 'b'.repeat(64), ADMIN_PASSWORD: 'senha1234' });
  assert.deepEqual(problemas.map((p) => p.name), ['DATA_ENCRYPTION_KEY']);
});

// Fixtures que espelham a forma real dos painéis: um bloco <script> com a
// definição de esc() e os botões que a chamam dentro de onclick=.
const ESC_BROKEN = `
  function esc(s) { return (s ?? '').toString().replace(/[&<>"]/g, c => MAP[c]); }
  <button onclick="showHistory('\${u.id}','\${esc(u.full_name)}')">Abrir histórico</button>
  <button onclick="viewUser('\${esc(u.id)}')">Abrir perfil</button>
`;

const ESC_FIXED = `
  const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function esc(s) { return (s ?? '').toString().replace(/[&<>"']/g, c => ESC_MAP[c]); }
  <button onclick="showHistory('\${u.id}','\${esc(u.full_name)}')">Abrir histórico</button>
  <button onclick="viewUser('\${esc(u.id)}')">Abrir perfil</button>
`;

test('escapingProblems acusa onclick com esc() sem escapar apóstrofo', () => {
  const achados = escapingProblems({ 'admin.html': ESC_BROKEN });
  assert.equal(achados.length, 1);
  assert.equal(achados[0].file, 'admin.html');
  assert.equal(achados[0].count, 2, 'conta as duas interpolações de esc()');
});

test('escapingProblems não acusa quando o esc já cobre o apóstrofo', () => {
  assert.deepEqual(escapingProblems({ 'admin.html': ESC_FIXED }), []);
});

test('escapingProblems avalia cada painel que usa esc() em onclick', () => {
  for (const file of ['admin.html', 'atendente.html', 'dashboard.html']) {
    assert.equal(escapingProblems({ [file]: ESC_BROKEN }).length, 1, `${file} deveria ser avaliado`);
  }
});

test('escapingProblems só avalia os arquivos de painel', () => {
  // index.html e privacy.html não têm o helper esc() — não acusar.
  assert.deepEqual(escapingProblems({ 'index.html': ESC_BROKEN }), []);
  assert.deepEqual(escapingProblems({ 'privacy.html': ESC_BROKEN }), []);
});

test('dpoWarning avisa quando o encarregado não está configurado', () => {
  assert.ok(dpoWarning({ DPO_NAME: '', DPO_EMAIL: '' }));
  assert.equal(dpoWarning({ DPO_NAME: 'Maria', DPO_EMAIL: 'dpo@saude.app' }), null);
});

test('parsePairs monta "ip|email" normalizado', () => {
  assert.equal(parsePairs('10.0.0.1', '  Admin@Saude.App '), '10.0.0.1|admin@saude.app');
  assert.equal(parsePairs('::1', undefined), '::1|');
});

test('npm run setup instala as dependências da RAIZ, não só as do server', () => {
  // Achado seguindo a verificação do README do zero, num clone limpo:
  // `npm run setup` rodava `npm --prefix server install` e nada mais. Mas
  // `npm run dev` usa `concurrently`, que é devDependency da RAIZ — então
  // num clone novo o setup terminava "com sucesso" e o dev morria com
  // "'concurrently' não é reconhecido". Instalar as duas árvores é o que faz
  // o caminho documentado (setup → doctor → dev) funcionar de verdade.
  const raiz = require('../../package.json');
  const setup = raiz.scripts.setup;
  assert.match(setup, /\bnpm install\b/, 'setup precisa instalar as deps da raiz');
  assert.match(setup, /--prefix server install/, 'setup precisa instalar as deps do server');
  assert.match(setup, /db:setup/, 'setup precisa criar o banco e rodar as migrations');
  // E o dev realmente depende do concurrently.
  assert.ok(
    (raiz.devDependencies && raiz.devDependencies.concurrently) || (raiz.dependencies && raiz.dependencies.concurrently),
    'o dev usa concurrently, então ele tem que estar declarado na raiz'
  );
});