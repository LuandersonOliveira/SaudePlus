/**
 * GET /catalog/slots monta a grade de horários a partir de `work_schedules`,
 * filtrada só pelo par (profissional, unidade). Mas o POST que agenda valida
 * o vínculo em `professional_offers`. Um par que tem horário mas NÃO tem
 * oferta chegava até o catálogo, era exibido com nome de profissional vazio
 * (fallback `|| { name: '', job: '' }`) e só então era rejeitado com 409
 * "Este profissional não atende este serviço nesta unidade".
 *
 * Ou seja: a tela oferecia horários que, por construção, nunca_FUNCIONAVAM.
 *
 * O teste monta exatamente esse arranjo num banco descartável.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'server');
const { rewriteSchemaForDb } = require('../../scripts/db-setup');

require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });
const mysql = require(require.resolve('mysql2/promise', { paths: [SERVER] }));

const DB = `saude_slots_${process.pid}`;
const CFG = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  charset: 'utf8mb4',
};

let conn;
let findAvailabilityByService;
let validateBooking;
let pool;

// Uma data futura que caia numa segunda-feira (weekday 2), casando com o
// work_schedules registrado abaixo. Assim o teste não depende do dia em que roda.
// work_schedules.weekday é 0-based no padrão do JS: 0=domingo … 6=sábado.
// (admin.html gera o <option value="${i}"> a partir de WEEK.map, e
// booking.js consulta porWd[day.getDay()].) Segunda-feira = 1.
function amanhaNaSegundaFeira() {
  const d = new Date();
  const diff = ((1 - d.getDay() + 7) % 7) || 7;
  d.setDate(d.getDate() + diff);
  return d;
}

function pad(v) {
  return String(v).padStart(2, '0');
}

test.before(async () => {
  const admin = await mysql.createConnection({ ...CFG, multipleStatements: true });
  await admin.query('DROP DATABASE IF EXISTS `' + DB + '`');
  await admin.query('CREATE DATABASE `' + DB + '` CHARACTER SET utf8mb4');
  await admin.end();

  conn = await mysql.createConnection({ ...CFG, database: DB, multipleStatements: true });
  await conn.query(
    rewriteSchemaForDb(
      require('node:fs').readFileSync(path.join(SERVER, 'schema.sql'), 'utf8'),
      DB
    )
  );

  // booking.js recebe o pool por parâmetro — injetamos um adaptor sobre `conn`.
  pool = { query: (...a) => conn.query(...a), getConnection: async () => conn };

  const booking = require('../src/utils/booking');
  findAvailabilityByService = booking.findAvailabilityByService;
  validateBooking = booking.validateBooking;

// --- arranjo do bug real ------------------------------------------------
  // Duas unidades oferecem 'Clínica Geral'. Ana está vinculada ao serviço
  // APENAS na unidade A, mas tem work_schedule também na unidade B.
  //
  // O catálogo filtra a query de horários por `professional_id IN (...)`, que
  // já exclui quem não tem vínculo nenhum — mas NÃO pelo par
  // (profissional, unidade). Então o par (B, Ana) entra na grade sem existir
  // em professional_offers, e o POST desse slot é sempre 409.
  const unidadeA = crypto.randomUUID();
  const unidadeB = crypto.randomUUID();
  await conn.query(
    'INSERT INTO health_units (id, name, type, neighborhood) VALUES (?,?,?,?)',
    [unidadeA, 'UBS Unidade A', 'ubs', 'Centro']
  );
  await conn.query(
    'INSERT INTO health_units (id, name, type, neighborhood) VALUES (?,?,?,?)',
    [unidadeB, 'UBS Unidade B', 'ubs', 'Centro']
  );

  const ana = crypto.randomUUID();
  const zé = crypto.randomUUID();
  await conn.query('INSERT INTO professionals (id, name, job_title) VALUES (?,?,?)', [
    ana,
    'Ana Vinculada',
    'Clínica Geral',
  ]);
  await conn.query('INSERT INTO professionals (id, name, job_title) VALUES (?,?,?)', [
    zé,
    'Zé Sem Vínculo',
    'Cardiologia',
  ]);

  // Ambas as unidades oferecem o serviço…
  for (const u of [unidadeA, unidadeB]) {
    await conn.query(
      'INSERT INTO unit_offers (id, unit_id, kind, name, active) VALUES (?,?,?,?,1)',
      [crypto.randomUUID(), u, 'consulta', 'Clínica Geral']
    );
  }

  // …mas Ana só atende na unidade A. Zé não atende em lugar nenhum.
  await conn.query(
    `INSERT INTO professional_offers (id, unit_id, professional_id, kind, name)
     VALUES (?,?,?,?,?)`,
    [crypto.randomUUID(), unidadeA, ana, 'consulta', 'Clínica Geral']
  );

  const dia = amanhaNaSegundaFeira();
  const dataSql = `${dia.getFullYear()}-${pad(dia.getMonth() + 1)}-${pad(dia.getDate())}`;

  // Ana atende nos dois dias-sábados… quer dizer, nos dois lugares.
  for (const u of [unidadeA, unidadeB]) {
    await conn.query(
      `INSERT INTO work_schedules
         (id, professional_id, unit_id, weekday, start_time, end_time, slot_minutes, active)
       VALUES (?,?,?,?,?,?,?,1)`,
      [crypto.randomUUID(), ana, u, 1, '09:00:00', '12:00:00', 30] // 1 = segunda
    );
  }
  // Zé tem horário, mas nenhum vínculo: um bugWB different do par acima.
  await conn.query(
    `INSERT INTO work_schedules
       (id, professional_id, unit_id, weekday, start_time, end_time, slot_minutes, active)
     VALUES (?,?,?,?,?,?,?,1)`,
    [crypto.randomUUID(), zé, unidadeA, 1, '14:00:00', '16:00:00', 30]
  );
});

test.after(async () => {
  if (conn) await conn.end().catch(() => {});
  const admin = await mysql.createConnection(CFG);
  await admin.query('DROP DATABASE IF EXISTS `' + DB + '`').catch(() => {});
  await admin.end().catch(() => {});
});

async function slots() {
  const dia = amanhaNaSegundaFeira();
  const data = `${dia.getFullYear()}-${pad(dia.getMonth() + 1)}-${pad(dia.getDate())}`;
  return findAvailabilityByService(pool, {
    tipo: 'consulta',
    servico: 'Clínica Geral',
    unidadeIds: null,
    fromDate: data,
    days: 1,
  });
}

function todosOsSlots(r) {
  const out = [];
  for (const u of r.unidades || []) {
    for (const d of u.dias || []) {
      for (const s of d.slots || []) out.push({ unitId: u.id, unitName: u.name, ...s });
    }
  }
  return out;
}

test('o catálogo NÃO oferece o profissional que não tem professional_offers', async () => {
  const r = await slots();
  assert.ok(
    !JSON.stringify(todosOsSlots(r)).includes('Zé Sem Vínculo'),
    'o catálogo ofereceu um profissional sem vínculo com o serviço — o POST desse slot seria 409 garantido'
  );
});

test('o catálogo NÃO oferece a unidade onde o profissional NÃO está vinculado', async () => {
  // Este é o bug: Ana atende 'Clínica Geral' na unidade A. A unidade B também
  // oferece o serviço e Ana tem horário lá — mas não existe
  // professional_offers para o par (B, Ana). O catálogo oferecia mesmo assim,
  // e o POST devolvia 409 "Este serviço não está vinculado à unidade escolhida".
  const naB = todosOsSlots(await slots()).filter((s) => s.unitName === 'UBS Unidade B');
  assert.deepEqual(
    naB.map((s) => s.hora),
    [],
    'a unidade B não pode ter vaga de Ana: não existe professional_offers para esse par'
  );
});

test('a unidade onde o profissional ESTÁ vinculado continua aparecendo', async () => {
  const naA = todosOsSlots(await slots()).filter((s) => s.unitName === 'UBS Unidade A');
  assert.ok(naA.length > 0, 'a unidade A deveria continuar oferecendo as vagas de Ana');
  assert.ok(naA.every((s) => s.professional_name === 'Ana Vinculada'));
});

test('nenhum slot do catálogo vem com nome de profissional vazio', async () => {
  for (const s of todosOsSlots(await slots())) {
    assert.ok(s.professional_name, `slot ${s.hora} sem nome: ${JSON.stringify(s)}`);
  }
});

test('todo slot oferecido pelo catálogo é aceito por validateBooking', async () => {
  // Fecha a classe do bug: o que o catálogo mostra, o booking aceita.
  const dia = amanhaNaSegundaFeira();
  const data = `${dia.getFullYear()}-${pad(dia.getMonth() + 1)}-${pad(dia.getDate())}`;
  const offered = todosOsSlots(await slots());
  assert.ok(offered.length > 0, 'sem vaga nenhuma este teste passaria por vacuidade');

  for (const s of offered) {
    const erro = await validateBooking(pool, {
      tipo: 'consulta',
      professionalId: s.professional_id,
      unitId: s.unitId,
      serviceName: 'Clínica Geral',
      scheduledAt: `${data} ${s.hora}:00`,
    });
    assert.equal(
      erro,
      null,
      `o catálogo ofereceu ${s.hora} de ${s.professional_name} em ${s.unitName}, mas o booking rejeita: ${erro}`
    );
  }
});
