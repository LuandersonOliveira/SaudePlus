/**
 * RFC-0001 / ADR-0007 (B2): horário único por profissional, garantido no banco.
 *
 * active_slot = IF(status IN ('pendente','confirmado'), scheduled_at, NULL)
 * UNIQUE (professional_id, active_slot)
 *
 * Cobre o schema (instalação limpa), a regra de quais status ocupam horário, a
 * corrida entre conexões, a migração 0005 (duplicatas, idempotência) e a
 * tradução do erro do banco para 409 na API.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'server');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });
const mysql = require(require.resolve('mysql2/promise', { paths: [SERVER] }));
const jwt = require(require.resolve('jsonwebtoken', { paths: [SERVER] }));
const { rewriteSchemaForDb } = require('../../scripts/db-setup');
const { ehHorarioOcupado, MENSAGEM_HORARIO_OCUPADO } = require('../src/utils/dbErrors');

const DB = `saude_slot_${process.pid}`;
const DB_ANTIGO = `saude_slot_old_${process.pid}`;
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
  await conn.query(rewriteSchemaForDb(fs.readFileSync(path.join(SERVER, 'schema.sql'), 'utf8'), nome));
  return conn;
}
async function apagarBanco(nome) {
  const a = await mysql.createConnection(cfg());
  await a.query('DROP DATABASE IF EXISTS `' + nome + '`').catch(() => {});
  await a.end().catch(() => {});
}

let conn;
let user;
let prof;
let prof2;
let unit;

async function inserir(tabela, { profissional = prof, quando = '2027-03-01 08:00:00', status = 'pendente', c = conn } = {}) {
  const id = crypto.randomUUID();
  const col = tabela === 'appointments' ? 'specialty' : 'exam_type';
  await c.query(
    `INSERT INTO ${tabela} (id, user_id, ${col}, location, unit_id, professional_id, scheduled_at, status) VALUES (?,?,?,?,?,?,?,?)`,
    [id, user, 'Clínica Geral', 'UBS', unit, profissional, quando, status]
  );
  return id;
}
const slot = async (tabela, id) => (await conn.query(`SELECT active_slot FROM ${tabela} WHERE id = ?`, [id]))[0][0].active_slot;

test.before(async () => {
  conn = await criarBanco(DB);
  user = crypto.randomUUID();
  prof = crypto.randomUUID();
  prof2 = crypto.randomUUID();
  await conn.query("INSERT INTO users (id, full_name, email, password_hash, role) VALUES (?, 'Pac', ?, ?, 'paciente')", [user, `slot-${user}@test.local`, 'x'.repeat(60)]);
  await conn.query("INSERT INTO professionals (id, name) VALUES (?, 'Dr. A'), (?, 'Dr. B')", [prof, prof2]);
  const [unidades] = await conn.query('SELECT id FROM health_units LIMIT 1');
  unit = unidades[0].id;
});

test.after(async () => {
  if (conn) await conn.end().catch(() => {});
  await apagarBanco(DB);
  await apagarBanco(DB_ANTIGO);
});

for (const tabela of ['appointments', 'exams']) {
  test(`${tabela}: o schema.sql cria active_slot (STORED) e o UNIQUE (professional_id, active_slot)`, async () => {
    const [[col]] = await conn.query(
      `SELECT extra AS ex FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = 'active_slot'`,
      [DB, tabela]
    );
    assert.match(col.ex, /STORED GENERATED/i);
    const [idx] = await conn.query(
      `SELECT column_name c, non_unique nu FROM information_schema.statistics WHERE table_schema = ? AND table_name = ? AND index_name = ? ORDER BY seq_in_index`,
      [DB, tabela, `uq_${tabela}_prof_active_slot`]
    );
    assert.deepEqual(idx.map((r) => r.c), ['professional_id', 'active_slot']);
    assert.equal(Number(idx[0].nu), 0);
  });

  test(`${tabela}: dois ativos do mesmo profissional no mesmo instante são recusados pelo banco`, async () => {
    const quando = '2027-03-02 09:00:00';
    await inserir(tabela, { quando, status: 'pendente' });
    await assert.rejects(inserir(tabela, { quando, status: 'confirmado' }), (e) => ehHorarioOcupado(e));
    await assert.rejects(inserir(tabela, { quando, status: 'pendente' }), (e) => ehHorarioOcupado(e));
  });

  test(`${tabela}: cancelado, concluído e para_remarcar NÃO ocupam o horário`, async () => {
    const quando = '2027-03-03 09:00:00';
    for (const status of ['cancelado', 'concluido', 'para_remarcar']) {
      const id = await inserir(tabela, { quando, status });
      assert.equal(await slot(tabela, id), null, `${status} precisa ter active_slot NULL`);
    }
    const ativo = await inserir(tabela, { quando, status: 'pendente' }); // 3 inativos + 1 ativo convivem
    assert.ok(await slot(tabela, ativo));
  });

  test(`${tabela}: cancelar libera o horário; reativar sobre horário ocupado falha; reativar livre funciona`, async () => {
    const quando = '2027-03-04 09:00:00';
    const a = await inserir(tabela, { quando, status: 'confirmado' });
    await conn.query(`UPDATE ${tabela} SET status = 'cancelado' WHERE id = ?`, [a]);
    assert.equal(await slot(tabela, a), null);

    const b = await inserir(tabela, { quando, status: 'pendente' }); // remarcar para o horário liberado
    await assert.rejects(conn.query(`UPDATE ${tabela} SET status = 'confirmado' WHERE id = ?`, [a]), (e) => ehHorarioOcupado(e));
    await conn.query(`UPDATE ${tabela} SET status = 'cancelado' WHERE id = ?`, [b]);
    await conn.query(`UPDATE ${tabela} SET status = 'confirmado' WHERE id = ?`, [a]);
    assert.ok(await slot(tabela, a));
  });

  test(`${tabela}: remarcar (mudar scheduled_at) para horário ocupado é recusado`, async () => {
    const a = await inserir(tabela, { quando: '2027-03-05 09:00:00' });
    await inserir(tabela, { quando: '2027-03-05 10:00:00' });
    await assert.rejects(conn.query(`UPDATE ${tabela} SET scheduled_at = '2027-03-05 10:00:00' WHERE id = ?`, [a]), (e) => ehHorarioOcupado(e));
    await conn.query(`UPDATE ${tabela} SET scheduled_at = '2027-03-05 11:00:00' WHERE id = ?`, [a]);
  });

  test(`${tabela}: profissionais diferentes e registros sem profissional não se bloqueiam`, async () => {
    const quando = '2027-03-06 09:00:00';
    await inserir(tabela, { quando, profissional: prof });
    await inserir(tabela, { quando, profissional: prof2 });
    await inserir(tabela, { quando, profissional: null });
    await inserir(tabela, { quando, profissional: null }); // NULL não entra no UNIQUE (limite documentado)
  });

  test(`${tabela}: corrida — de 20 conexões no mesmo horário, exatamente 1 vence`, async () => {
    const quando = '2027-03-07 09:00:00';
    const conexoes = await Promise.all(Array.from({ length: 20 }, () => mysql.createConnection({ ...cfg(), database: DB })));
    try {
      const r = await Promise.allSettled(conexoes.map((c) => inserir(tabela, { quando, c })));
      assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
      assert.ok(r.filter((x) => x.status === 'rejected').every((x) => ehHorarioOcupado(x.reason)));
    } finally {
      await Promise.all(conexoes.map((c) => c.end().catch(() => {})));
    }
  });
}

test('apagar o profissional (SET NULL) não é bloqueado pelo UNIQUE e preserva o atendimento', async () => {
  const p = crypto.randomUUID();
  await conn.query("INSERT INTO professionals (id, name) VALUES (?, 'Temp')", [p]);
  const quando = '2027-03-08 09:00:00';
  const a = await inserir('appointments', { quando, profissional: p });
  const b = await inserir('appointments', { quando, profissional: null }); // outro sem profissional no mesmo horário
  await conn.query('DELETE FROM professionals WHERE id = ?', [p]);
  const [[row]] = await conn.query('SELECT professional_id FROM appointments WHERE id = ?', [a]);
  assert.equal(row.professional_id, null);
  assert.ok(b);
});

test('ehHorarioOcupado só reconhece o UNIQUE de horário', () => {
  assert.equal(ehHorarioOcupado({ code: 'ER_DUP_ENTRY', message: "Duplicate entry 'x-2027' for key 'appointments.uq_appointments_prof_active_slot'" }), true);
  assert.equal(ehHorarioOcupado({ code: 'ER_DUP_ENTRY', errno: 1062, message: "for key 'exams.uq_exams_prof_active_slot'" }), true);
  assert.equal(ehHorarioOcupado({ code: 'ER_DUP_ENTRY', message: "for key 'users.uq_users_cpf_hmac'" }), false);
  assert.equal(ehHorarioOcupado(new Error('outro')), false);
  assert.equal(ehHorarioOcupado(null), false);
});

// ---------------------------------------------------------------------------
// API: erro do banco vira 409 com a mesma mensagem do conflito detectado na aplicação
// ---------------------------------------------------------------------------

test('a API traduz a violação do UNIQUE em 409 "Horário já ocupado"', async () => {
  const pool = require('../src/db');
  const app = require('../src/app');
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const original = pool.query.bind(pool);
  pool.query = async () => {
    const e = new Error("Duplicate entry '1-2027-03-01 08:00:00' for key 'appointments.uq_appointments_prof_active_slot'");
    e.code = 'ER_DUP_ENTRY';
    e.errno = 1062;
    throw e;
  };
  try {
    const token = jwt.sign({ id: crypto.randomUUID(), email: 'x@test.local', role: 'paciente', admin_level: null, full_name: 'X' }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const res = await fetch(`http://127.0.0.1:${server.address().port}/me/appointments`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json();
    assert.equal(res.status, 409, JSON.stringify(body));
    assert.equal(body.error, MENSAGEM_HORARIO_OCUPADO);
  } finally {
    pool.query = original;
    await new Promise((r) => server.close(r));
    await pool.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Migração 0005
// ---------------------------------------------------------------------------

test('migração 0005: banco antigo com duplicata PARA sem alterar; resolvida, cria; idempotente', async (t) => {
  const old = await criarBanco(DB_ANTIGO);
  t.after(async () => { await old.end().catch(() => {}); });
  for (const tabela of ['appointments', 'exams']) {
    await old.query(`ALTER TABLE ${tabela} DROP INDEX uq_${tabela}_prof_active_slot, DROP COLUMN active_slot`);
  }
  const u = crypto.randomUUID();
  const p = crypto.randomUUID();
  await old.query("INSERT INTO users (id, full_name, email, password_hash, role) VALUES (?, 'Pac', ?, ?, 'paciente')", [u, `old-${u}@test.local`, 'x'.repeat(60)]);
  await old.query("INSERT INTO professionals (id, name) VALUES (?, 'Dr')", [p]);
  const ins = async (tabela, status) => {
    const id = crypto.randomUUID();
    const col = tabela === 'appointments' ? 'specialty' : 'exam_type';
    await old.query(`INSERT INTO ${tabela} (id, user_id, ${col}, location, professional_id, scheduled_at, status) VALUES (?,?,?,?,?,?,?)`,
      [id, u, 'CG', 'UBS', p, '2027-04-01 08:00:00', status]);
    return id;
  };
  const a1 = await ins('appointments', 'pendente');
  const a2 = await ins('appointments', 'confirmado'); // duplicata ativa
  await ins('appointments', 'cancelado'); // inativo não conta
  await ins('exams', 'pendente');

  const rodar = () => spawnSync(process.execPath, [path.join(SERVER, 'migrations', '0005_horario_unico.js')], {
    cwd: SERVER, env: { ...process.env, DB_NAME: DB_ANTIGO }, encoding: 'utf8',
  });
  const temColuna = async (tabela) => (await old.query("SELECT 1 FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = 'active_slot'", [DB_ANTIGO, tabela]))[0].length;

  const r1 = rodar();
  assert.equal(r1.status, 2, r1.stdout + r1.stderr);
  assert.match(r1.stderr, /appointments: 2 registros/);
  assert.ok(r1.stderr.includes(a1) && r1.stderr.includes(a2));
  assert.equal(await temColuna('appointments'), 0, 'com duplicata nada é alterado');
  assert.equal(await temColuna('exams'), 0);

  await old.query("UPDATE appointments SET status = 'cancelado' WHERE id = ?", [a2]); // decisão humana
  const r2 = rodar();
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(await temColuna('appointments'), 1);
  assert.equal(await temColuna('exams'), 1);
  const [[calc]] = await old.query('SELECT active_slot FROM appointments WHERE id = ?', [a1]);
  assert.ok(calc.active_slot, 'o valor gerado já vem calculado para as linhas existentes');

  const r3 = rodar();
  assert.equal(r3.status, 0, r3.stderr);
  assert.match(r3.stdout, /já existem/);
  assert.doesNotMatch(r3.stdout, /\+ /);
});
