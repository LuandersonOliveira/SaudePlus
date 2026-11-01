/**
 * Runner de migrations numeradas (A3 / ADR-0008): ordem, registro em
 * schema_migrations, parada na falha, checksum e a instalação limpa de ponta a ponta.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'server');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });
const mysql = require(require.resolve('mysql2/promise', { paths: [SERVER] }));
const { rewriteSchemaForDb } = require('../../scripts/db-setup');
const { listarMigrations, migrar, status, MIGRATIONS_DIR } = require('../scripts/migrate');

const DB = `saude_runner_${process.pid}`;
const cfg = () => ({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  charset: 'utf8mb4',
});
const mudo = () => {};

let conn;
const tmpDirs = [];
const dirComArquivos = (arquivos) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  tmpDirs.push(dir);
  for (const [nome, corpo] of Object.entries(arquivos)) fs.writeFileSync(path.join(dir, nome), corpo);
  return dir;
};
const limparRegistro = () => conn.query('DELETE FROM schema_migrations').catch(() => {});

test.before(async () => {
  const admin = await mysql.createConnection({ ...cfg(), multipleStatements: true });
  await admin.query('DROP DATABASE IF EXISTS `' + DB + '`');
  await admin.query('CREATE DATABASE `' + DB + '` CHARACTER SET utf8mb4');
  await admin.end();
  conn = await mysql.createConnection({ ...cfg(), database: DB, multipleStatements: true });
  await conn.query(rewriteSchemaForDb(fs.readFileSync(path.join(SERVER, 'schema.sql'), 'utf8'), DB));
});

test.after(async () => {
  if (conn) await conn.end().catch(() => {});
  const a = await mysql.createConnection(cfg());
  await a.query('DROP DATABASE IF EXISTS `' + DB + '`').catch(() => {});
  await a.end().catch(() => {});
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

test('listarMigrations ordena pelo número e calcula checksum', () => {
  const dir = dirComArquivos({ '0002_b.js': '// b', '0001_a.js': '// a', 'leia-me.txt': 'x' });
  const lista = listarMigrations(dir);
  assert.deepEqual(lista.map((m) => m.file), ['0001_a.js', '0002_b.js']);
  assert.match(lista[0].checksum, /^[0-9a-f]{64}$/);
  assert.notEqual(lista[0].checksum, lista[1].checksum);
});

test('listarMigrations recusa nome fora do padrão e número repetido', () => {
  assert.throws(() => listarMigrations(dirComArquivos({ 'sem-numero.js': '' })), /fora do padrão/);
  assert.throws(() => listarMigrations(dirComArquivos({ '0001_a.js': '', '0001_b.js': '' })), /repetido/);
});

test('aplica em ordem, registra e não reaplica', async () => {
  await limparRegistro();
  const marca = path.join(os.tmpdir(), `marca-${process.pid}.txt`);
  fs.rmSync(marca, { force: true });
  const dir = dirComArquivos({
    '0001_a.js': `require('fs').appendFileSync(${JSON.stringify(marca)}, 'A');`,
    '0002_b.js': `require('fs').appendFileSync(${JSON.stringify(marca)}, 'B');`,
  });
  const r1 = await migrar(conn, { dir, log: mudo });
  assert.deepEqual(r1.aplicadas, ['0001_a.js', '0002_b.js']);
  assert.equal(fs.readFileSync(marca, 'utf8'), 'AB', 'ordem numérica');

  const r2 = await migrar(conn, { dir, log: mudo });
  assert.deepEqual(r2.aplicadas, []);
  assert.equal(r2.jaAplicadas, 2);
  assert.equal(fs.readFileSync(marca, 'utf8'), 'AB', 'segunda execução não roda nada');

  const st = await status(conn, { dir });
  assert.deepEqual(st.map((s) => s.aplicada), [true, true]);
  fs.rmSync(marca, { force: true });
});

test('falha (exit != 0) interrompe, não registra e deixa as seguintes pendentes', async () => {
  await limparRegistro();
  const marca = path.join(os.tmpdir(), `marca-f-${process.pid}.txt`);
  fs.rmSync(marca, { force: true });
  const dir = dirComArquivos({
    '0001_ok.js': '// ok',
    '0002_para.js': 'process.exit(2)', // ex.: 0002_cpf_hmac com CPF duplicado
    '0003_depois.js': `require('fs').writeFileSync(${JSON.stringify(marca)}, 'rodou');`,
  });
  await assert.rejects(migrar(conn, { dir, log: mudo }), /0002_para\.js falhou \(exit 2\)/);
  const [reg] = await conn.query('SELECT version FROM schema_migrations ORDER BY version');
  assert.deepEqual(reg.map((r) => r.version), ['0001'], 'só a que terminou bem é registrada');
  assert.equal(fs.existsSync(marca), false, 'a 0003 não pode rodar depois de uma falha');

  // Corrigida a causa, a próxima execução retoma da que parou.
  fs.writeFileSync(path.join(dir, '0002_para.js'), '// corrigida');
  const r = await migrar(conn, { dir, log: mudo });
  assert.deepEqual(r.aplicadas, ['0002_para.js', '0003_depois.js']);
  fs.rmSync(marca, { force: true });
});

test('migration editada depois de aplicada gera aviso e não é reaplicada', async () => {
  await limparRegistro();
  const dir = dirComArquivos({ '0001_a.js': '// versão 1' });
  await migrar(conn, { dir, log: mudo });
  fs.writeFileSync(path.join(dir, '0001_a.js'), '// versão 2 (editada)');
  const avisos = [];
  const r = await migrar(conn, { dir, log: (m) => avisos.push(m) });
  assert.deepEqual(r.alteradas, ['0001_a.js']);
  assert.deepEqual(r.aplicadas, []);
  assert.ok(avisos.some((m) => /editada depois de aplicada/.test(m)));
});

test('instalação limpa: as migrations reais rodam sobre o schema.sql e ficam registradas', async () => {
  await limparRegistro();
  const reais = listarMigrations(MIGRATIONS_DIR);
  assert.ok(reais.length >= 4);

  const dbAntes = process.env.DB_NAME;
  process.env.DB_NAME = DB; // os scripts herdam o ambiente do runner
  try {
    const r1 = await migrar(conn, { log: mudo });
    assert.equal(r1.aplicadas.length, reais.length);
    const r2 = await migrar(conn, { log: mudo });
    assert.equal(r2.aplicadas.length, 0, 'idempotente: nada a fazer na segunda vez');
  } finally {
    if (dbAntes === undefined) delete process.env.DB_NAME;
    else process.env.DB_NAME = dbAntes;
  }
  const [reg] = await conn.query('SELECT version, name FROM schema_migrations ORDER BY version');
  assert.deepEqual(reg.map((r) => r.version), reais.map((m) => m.version));
});

test('o diretório de migrations só tem arquivos no padrão e começa pela 0001', () => {
  const lista = listarMigrations(MIGRATIONS_DIR);
  assert.equal(lista[0].version, '0001');
  lista.forEach((m, i) => assert.equal(Number(m.version), i + 1, 'numeração sem buracos'));
});
