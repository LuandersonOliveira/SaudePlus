/**
 * db-setup.js monta o banco do zero. A parte que executa SQL precisa do
 * MySQL; aqui testamos as decisões puras — o que o script aceita como nome
 * de banco e em que ordem ele aplica as migrations.
 *
 * A ordem importa: migrate:privacy depende de migrate:v3 (colunas de perfil),
 * e migrate:audit depende de migrate:security (refresh_tokens + audit_log).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertSafeDbName,
  migrationScripts,
  quoteIdent,
  resolveConfig,
  parseFreshArg,
  rewriteSchemaForDb,
} = require('../../scripts/db-setup');

// ---------------------------------------------------------------------------
// schema.sql traz "CREATE DATABASE IF NOT EXISTS saude" e "USE saude"
// hardcoded. Aplicado num banco de nome diferente, ele recriava 'saude' e as
// tabelas iam parar lá — as migrations seguintes rodavam contra um banco
// vazio. db-setup reescreve os dois pontos para o nome resolvido.
// ---------------------------------------------------------------------------

test('rewriteSchemaForDb troca o CREATE DATABASE e o USE para o alvo', () => {
  const sql = [
    'CREATE DATABASE IF NOT EXISTS saude CHARACTER SET utf8mb4;',
    'USE saude;',
    'CREATE TABLE IF NOT EXISTS users (id CHAR(36));',
  ].join('\n');
  const out = rewriteSchemaForDb(sql, 'saude_doctest');
  assert.match(out, /CREATE DATABASE IF NOT EXISTS saude_doctest[\s;]/);
  assert.match(out, /USE saude_doctest;/);
  assert.ok(!/USE saude;/.test(out), 'não pode sobrar USE do nome antigo');
  assert.match(out, /CREATE TABLE IF NOT EXISTS users/);
});

test('rewriteSchemaForDb não toca em menções a saude fora de CREATE/USE', () => {
  const sql = [
    "CREATE DATABASE IF NOT EXISTS saude;",
    "USE saude;",
    "INSERT INTO users (email) VALUES ('contato@saude.app');",
    "-- schema do Saúde+",
  ].join('\n');
  const out = rewriteSchemaForDb(sql, 'outro');
  assert.match(out, /contato@saude\.app/);
  assert.match(out, /-- schema do Saúde\+/);
});

test('rewriteSchemaForDb é idempotente', () => {
  const sql = 'CREATE DATABASE IF NOT EXISTS saude;\nUSE saude;';
  const uma = rewriteSchemaForDb(sql, 'x1');
  assert.equal(rewriteSchemaForDb(uma, 'x1'), uma);
});

test('rewriteSchemaForDb recusa nome inseguro antes de gerar SQL', () => {
  assert.throws(() => rewriteSchemaForDb('USE saude;', 'x; DROP DATABASE mysql'), /DB_NAME/);
});

test('o schema.sql real só tem um CREATE DATABASE e um USE, ambos reescrevíveis', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  const out = rewriteSchemaForDb(sql, 'saude_doctest');
  const creates = out.match(/CREATE DATABASE IF NOT EXISTS/gi) || [];
  const uses = out.match(/^\s*USE\s+\S+;/gim) || [];
  assert.equal(creates.length, 1, 'deveria haver exatamente um CREATE DATABASE');
  assert.equal(uses.length, 1, 'deveria haver exatamente um USE');
  assert.match(out, /CREATE DATABASE IF NOT EXISTS saude_doctest/i);
  assert.match(out, /USE\s+saude_doctest;/i);
});

test('assertSafeDbName aceita identificador MySQL legítimo', () => {
  assert.equal(assertSafeDbName('saude'), 'saude');
  assert.equal(assertSafeDbName('saude_test_2026'), 'saude_test_2026');
  assert.equal(assertSafeDbName('S2'), 'S2');
});

test('assertSafeDbName recusa tudo que não é identificador simples', () => {
  // Sem aspas no identificador, um nome de banco viraria injeção de SQL no
  // DROP/CREATE — e o script aceita --fresh.
  const maus = [
    'saude; DROP DATABASE mysql',
    'saude`',
    'saude db',
    "saude'",
    'saude"',
    'sau-de',
    'sau.de',
    '',
    null,
    undefined,
    'a'.repeat(65), // acima do limite de 64 caracteres do MySQL
  ];
  for (const nome of maus) {
    assert.throws(() => assertSafeDbName(nome), /DB_NAME/, `deveria recusar ${JSON.stringify(nome)}`);
  }
});

test('migrationScripts devolve exatamente o que o migrate:all executa, na mesma ordem', () => {
  // Esta lista NÃO pode ser escrita à mão. A versão anterior fixava 6 nomes
  // aqui e em db-setup.js; quando a Fase 5 adicionou migrate:mfa:replay e
  // migrate:booking:duration, o migrate:all cresceu e as duas listas fixas
  // ficaram para trás — `npm run db:setup` imprimia "Pronto." sem criar as
  // colunas, e todo agendamento passava a dar 500. O teste fixo é o que deu
  // aparência de cobertura a um caminho que não conhecia as migrations novas.
  const scripts = migrationScripts();
  const pkg = require('../package.json');
  const esperada = (pkg.scripts['migrate:all'].match(/npm run (migrate:[\w:-]+)/g) || [])
    .map((n) => {
      const cmd = pkg.scripts[n.replace('npm run ', '')];
      return /node\s+(?:\.\/)?scripts\/([\w.-]+\.js)/.exec(cmd)[1];
    });

  assert.ok(esperada.length >= 6, 'o migrate:all deveria encadear todas as migrations');
  assert.deepEqual(
    scripts,
    esperada,
    'db-setup e migrate:all precisam executar exatamente as mesmas migrations, na mesma ordem'
  );

  const idx = (nome) => scripts.indexOf(nome);
  assert.ok(idx('migrate-v3.js') < idx('migrate-privacy.js'), 'privacy depende das colunas de v3');
  assert.ok(
    idx('migrate-v3.js') < idx('migrate-professional-user-link.js'),
    'o vínculo profissional↔atendente depende da tabela professionals criada em v3'
  );
  assert.ok(idx('migrate-professional-user-link.js') > -1, 'sem esta migration o atendente nunca é filtrado pela própria agenda');
  assert.ok(idx('migrate-security.js') < idx('migrate-audit.js'), 'audit depende de refresh_tokens');
  assert.ok(idx('migrate-interop.js') > -1, 'interop precisa existir - sem ele o MFA some em silêncio');
  // E as migrations da Fase 5, que era exatamente o que faltava.
  assert.ok(idx('migrate-mfa-replay.js') > -1, 'proteção de replay do TOTP precisa entrar no setup');
  assert.ok(idx('migrate-booking-duration.js') > -1, 'duration_minutes precisa entrar no setup');
});

test('todo script de migration listado existe no disco', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, '..', 'scripts');
  for (const s of migrationScripts()) {
    assert.ok(fs.existsSync(path.join(dir, s)), `${s} não existe em server/scripts/`);
  }
});

test('quoteIdent envolve em crases o que precisar', () => {
  assert.equal(quoteIdent('saude'), '`saude`');
  assert.equal(quoteIdent('saude_producao_2026'), '`saude_producao_2026`');
});

test('schema.sql existe e cria as tabelas-base', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  for (const t of ['users', 'appointments', 'exams', 'health_units', 'diseases', 'audit_log']) {
    assert.ok(
      new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`, 'i').test(sql),
      `schema.sql deveria criar ${t}`
    );
  }
});

// ---------------------------------------------------------------------------
// Regressão: o bootstrap usava dotenv.parse(), que lê SÓ o arquivo e ignora
// o ambiente. Com DB_NAME=saude_doctest no shell e DB_NAME=saude no .env, o
// script dropar o banco de desenvolvimento em vez do descartável. O nome do
// banco de destino tem de vir do ambiente quando ele existe.
// ---------------------------------------------------------------------------

test('resolveConfig deixa o ambiente vencer o .env', () => {
  const cfg = resolveConfig({ DB_NAME: 'saude', DB_HOST: 'localhost' }, { DB_NAME: 'saude_doctest' });
  assert.equal(cfg.DB_NAME, 'saude_doctest');
  assert.equal(cfg.DB_HOST, 'localhost');
});

test('resolveConfig usa o .env quando o ambiente não define nada', () => {
  const cfg = resolveConfig({ DB_NAME: 'saude', DB_HOST: 'localhost' }, {});
  assert.equal(cfg.DB_NAME, 'saude');
});

test('resolveConfig normaliza e valida o DB_NAME final', () => {
  assert.throws(() => resolveConfig({ DB_NAME: 'saude; DROP DATABASE mysql' }, {}), /DB_NAME/);
  assert.throws(() => resolveConfig({}, {}), /DB_NAME/);
});

test('o ambiente do processo sempre ganha, mesmo com string vazia', () => {
  // dotenv.parse() ignorava isto; um DB_HOST='' explícito precisa valer,
  // senão o processo tentaria conectar em 'localhost' sem querer.
  const cfg = resolveConfig({ DB_NAME: 'saude', DB_HOST: 'localhost' }, { DB_HOST: '' });
  assert.equal(cfg.DB_HOST, '');
  assert.equal(cfg.DB_NAME, 'saude');
});

test('parseFreshArg exige o nome explícito do banco a destruir', () => {
  assert.equal(parseFreshArg(['--fresh', 'saude_doctest']).fresh, true);
  assert.equal(parseFreshArg(['--fresh', 'saude_doctest']).target, 'saude_doctest');
  assert.equal(parseFreshArg([]).fresh, false);
  assert.equal(parseFreshArg([]).target, null);
});

test('parseFreshArg recusa --fresh sem nome — a causa raiz do acidente', () => {
  assert.throws(
    () => parseFreshArg(['--fresh']),
    /--fresh exige o nome explícito do banco/,
    'destruir banco sem dizer qual é a causa raiz do acidente'
  );
});

test('parseFreshArg recusa --fresh sem valor', () => {
  assert.throws(() => parseFreshArg(['--fresh']), /nome explícito/);
  assert.throws(() => parseFreshArg(['--fresh', '--outro']), /nome explícito/);
});