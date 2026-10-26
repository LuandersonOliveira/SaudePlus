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
  COLUNAS_ESPERADAS,
  TABELAS_ESPERADAS,
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

test('toda coluna que o código referencia em migration está na lista do doctor', () => {
  // O doctor só ajuda se souber o que procurar. Quando a Fase 5 criou
  // `duration_minutes` e `totp_last_step`, a lista ficou para trás: numa base
  // sem elas, `npm run doctor` respondia "Ambiente pronto" e todo agendamento
  // devolvia 500. Este teste existe para a lista não voltar a ficar para trás.
  const esperadas = [
    ['users', 'totp_last_step'],
    ['appointments', 'duration_minutes'],
    ['exams', 'duration_minutes'],
    ['professionals', 'user_id'],
  ];
  for (const par of esperadas) {
    assert.ok(
      COLUNAS_ESPERADAS.some(([t, c]) => t === par[0] && c === par[1]),
      `doctor precisa verificar ${par[0]}.${par[1]}`
    );
  }
});

test('a lista do doctor bate com o que o schema.sql cria', () => {
  // Se o schema já traz a coluna, a lista serve de guarda para a migration;
  // se não trouxer nem uma nem outra, o caminho está errado.
  //
  // O bloco é lido até `) ENGINE`, e não até o primeiro `;`: um `;` dentro de
  // um comentário SQL é legal e trunca qualquer parser que divida por
  // ponto-e-vírgula. (Foi exatamente o que aconteceu com este teste antes.)
  const schema = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'schema.sql'),
    'utf8'
  );
  for (const [tabela, coluna] of COLUNAS_ESPERADAS) {
    const bloco = new RegExp(`CREATE TABLE[^;]*\\b${tabela}\\b[\\s\\S]*?\\) ENGINE`, 'i').exec(schema);
    assert.ok(bloco, `schema.sql deveria criar ${tabela}`);
    assert.match(
      bloco[0],
      new RegExp(`^\\s*${coluna}\\b`, 'm'),
      `schema.sql cria ${tabela} sem ${coluna}, mas o doctor exige que ela exista`
    );
  }
});

test('as tabelas esperadas são as que o código consulta', () => {
  for (const t of ['refresh_tokens', 'password_reset_tokens', 'audit_log', 'professionals', 'professional_offers', 'work_schedules', 'schedule_blocks']) {
    assert.ok(TABELAS_ESPERADAS.includes(t), `doctor deveria verificar a tabela ${t}`);
  }
});

test('o doctor confere o MESMO banco que o pool conectou', () => {
  // Achado ao validar o guard de colunas: o pool é criado por db.js, que lê
  // process.env — e dotenv.config() NÃO sobrescreve variável já existente.
  // A checagem usava env.DB_NAME, o valor do ARQUIVO. Com DB_NAME no ambiente,
  // o doctor conectava num banco e conferia outro, e ainda dizia "Ambiente
  // pronto" — que é o pior resultado possível para uma ferramenta de
  // diagnóstico. Precedência igual à do db-setup.js: ambiente vence o .env.
  const { configAlvo } = require('../../scripts/doctor');
  const original = process.env.DB_NAME;
  try {
    process.env.DB_NAME = 'saude_do_ambiente';
    const alvo = configAlvo({ DB_NAME: 'saude_do_arquivo' });
    assert.equal(alvo.DB_NAME, 'saude_do_ambiente');
  } finally {
    if (original === undefined) delete process.env.DB_NAME;
    else process.env.DB_NAME = original;
  }

  // Sem variável no ambiente, o arquivo manda.
  process.env.DB_NAME = 'saude_quebrada_temporaria';
  try {
    const limpo = (() => {
      const saved = process.env.DB_NAME;
      delete process.env.DB_NAME;
      const r = configAlvo({ DB_NAME: 'saude_do_arquivo' });
      process.env.DB_NAME = saved;
      return r;
    })();
    assert.equal(limpo.DB_NAME, 'saude_do_arquivo');
  } finally {
    if (original === undefined) delete process.env.DB_NAME;
    else process.env.DB_NAME = original;
  }

  // E sem nenhum dos dois, o padrão.
  assert.equal(configAlvo({}).DB_NAME, 'saude');
  assert.equal(configAlvo({}).DB_PORT, 3306);
});

test('o doctor percebe que o CORS não cobre a URL do front', () => {
  // Este é o defeito que travou o login: `serve-web.js` anunciava
  // http://127.0.0.1:8080, o .env liberava http://localhost:8080, e a API está
  // em localhost:4000. Abrir pelo host anunciado dava 403 em todo fetch —
  // que o navegador mostra como "Failed to fetch", sem nada no terminal.
  const { corsProblem } = require('../../scripts/doctor');

  // O caso real: front em localhost, CORS só em 127.
  const erro = corsProblem(
    { CORS_ORIGIN: 'http://127.0.0.1:8080' },
    { webHost: 'localhost', webPort: 8080 }
  );
  assert.ok(erro, 'divergência de host deveria ser detectada');
  assert.match(erro, /localhost:8080/, 'a mensagem precisa apontar a URL que falta');
  assert.match(erro, /Failed to fetch/, 'a mensagem precisa ligar a causa ao sintoma');

  // Configuração correta: passa.
  assert.equal(
    corsProblem({ CORS_ORIGIN: 'http://localhost:8080' }, { webHost: 'localhost', webPort: 8080 }),
    null
  );

  // Porta diferente também é divergência.
  assert.ok(corsProblem({ CORS_ORIGIN: 'http://localhost:8080' }, { webHost: 'localhost', webPort: 3000 }));

  // CORS vazio é problema.
  assert.match(corsProblem({ CORS_ORIGIN: '' }, {}), /vazio/);

  // Liberar origens extras também é sinal de configuração pela metade.
  const extras = corsProblem(
    { CORS_ORIGIN: 'http://localhost:8080,http://127.0.0.1:8080' },
    { webHost: 'localhost', webPort: 8080 }
  );
  assert.ok(extras && /127\.0\.0\.1:8080/.test(extras), 'origem extra deveria ser apontada');
});

test('serve-web anuncia a mesma origem que o CORS espera', () => {
  // Trava o acoplamento: se alguém voltar a anunciar 127.0.0.1, este teste
  // falha — porque o bug volta junto.
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'serve-web.js'), 'utf8');
  const m = /WEB_HOST\s*\|\|\s*'([^']+)'/.exec(src);
  assert.ok(m, 'serve-web deveria ter um host padrão explícito');
  assert.equal(m[1], 'localhost', "o host padrão precisa ser 'localhost' — é o que o CORS e a API esperam");

  const { corsProblem } = require('../../scripts/doctor');
  assert.equal(
    corsProblem({ CORS_ORIGIN: 'http://localhost:8080' }, { webHost: m[1], webPort: 8080 }),
    null,
    'o host padrão do front tem que satisfazer o CORS padrão'
  );
});

test('a URL que o front usa para a API é a mesma em todo o projeto', () => {
  // assets/api.js, README e serve-web têm que falar da mesma API, senão o
  // navegador chama uma porta e a outra ponta não responde.
  const fs = require('node:fs');
  const path = require('node:path');
  const raiz = path.join(__dirname, '..', '..');
  const api = fs.readFileSync(path.join(raiz, 'assets', 'api.js'), 'utf8');
  assert.match(api, /DEFAULT_BASE\s*=\s*'http:\/\/localhost:4000'/);

  const serve = fs.readFileSync(path.join(raiz, 'scripts', 'serve-web.js'), 'utf8');
  assert.match(serve, /localhost:4000/);
  assert.ok(
    !/127\.0\.0\.1:4000/.test(serve),
    'serve-web não deve anunciar 127.0.0.1 como se fosse a API'
  );
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