/**
 * CONCORRÊNCIA — duplo clique em "Agendar" não pode duplicar a vaga.
 *
 * POST /me/appointments validava e depois inseria em duas round-trips
 * separadas, sem transação e sem lock. Dois cliques (ou duas abas, ou um
 * retry depois de um 502) faziam os dois passarem na validação — ela lê os
 * intervalos ocupados, decide "livre" e devolve — e os dois inserirem.
 *
 * Não há constraint única em (professional_id, scheduled_at) que impeça:
 * `schema.sql` só tem PRIMARY KEY no id.
 *
 * Antes da correção, a PRIMEIRA rodada já respondia 201 e 201.
 *
 * POR QUE ESTE ARQUIVO ESTÁ EM test/race/ E NÃO EM test/
 * Ele precisa de conexões MySQL REAIS em simultaneidade: um dublê com
 * conexão única não reproduz nada, e o pool do mysql2 segura o processo
 * aberto no teardown quando há transação em voo. Roda separado:
 *
 *     npm run test:race
 *
 * Os demais testes (npm test) não tocam nesse caminho.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const SERVER = path.resolve(__dirname, '..', '..');
const { rewriteSchemaForDb } = require('../../../scripts/db-setup');

require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });
const mysql = require(require.resolve('mysql2/promise', { paths: [SERVER] }));
const bcrypt = require(require.resolve('bcryptjs', { paths: [SERVER] }));
const jwt = require(require.resolve('jsonwebtoken', { paths: [SERVER] }));

const DB = `saude_race_${process.pid}`;
const CFG = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  charset: 'utf8mb4',
};

// 12 rodadas dão chance real ao agendador de intercalar as duas validações.
const RODADAS = Number(process.env.RACE_RODADAS) || 12;

// Conexões PRÓPRIAS, sem pool: o pool.end() do mysql2 bloqueia quando há
// transação em voo e o processo nunca encerra.
//
// `criadas` guarda SÓ as conexões que o app retirou — é o que o teste de
// release acompanha. As conexões de setup do próprio teste vão por
// `aberta` e são fechadas no teardown.
const criadas = new Set();
const abertas = new Set();

function novaConexao(comBanco) {
  return mysql
    .createConnection({
      ...CFG,
      database: comBanco ? DB : undefined,
      // dateStrings: true é obrigatório: o pool de produção usa e booking.js
      // depende disso — parseDateTime() só aceita string, então um Date cru
      // faria os intervalos ocupados serem silenciosamente ignorados.
      dateStrings: true,
      multipleStatements: true,
    })
    .then((c) => {
      abertas.add(c);
      return c;
    });
}

function soltar(c, doApp) {
  if (!c) return;
  abertas.delete(c);
  if (doApp) criadas.delete(c);
  c.end().catch(() => {});
}

let principal = null;
const appDb = {
  query: (...a) => principal.query(...a),
  getConnection: async () => {
    const c = await novaConexao(true);
    criadas.add(c);
    c.release = () => soltar(c, true);
    return c;
  },
  end: async () => {},
};

function pad(v) {
  return String(v).padStart(2, '0');
}

// Uma segunda-feira futura (weekday 1, 0-based) às 09:00.
function segundaFutura() {
  const d = new Date();
  d.setDate(d.getDate() + (((1 - d.getDay() + 7) % 7) || 7));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Cada rodada usa um horário próprio: repetir o mesmo slot deixaria as
// rodadas seguintes legítimamente ocupadas e o teste mediria validação
// sequencial, não concorrência.
function horaDaRodada(n) {
  const minutos = 9 * 60 + (n - 1) * 30;
  return `${pad(Math.floor(minutos / 60))}:${pad(minutos % 60)}`;
}

let app;
let server;
let base;
let ctx;

const rede = setTimeout(() => process.exit(process.exitCode ?? 0), 15000);
rede.unref();

test.before(async () => {
  const passo = (m) => { if (process.env.RACE_DEBUG) console.log('  [before]', m); };

  passo('criando banco descartável');
  const admin = await novaConexao(false);
  // Varredura do que sobrou de execuções anteriores.
  //
  // O teardown faz DROP, mas ele não roda se o processo morre (Ctrl+C, timeout
  // do runner) — e o `process.exit` de segurança do after pode cortar o DROP no
  // meio. Sem esta varredura, cada execução dessas deixa um `saude_race_<pid>`
  // para sempre: a máquina do aluno vai enchendo de lixo de teste sem nunca
  // ninguém reclamar, porque o teste "passa".
  const [sobras] = await admin.query(
    "SELECT schema_name AS n FROM information_schema.schemata WHERE schema_name LIKE 'saude\\_race\\_%'"
  );
  if (sobras.length) {
    passo(`limpando ${sobras.length} banco(s) de execuções anteriores`);
    for (const { n } of sobras) {
      await admin.query('DROP DATABASE IF EXISTS `' + n + '`').catch(() => {});
    }
  }
  await admin.query('DROP DATABASE IF EXISTS `' + DB + '`');
  await admin.query('CREATE DATABASE `' + DB + '` CHARACTER SET utf8mb4');
  soltar(admin);

  const c = await novaConexao(true);
  await c.query(rewriteSchemaForDb(fs.readFileSync(path.join(SERVER, 'schema.sql'), 'utf8'), DB));

  const unidade = crypto.randomUUID();
  const prof = crypto.randomUUID();
  await c.query('INSERT INTO health_units (id, name, type, neighborhood) VALUES (?,?,?,?)', [
    unidade, 'UBS Corrida', 'ubs', 'Centro',
  ]);
  await c.query('INSERT INTO professionals (id, name, job_title) VALUES (?,?,?)', [
    prof, 'Dra. Concorrência', 'Clínica Geral',
  ]);
  await c.query('INSERT INTO unit_offers (id, unit_id, kind, name, active) VALUES (?,?,?,?,1)', [
    crypto.randomUUID(), unidade, 'consulta', 'Clínica Geral',
  ]);
  await c.query(
    `INSERT INTO professional_offers (id, unit_id, professional_id, kind, name)
     VALUES (?,?,?,?,?)`,
    [crypto.randomUUID(), unidade, prof, 'consulta', 'Clínica Geral']
  );
  await c.query(
    `INSERT INTO work_schedules
       (id, professional_id, unit_id, weekday, start_time, end_time, slot_minutes, active)
     VALUES (?,?,?,?,?,?,?,1)`,
    [crypto.randomUUID(), prof, unidade, 1, '09:00:00', '16:00:00', 30] // 1 = segunda
  );

  const usuarios = [];
  for (let i = 0; i < 2; i += 1) {
    const id = crypto.randomUUID();
    await c.query(
      `INSERT INTO users (id, full_name, email, password_hash, role, account_status, priority)
       VALUES (?,?,?,?,?,?, 'idoso')`,
      [id, `Paciente ${i}`, `race+${i}@test.local`, await bcrypt.hash('senha12345', 4), 'paciente', 'ativo']
    );
    usuarios.push(
      jwt.sign(
        { id, email: `race+${i}@test.local`, role: 'paciente', admin_level: null, full_name: 'Paciente' },
        process.env.JWT_SECRET,
        { expiresIn: '10m' }
      )
    );
  }
  passo('arranjo pronto');

  principal = await novaConexao(true);
  const caminhoDb = require.resolve('../../src/db');
  require.cache[caminhoDb] = {
    id: caminhoDb, filename: caminhoDb, loaded: true, exports: appDb,
  };

  app = require('../../src/app');
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  ctx = { unidade, prof, data: segundaFutura(), usuarios, conn: c };
  passo('pronto: ' + base);
});

test.after(async () => {
  // O DROP vem PRIMEIRO, com o menor possível de coisa entre ele e a saída.
  // Depois ele só há a rede de segurança: se algum await travar, o processo
  // ainda encerra — unref() não impede o disparo, só não segura o event loop.
  const admin = await novaConexao(false);
  await admin.query('DROP DATABASE IF EXISTS `' + DB + '`').catch(() => {});
  soltar(admin);

  if (server) {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  criadas.clear();
  for (const c of abertas) c.end().catch(() => {});
  abertas.clear();
  principal = null;

  clearTimeout(rede);
});

function agendar(token, hora) {
  return fetch(`${base}/me/appointments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      specialty: 'Clínica Geral',
      location: 'UBS Corrida',
      unit_id: ctx.unidade,
      professional_id: ctx.prof,
      scheduled_at: `${ctx.data} ${hora}:00`,
    }),
  });
}

test('dois agendamentos simultâneos no mesmo horário: só um passa', async () => {
  for (let rodada = 1; rodada <= RODADAS; rodada += 1) {
    const hora = horaDaRodada(rodada);
    const [a, b] = await Promise.all([
      agendar(ctx.usuarios[0], hora),
      agendar(ctx.usuarios[1], hora),
    ]);
    const status = [a.status, b.status].sort();

    assert.deepEqual(
      status,
      [201, 409],
      `rodada ${rodada} (${hora}): esperava um 201 e um 409, veio ${status.join(' e ')}`
    );

    const [[row]] = await ctx.conn.query(
      `SELECT COUNT(*) AS n FROM appointments
        WHERE professional_id = ? AND scheduled_at = ? AND status <> 'cancelado'`,
      [ctx.prof, `${ctx.data} ${hora}:00`]
    );
    assert.equal(
      Number(row.n),
      1,
      `rodada ${rodada} (${hora}): DOIS agendamentos no mesmo horário — ${row.n} linhas`
    );
  }
});

test('nenhuma linha a mais e nenhuma conexão esquecida', async () => {
  const [[row]] = await ctx.conn.query(
    'SELECT COUNT(*) AS n FROM appointments WHERE professional_id = ?',
    [ctx.prof]
  );
  assert.equal(
    Number(row.n),
    RODADAS,
    `esperava ${RODADAS} agendamentos (um por rodada), veio ${row.n}`
  );
  // Toda transação tem que devolver a conexão ao app: uma esquecida segura o
  // lock do SELECT … FOR UPDATE e trava as rodadas seguintes.
  assert.equal(
    criadas.size,
    0,
    `${criadas.size} conexão(ões) do app ainda em aberto — algum caminho não chamou release()`
  );
});

test('a segunda tentativa no mesmo horário explica o conflito', async () => {
  const hora = horaDaRodada(RODADAS + 1);
  const primeiro = await agendar(ctx.usuarios[0], hora);
  assert.equal(primeiro.status, 201);

  const segundo = await agendar(ctx.usuarios[1], hora);
  assert.equal(segundo.status, 409);
  assert.match((await segundo.json()).error, /ocupado/i);
});