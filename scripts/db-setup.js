#!/usr/bin/env node
/* ==========================================================================
   Saúde+ — bootstrap do banco, idempotente.

   Substitui o caminho manual do README (mysql < schema.sql seguido de cinco
   `npm run migrate:*`), que era fácil de fazer pela metade — e "pela metade"
   aqui é silencioso: sem migrate:interop o users.totp_enabled fica
   indefinido e o login nunca pede o segundo fator, sem erro em lugar nenhum.

   Uso:
     npm run db:setup                        cria/ajusta o banco e o admin
     npm run db:setup -- --fresh <dbname>    DESTRUTIVO: nomeia o banco a dropar

   Cada migration é idempotente, então rodar duas vezes não muda nada.
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(ROOT, 'server');

// Ordem importa. Cada entrada depende da anterior.
const MIGRATIONS = [
  'migrate-v3.js',
  'migrate-security.js',
  'migrate-privacy.js',
  'migrate-interop.js',
  'migrate-audit.js',
  'migrate-audit-details.js',
];

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

function migrationScripts() {
  return MIGRATIONS.slice();
}

/**
 * O nome do banco vai para DDL sem quoting externo (DROP/CREATE DATABASE).
 * Validar como identificador simples elimina a classe inteira de injeção —
 * um .env é entrada, mesmo local.
 */
function assertSafeDbName(name) {
  const n = String(name == null ? '' : name);
  if (!/^[A-Za-z0-9_]{1,64}$/.test(n)) {
    throw new Error(
      `DB_NAME inválido: ${JSON.stringify(name)}. Use apenas letras, dígitos e "_" (máx. 64).`
    );
  }
  return n;
}

function quoteIdent(name) {
  return '`' + assertSafeDbName(name) + '`';
}

/**
 * Junta o .env com o ambiente do processo — SEMPRE dando prioridade ao
 * ambiente, inclusive quando o valor é string vazia.
 *
 * Isto não é detalhe. A primeira versão usava dotenv.parse(), que lê só o
 * arquivo. Rodar com DB_NAME=saude_doctest no shell fez o script dropar o
 * `saude` do .env: o banco de desenvolvimento foi perdido, e os subprocessos
 * das migrations ainda enxergavam o nome antigo.
 */
function resolveConfig(envFile, processEnv) {
  const merged = Object.assign({}, envFile);
  for (const [k, v] of Object.entries(processEnv || {})) {
    if (v !== undefined) merged[k] = v;
  }
  merged.DB_NAME = assertSafeDbName(merged.DB_NAME || '');
  return merged;
}

/**
 * --fresh exige o nome do banco como argumento seguinte.
 *
 * Destruir um banco cujo nome ninguém digitou é um acidente esperando
 * acontecer: se o .env e o shell divergirem, o alvo implícito é o banco
 * errado. Exigir o nome torna o ato deliberado — e o nome digitado ainda é
 * conferido contra o DB_NAME em uso.
 */
function parseFreshArg(argv) {
  const i = argv.indexOf('--fresh');
  if (i === -1) return { fresh: false, target: null };
  const next = argv[i + 1];
  if (!next || next.startsWith('-')) {
    throw new Error(
      '--fresh exige o nome explícito do banco a destruir. ' +
        'Exemplo: node scripts/db-setup.js --fresh saude_doctest'
    );
  }
  return { fresh: true, target: assertSafeDbName(next) };
}

/**
 * schema.sql documenta `CREATE DATABASE IF NOT EXISTS saude` + `USE saude`
 * para funcionar com `mysql < schema.sql`. Aplicado num banco de nome
 * diferente, ele recria 'saude' e todas as tabelas vão para lá — as
 * migrations seguintes rodam contra um banco vazio e o bootstrap quebra.
 *
 * Aqui só esses dois pontos são reescritos. Qualquer outra menção a 'saude'
 * (e-mail @saude.app, comentário, nome de tabela) fica intacta.
 */
function rewriteSchemaForDb(schemaSql, dbName) {
  const target = assertSafeDbName(dbName);
  return String(schemaSql)
    .replace(/CREATE\s+DATABASE\s+IF\s+NOT\s+EXISTS\s+[`\w.]+/gi, 'CREATE DATABASE IF NOT EXISTS ' + target)
    .replace(/^\s*USE\s+[`\w.]+\s*;/gim, 'USE ' + target + ';');
}

function loadEnvFile() {
  const envPath = path.join(SERVER_DIR, '.env');
  if (!fs.existsSync(envPath)) {
    throw new Error('server/.env não existe. Rode: cd server && cp .env.example .env');
  }
  const dotenv = require(require.resolve('dotenv', { paths: [SERVER_DIR] }));
  return dotenv.parse(fs.readFileSync(envPath));
}

function childEnvFrom(cfg) {
  return Object.assign({}, process.env, {
    DB_HOST: cfg.DB_HOST || 'localhost',
    DB_PORT: String(cfg.DB_PORT || 3306),
    DB_USER: cfg.DB_USER || 'root',
    DB_PASSWORD: String(cfg.DB_PASSWORD || ''),
    DB_NAME: cfg.DB_NAME,
  });
}

function createAdminConnection(cfg) {
  const mysql = require(require.resolve('mysql2/promise', { paths: [SERVER_DIR] }));
  // Sem `database`: conectar direto permite criar o schema que ainda não existe.
  return mysql.createConnection({
    host: cfg.DB_HOST || 'localhost',
    port: Number(cfg.DB_PORT) || 3306,
    user: cfg.DB_USER || 'root',
    password: cfg.DB_PASSWORD || '',
    multipleStatements: true,
    charset: 'utf8mb4',
  });
}

/**
 * As migrations rodam em subprocesso e cada uma lê o .env por conta própria
 * (require('dotenv').config() NÃO sobrescreve o ambiente). Passar o env
 * resolvido é o que garante que pai e filhos apontem para o mesmo banco.
 */
function runMigration(script, cfg) {
  const file = path.join(SERVER_DIR, 'scripts', script);
  if (!fs.existsSync(file)) {
    throw new Error('migration ausente: server/scripts/' + script);
  }
  const res = spawnSync(process.execPath, [file], {
    cwd: SERVER_DIR,
    stdio: 'inherit',
    env: childEnvFrom(cfg),
  });
  if (res.status !== 0) {
    throw new Error('migration ' + script + ' falhou (exit ' + res.status + ')');
  }
}

async function main() {
  const { fresh, target } = parseFreshArg(process.argv.slice(2));

  console.log(BOLD + 'Saúde+ — bootstrap do banco' + RESET + '\n');

  const cfg = resolveConfig(loadEnvFile(), process.env);
  const dbName = cfg.DB_NAME;

  if (fresh && target !== dbName) {
    throw new Error(
      '--fresh foi pedido para "' + target + '" mas o banco configurado é "' + dbName + '". ' +
        'O alvo de --fresh precisa ser idêntico ao DB_NAME em uso — assim o banco ' +
        'que será destruído é sempre o que está configurado.'
    );
  }

  // let, não const: cada migration roda em subprocesso, então a conexão
  // é reaberta entre elas (a anterior é fechada antes).
  let conn = await createAdminConnection(cfg);
  try {
    if (fresh) {
      console.log(RED + BOLD + '--fresh: DROPA e recria o banco "' + dbName + '". Os dados serão perdidos.' + RESET);
      await conn.query('DROP DATABASE IF EXISTS ' + quoteIdent(dbName));
    }
    await conn.query(
      'CREATE DATABASE IF NOT EXISTS ' + quoteIdent(dbName) +
        ' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    console.log(GREEN + '[ok]' + RESET + ' banco ' + dbName + ' existe');

    console.log(DIM + 'Aplicando server/schema.sql…' + RESET);
    const schema = rewriteSchemaForDb(
      fs.readFileSync(path.join(SERVER_DIR, 'schema.sql'), 'utf8'),
      dbName
    );
    await conn.query(schema);
    console.log(GREEN + '[ok]' + RESET + ' schema.sql aplicado em ' + dbName);

    for (const script of migrationScripts()) {
      console.log(DIM + 'Migrando: ' + script + '…' + RESET);
      await conn.end().catch(() => {});
      runMigration(script, cfg);
      conn = await createAdminConnection(cfg);
      console.log(GREEN + '[ok]' + RESET + ' ' + script);
    }
  } finally {
    await conn.end().catch(() => {});
  }

  console.log(DIM + 'Criando o admin de ADMIN_EMAIL…' + RESET);
  const seed = spawnSync(
    process.execPath,
    [path.join(SERVER_DIR, 'scripts', 'seed-admin.js')],
    { cwd: SERVER_DIR, stdio: 'inherit', env: childEnvFrom(cfg) }
  );
  if (seed.status !== 0) throw new Error('seed-admin.js falhou');

  console.log('\n' + GREEN + BOLD + 'Pronto.' + RESET);
  console.log('  Banco:  ' + dbName);
  console.log('  Admin:  ' + cfg.ADMIN_EMAIL);
  console.log('\nPróximos passos:');
  console.log('  ' + DIM + '$ npm run dev' + RESET + '      API em :4000 e front em :8080');
  console.log('  ' + DIM + '$ npm run db:seed' + RESET + '   dados de demonstração (opcional)');
}

module.exports = {
  assertSafeDbName,
  quoteIdent,
  migrationScripts,
  resolveConfig,
  parseFreshArg,
  rewriteSchemaForDb,
  main,
};

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(RED + BOLD + 'Falha no bootstrap:' + RESET + ' ' + err.message);
      process.exit(1);
    });
}