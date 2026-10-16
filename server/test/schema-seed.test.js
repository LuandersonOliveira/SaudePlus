/**
 * Regressão: o seed de health_units no schema.sql usava `UUID()` como id.
 * Como a PK é o id e cada execução gerava um UUID novo, o INSERT IGNORE
 * nunca colidia e as 10 unidades de seed eram inseridas de novo a cada
 * `npm run db:setup`. Depois de três execuções o sistema tinha 30 unidades
 * de saúde, todas com o mesmo nome.
 *
 * Estes testes aplicam o schema num banco descartável de verdade e medem.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { rewriteSchemaForDb } = require('../../scripts/db-setup');

const ROOT = path.resolve(__dirname, '..', '..');
const dotenv = require(require.resolve('dotenv', { paths: [path.join(ROOT, 'server')] }));
dotenv.config({ path: path.join(ROOT, 'server', '.env') });

const mysql = require(require.resolve('mysql2/promise', { paths: [path.join(ROOT, 'server')] }));

// Banco exclusivo deste arquivo, com o PID para não colidir com outras execuções.
const TMP_DB = `saude_seedtest_${process.pid}`;

function connection(database) {
  return mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database,
    multipleStatements: true,
    charset: 'utf8mb4',
  });
}

const schemaSql = () =>
  rewriteSchemaForDb(fs.readFileSync(path.join(ROOT, 'server', 'schema.sql'), 'utf8'), TMP_DB);

// Cria uma vez e reaproveita entre os testes: cada teste mede uma aplicação.
let base;

test.before(async () => {
  const admin = await connection();
  await admin.query(`DROP DATABASE IF EXISTS \`${TMP_DB}\``);
  await admin.end();
  const conn = await connection();
  await conn.query(schemaSql()); // 1ª aplicação
  base = conn;
});

test.after(async () => {
  if (base) await base.end().catch(() => {});
  const admin = await connection();
  await admin.query(`DROP DATABASE IF EXISTS \`${TMP_DB}\``);
  await admin.end();
});

test('o seed cria 10 unidades de saúde', async () => {
  const [[{ n }]] = await base.query('SELECT COUNT(*) AS n FROM health_units');
  assert.equal(Number(n), 10);
});

test('reaplicar o schema NÃO duplica as unidades de seed', async () => {
  await base.query(schemaSql()); // 2ª aplicação
  await base.query(schemaSql()); // 3ª aplicação

  const [[{ n }]] = await base.query('SELECT COUNT(*) AS n FROM health_units');
  assert.equal(Number(n), 10, `esperado 10 unidades, veio ${n} — o seed não é idempotente`);

  const [dup] = await base.query(
    'SELECT name, COUNT(*) AS q FROM health_units GROUP BY name HAVING q > 1'
  );
  assert.deepEqual(dup, [], 'nenhum nome de unidade pode aparecer duplicado');
});

test('as unidades de seed mantêm o mesmo id entre aplicações', async () => {
  const [antes] = await base.query(
    "SELECT id, name FROM health_units WHERE name = 'CAPS Flor da Pedra'"
  );
  await base.query(schemaSql());
  const [depois] = await base.query(
    "SELECT id, name FROM health_units WHERE name = 'CAPS Flor da Pedra'"
  );
  assert.equal(depois.length, 1);
  assert.equal(antes[0].id, depois[0].id, 'o id precisa ser estável para o IGNORE colidir');
});