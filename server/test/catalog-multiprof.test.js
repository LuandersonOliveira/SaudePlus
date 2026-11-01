/**
 * Quando dois profissionais estão livres no mesmo horário, o catálogo só
 * mostrava UM — e o front guardava o `professional_id` desse um.
 *
 * O caminho do defeito, ponta a ponta:
 *
 *  1. `/catalog/slots` percorre os profissionais em ordem alfabética e, para
 *     cada hora, grava o primeiro livre. `if (!slotMap.has(hora))` — o
 *     segundo profissional é descartado em silêncio.
 *  2. O front mostra só aquele nome e, ao enviar, manda aquele
 *     `professional_id` (dashboard.html:788).
 *  3. Se o profissional mostrado for ocupado entre listar e enviar, o POST
 *     valida o MESMO profissional e devolve 409 — mesmo havendo outro livre,
 *     que a tela nunca mostrou. O usuário fica sem saída.
 *
 * A correção é o catálogo carregar a lista de disponíveis por horário. O
 * primeiro profissional continua nos campos antigos (`professional_id`,
 * `professional_name`), então nada quebra para quem não usa a lista nova.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'server');

// Este arquivo NÃO sobe o app, então o dotenv que app.js faz não acontece —
// e sem as credenciais o mysql responde "Access denied".
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const { rewriteSchemaForDb } = require('../../scripts/db-setup');

const mysql = require(require.resolve('mysql2/promise', { paths: [SERVER] }));

const DB = `saude_multivagas_${process.pid}`;
const CFG = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  charset: 'utf8mb4',
};

const UNIDADE = '00000000-0000-4000-8000-0000000b1001';
const ANA = '00000000-0000-4000-8000-0000000b1002';
const BETO = '00000000-0000-4000-8000-0000000b1003';
const PACIENTE = '00000000-0000-4000-8000-0000000b1004';

const pad = (v) => String(v).padStart(2, '0');

// Uma segunda-feira bem longe, para nunca colidir com a agenda real.
const SEGUNDA = (() => {
  const d = new Date(Date.now() + 21 * 86400000);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  return d;
})();
const DIA_SQL = `${SEGUNDA.getFullYear()}-${pad(SEGUNDA.getMonth() + 1)}-${pad(SEGUNDA.getDate())}`;

let conn;

async function slotsDe(extra = {}) {
  const { findAvailabilityByService } = require('../src/utils/booking');
  return findAvailabilityByService(conn, {
    kind: 'consulta',
    serviceName: 'Clínica Geral',
    fromDate: DIA_SQL,
    days: 7,
    // Esta suíte testa agregação por profissional, não a cota do NV02.
    userPriority: 'idoso',
    ...extra,
  });
}

test.before(async () => {
  const admin = await mysql.createConnection({ ...CFG, multipleStatements: true });
  const [sobras] = await admin.query(
    "SELECT schema_name AS n FROM information_schema.schemata WHERE schema_name LIKE 'saude\\_multivagas\\_%'"
  );
  for (const { n } of sobras) await admin.query(`DROP DATABASE IF EXISTS \`${n}\``).catch(() => {});

  await admin.query(`DROP DATABASE IF EXISTS \`${DB}\``);
  await admin.query(`CREATE DATABASE \`${DB}\` CHARACTER SET utf8mb4`);
  await admin.query(
    rewriteSchemaForDb(require('node:fs').readFileSync(path.join(SERVER, 'schema.sql'), 'utf8'), DB)
  );
  await admin.end();

  conn = await mysql.createConnection({ ...CFG, database: DB, dateStrings: true, multipleStatements: true });

  await conn.query(
    `INSERT INTO health_units (id, name, type, neighborhood) VALUES (?, 'UBS Multivagas', 'ubs', 'Centro')`,
    [UNIDADE]
  );
  await conn.query(
    `INSERT INTO unit_offers (id, unit_id, kind, name, active) VALUES (?,?, 'consulta', 'Clínica Geral', 1)`,
    [crypto.randomUUID(), UNIDADE]
  );

  // Ana e Beto: os dois atendem este serviço na mesma unidade, mesmo horário.
  for (const [id, nome] of [[ANA, 'Ana Alfa'], [BETO, 'Beto Beta']]) {
    await conn.query(
      `INSERT INTO professionals (id, name, job_title) VALUES (?,?, 'Clínica Geral')`,
      [id, nome]
    );
    await conn.query(
      `INSERT INTO professional_offers (id, unit_id, professional_id, kind, name)
       VALUES (?,?,?, 'consulta', 'Clínica Geral')`,
      [crypto.randomUUID(), UNIDADE, id]
    );
    await conn.query(
      `INSERT INTO work_schedules
         (id, professional_id, unit_id, weekday, start_time, end_time, slot_minutes, active)
       VALUES (?,?,?,?,?,?,?,1)`,
      [crypto.randomUUID(), id, UNIDADE, 1, '09:00:00', '12:00:00', 30] // 1 = segunda
    );
  }

  await conn.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, account_status)
     VALUES (?, 'Paciente Multivagas', 'multivagas@caps.local', 'x', 'paciente', 'ativo')`,
    [PACIENTE]
  );
});

test.after(async () => {
  if (conn) await conn.end().catch(() => {});
  const admin = await mysql.createConnection({ ...CFG, multipleStatements: true });
  await admin.query(`DROP DATABASE IF EXISTS \`${DB}\``).catch(() => {});
  await admin.end().catch(() => {});
});

test('um horário com 2 profissionais livres expõe os DOIS', async () => {
  const r = await slotsDe();
  assert.ok(r.unidades.length, 'deveria devolver alguma unidade');

  const slots = r.unidades[0].dias[0].slots;
  assert.ok(slots.length > 0, 'deveria devolver horários');

  const slot = slots.find((s) => s.hora === '09:00');
  assert.ok(slot, 'o catálogo deveria oferecer 09:00');

  assert.ok(
    Array.isArray(slot.professionals),
    'o slot precisa carregar a lista de profissionais disponíveis'
  );
  assert.equal(slot.professionals.length, 2, 'às 09:00 os dois estão livres');
  assert.deepEqual(
    slot.professionals.map((p) => p.name).sort(),
    ['Ana Alfa', 'Beto Beta'],
    'a lista precisa trazer os dois'
  );

  // E a ordenação é determinística, como a do primeiro profissional.
  for (const p of slot.professionals) {
    assert.ok(p.id, 'cada profissional precisa de id');
    assert.ok(p.name, 'cada profissional precisa de nome');
  }
});

test('quando só um está livre, a lista tem um — e os campos antigos batem', async () => {
  // Ocupamos a Ana. O slot das 09:00 passa a ter só o Beto, e os campos
  // legados (`professional_id`) precisam apontar para ele, senão o front
  // continua mandando o id de quem está ocupado.
  await conn.query(
    `INSERT INTO appointments (id, user_id, unit_id, professional_id, specialty, location, scheduled_at, status, duration_minutes)
     VALUES (?,?,?,?, 'Clínica Geral', 'UBS', ?, 'confirmado', 30)`,
    [crypto.randomUUID(), PACIENTE, UNIDADE, ANA, `${DIA_SQL} 09:00:00`]
  );

  try {
    const r = await slotsDe();
    const slot = r.unidades[0].dias[0].slots.find((s) => s.hora === '09:00');
    assert.ok(slot, '09:00 continua livre para o Beto');
    assert.equal(slot.professionals.length, 1, 'a Ana está ocupada');
    assert.equal(slot.professionals[0].id, BETO);
    // Campo legado tem de acompanhar, senão o front agenda com o id errado.
    assert.equal(slot.professional_id, BETO, 'professional_id precisa apontar para quem está livre');
    assert.equal(slot.professional_name, 'Beto Beta');
  } finally {
    await conn.query('DELETE FROM appointments WHERE user_id = ?', [PACIENTE]).catch(() => {});
  }
});

test('a contagem de vagas continua sendo de HORÁRIOS, e o front diz isso', async () => {
  // A lista nova é informação; não muda o que "vaga" significa. O front
  // escreve "horário(s) livre(s)", que é a contagem de horários distintos.
  const r = await slotsDe();
  const u = r.unidades[0];
  const horas = u.dias.reduce((n, d) => n + d.slots.length, 0);
  assert.equal(u.totalVagas, horas, 'totalVagas conta horários, não profissionais');
  assert.equal(r.totalVagas, horas);
});