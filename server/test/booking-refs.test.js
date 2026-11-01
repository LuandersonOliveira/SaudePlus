/**
 * RFC-0001 / ADR-0007 (B1): `unit_id` e `professional_id` de agendamentos e exames
 * passam a ter chave estrangeira (ON DELETE SET NULL) e índice por unidade.
 *
 * Cobre as duas rotas até o mesmo estado:
 *   - instalação limpa: o schema.sql sozinho já traz as FKs;
 *   - banco antigo: a migrate:booking:refs adiciona (e só PARA, sem alterar nada, se houver órfãos,
 *     a menos que se peça --fix-orphans).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const { rewriteSchemaForDb } = require('../../scripts/db-setup');
const { FKS_ESPERADAS } = require('../../scripts/doctor');

require(require.resolve('dotenv', { paths: [path.join(ROOT, 'server')] })).config({ path: path.join(ROOT, 'server', '.env') });
const mysql = require(require.resolve('mysql2/promise', { paths: [path.join(ROOT, 'server')] }));

const DB_LIMPO = `saude_refs_limpo_${process.pid}`;
const DB_ANTIGO = `saude_refs_antigo_${process.pid}`;
const cfg = () => ({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  charset: 'utf8mb4',
});

async function criarBanco(nome) {
  const admin = await mysql.createConnection({ ...cfg(), multipleStatements: true });
  await admin.query('DROP DATABASE IF EXISTS `' + nome + '`');
  await admin.query('CREATE DATABASE `' + nome + '` CHARACTER SET utf8mb4');
  await admin.end();
  const conn = await mysql.createConnection({ ...cfg(), database: nome, multipleStatements: true });
  await conn.query(rewriteSchemaForDb(fs.readFileSync(path.join(ROOT, 'server', 'schema.sql'), 'utf8'), nome));
  return conn;
}

async function apagarBanco(nome) {
  const admin = await mysql.createConnection(cfg());
  await admin.query('DROP DATABASE IF EXISTS `' + nome + '`').catch(() => {});
  await admin.end().catch(() => {});
}

const migrar = (db, ...args) =>
  spawnSync(process.execPath, [path.join(ROOT, 'server', 'scripts', 'migrate-booking-refs.js'), ...args], {
    cwd: path.join(ROOT, 'server'),
    env: { ...process.env, DB_NAME: db },
    encoding: 'utf8',
  });

async function usuario(conn) {
  const id = crypto.randomUUID();
  await conn.query(
    "INSERT INTO users (id, full_name, email, password_hash, role) VALUES (?,?,?,?, 'paciente')",
    [id, 'Paciente Refs', `refs-${id}@test.local`, 'x'.repeat(60)]
  );
  return id;
}
const consulta = (conn, userId, unitId, profId) =>
  conn.query(
    `INSERT INTO appointments (id, user_id, specialty, location, unit_id, professional_id, scheduled_at)
     VALUES (?,?,?,?,?,?, '2026-12-01 08:00:00')`,
    [crypto.randomUUID(), userId, 'Clínica Geral', 'UBS', unitId, profId]
  );

let limpo;
let antigo;

test.before(async () => {
  limpo = await criarBanco(DB_LIMPO);
  antigo = await criarBanco(DB_ANTIGO);
});

test.after(async () => {
  if (limpo) await limpo.end().catch(() => {});
  if (antigo) await antigo.end().catch(() => {});
  await apagarBanco(DB_LIMPO);
  await apagarBanco(DB_ANTIGO);
});

// ---------------------------------------------------------------------------
// Instalação limpa
// ---------------------------------------------------------------------------

test('schema.sql sozinho cria as 4 FKs que o doctor espera, com SET NULL', async () => {
  const [rows] = await limpo.query(
    `SELECT table_name AS t, constraint_name AS c, delete_rule AS r
       FROM information_schema.referential_constraints WHERE constraint_schema = ?`,
    [DB_LIMPO]
  );
  const mapa = new Map(rows.map((r) => [`${r.t}.${r.c}`, r.r]));
  for (const [t, c] of FKS_ESPERADAS) {
    assert.equal(mapa.get(`${t}.${c}`), 'SET NULL', `${t}.${c} precisa existir com ON DELETE SET NULL`);
  }
});

test('schema.sql sozinho cria o índice (unit_id, scheduled_at) nas duas tabelas', async () => {
  for (const t of ['appointments', 'exams']) {
    const [rows] = await limpo.query(
      `SELECT column_name AS c FROM information_schema.statistics
        WHERE table_schema = ? AND table_name = ? AND index_name = ? ORDER BY seq_in_index`,
      [DB_LIMPO, t, `idx_${t}_unit_scheduled`]
    );
    assert.deepEqual(rows.map((r) => r.c), ['unit_id', 'scheduled_at'], `${t} sem o índice por unidade`);
  }
});

test('a checagem de FK volta ligada depois do schema.sql (não fica desligada na sessão do app)', async () => {
  // O schema desliga a checagem para declarar as FKs antes dos pais existirem. Se não religar,
  // a conexão que aplicou o schema seguiria aceitando órfãos.
  const [[{ v }]] = await limpo.query('SELECT @@FOREIGN_KEY_CHECKS v');
  assert.equal(Number(v), 1);
});

test('id de unidade ou de profissional inexistente é recusado', async () => {
  const u = await usuario(limpo);
  await assert.rejects(consulta(limpo, u, 'nao-existe', null), (e) => e.errno === 1452);
  await assert.rejects(consulta(limpo, u, null, 'nao-existe'), (e) => e.errno === 1452);
  await consulta(limpo, u, null, null); // vínculo vazio continua permitido
});

test('apagar a unidade ou o profissional preserva o atendimento e zera o vínculo', async () => {
  const u = await usuario(limpo);
  const unit = crypto.randomUUID();
  const prof = crypto.randomUUID();
  await limpo.query("INSERT INTO health_units (id, name, type) VALUES (?, 'UBS Temporária', 'ubs')", [unit]);
  await limpo.query("INSERT INTO professionals (id, name) VALUES (?, 'Dr. Temporário')", [prof]);
  await consulta(limpo, u, unit, prof);

  await limpo.query('DELETE FROM health_units WHERE id = ?', [unit]);
  await limpo.query('DELETE FROM professionals WHERE id = ?', [prof]);
  const [[row]] = await limpo.query('SELECT unit_id, professional_id, location FROM appointments WHERE user_id = ? AND specialty = ?', [u, 'Clínica Geral']);
  assert.equal(row.unit_id, null);
  assert.equal(row.professional_id, null);
  assert.equal(row.location, 'UBS', 'a "foto" textual do local continua');
});

// ---------------------------------------------------------------------------
// Banco antigo (sem as FKs) + migração
// ---------------------------------------------------------------------------

async function simularBancoAntigo() {
  for (const t of ['appointments', 'exams']) {
    for (const fk of [`fk_${t}_unit`, `fk_${t}_professional`]) await antigo.query(`ALTER TABLE ${t} DROP FOREIGN KEY ${fk}`);
    await antigo.query(`ALTER TABLE ${t} DROP INDEX idx_${t}_unit_scheduled`);
  }
}

test('migração: com órfãos ela PARA, lista e não altera nada', async () => {
  await simularBancoAntigo();
  const u = await usuario(antigo);
  const [[unit]] = await antigo.query('SELECT id FROM health_units LIMIT 1');
  await consulta(antigo, u, unit.id, null); // vínculo bom
  await consulta(antigo, u, 'unidade-fantasma', null); // órfão

  const r = migrar(DB_ANTIGO);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /appointments\.unit_id: 1 sem health_units/);
  const [[{ n }]] = await antigo.query("SELECT COUNT(*) n FROM appointments WHERE unit_id = 'unidade-fantasma'");
  assert.equal(Number(n), 1, 'sem --fix-orphans o dado não pode mudar');
  const [fks] = await antigo.query('SELECT 1 FROM information_schema.referential_constraints WHERE constraint_schema = ? AND constraint_name = ?', [DB_ANTIGO, 'fk_appointments_unit']);
  assert.equal(fks.length, 0, 'sem --fix-orphans nenhuma FK é criada');
});

test('migração: --fix-orphans zera só o órfão, cria índices e FKs', async () => {
  const r = migrar(DB_ANTIGO, '--fix-orphans');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /1 órfão\(s\) zerado\(s\)/);

  const [[{ bons }]] = await antigo.query('SELECT COUNT(*) bons FROM appointments WHERE unit_id IS NOT NULL');
  assert.equal(Number(bons), 1, 'o vínculo válido não pode ser tocado');
  const [rows] = await antigo.query(
    'SELECT table_name AS t, constraint_name AS c FROM information_schema.referential_constraints WHERE constraint_schema = ?',
    [DB_ANTIGO]
  );
  const tem = new Set(rows.map((x) => `${x.t}.${x.c}`));
  for (const [t, c] of FKS_ESPERADAS) assert.ok(tem.has(`${t}.${c}`), `faltou ${t}.${c}`);
});

test('migração é idempotente: rodar de novo não muda nada e não falha', async () => {
  const r = migrar(DB_ANTIGO);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /já existe/);
  assert.doesNotMatch(r.stdout, /\+ /, 'nada novo deveria ser criado');
});

test('migrate:all executa a nova migração por último', () => {
  const pkg = require('../package.json');
  assert.match(pkg.scripts['migrate:all'], /migrate:agenda && npm run migrate:booking:refs$/);
  assert.ok(pkg.scripts['migrate:booking:refs']);
});
