/* ==========================================================================
   Saúde+ — dados de demonstração da "agenda inteligente" (Fase 0)

   Popula: serviços por unidade, profissionais, vínculos profissional×serviço,
   horários semanais e 3 agendamentos já ocupados (para demonstrar CONFLITO).

   Uso:
     npm run seed:demo            # insere (idempotente, seguro repetir)
     npm run seed:demo -- --reset  # apaga os dados demo e reinsere

   Notas:
   - Unidades do CNES vêm em CAIXA ALTA e SEM acento; a resolução abaixo
     ignora acento/caixa para não depender de como o banco foi importado.
   - Idempotente via INSERT IGNORE e checagem prévia de agendamentos.
   - Agendamentos demo levam notes='[seed-demo]' para o --reset limpar.
   ========================================================================== */
require('dotenv').config();
const crypto = require('crypto');
const pool = require('../src/db');

const norm = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const UNITS = [
  {
    want: 'posto de saude da familia boa esperanca',
    offers: [
      { kind: 'consulta', name: 'Clínica Geral' },
      { kind: 'consulta', name: 'Cardiologia' },
      { kind: 'exame', name: 'Hemograma' },
      { kind: 'exame', name: 'Ultrassonografia' },
    ],
  },
  {
    want: 'posto de saude da familia moinho',
    offers: [
      { kind: 'consulta', name: 'Clínica Geral' },
      { kind: 'consulta', name: 'Pediatria' },
      { kind: 'exame', name: 'Hemograma' },
    ],
  },
  {
    want: 'caps flor da pedra',
    offers: [
      { kind: 'consulta', name: 'Saúde Mental' },
      { kind: 'consulta', name: 'Psicologia' },
    ],
  },
  {
    want: 'policlinica saude sao sebastiao',
    offers: [
      { kind: 'consulta', name: 'Cardiologia' },
      { kind: 'consulta', name: 'Ortopedia' },
      { kind: 'exame', name: 'Raio-X' },
      { kind: 'exame', name: 'Eletrocardiograma' },
    ],
  },
];

const PROFESSIONALS = [
  {
    name: 'Dra. Maria da Silva', job_title: 'Médica', registry: 'CRM 12345-PE',
    offers: [
      { unit: 'posto de saude da familia boa esperanca', kind: 'consulta', name: 'Clínica Geral' },
      { unit: 'posto de saude da familia boa esperanca', kind: 'consulta', name: 'Cardiologia' },
      { unit: 'posto de saude da familia moinho', kind: 'consulta', name: 'Clínica Geral' },
    ],
    schedules: [
      { unit: 'posto de saude da familia boa esperanca', weekday: 1, start: '08:00', end: '12:00', slot: 30 },
      { unit: 'posto de saude da familia boa esperanca', weekday: 3, start: '08:00', end: '12:00', slot: 30 },
      { unit: 'posto de saude da familia boa esperanca', weekday: 5, start: '13:00', end: '17:00', slot: 30 },
      { unit: 'posto de saude da familia moinho', weekday: 2, start: '08:00', end: '12:00', slot: 30 },
    ],
  },
  {
    name: 'Téc. João Souza', job_title: 'Técnico de Enfermagem', registry: 'COREN 67890',
    offers: [
      { unit: 'posto de saude da familia boa esperanca', kind: 'exame', name: 'Hemograma' },
      { unit: 'posto de saude da familia moinho', kind: 'exame', name: 'Hemograma' },
    ],
    schedules: [
      { unit: 'posto de saude da familia boa esperanca', weekday: 2, start: '07:00', end: '11:00', slot: 20 },
      { unit: 'posto de saude da familia boa esperanca', weekday: 4, start: '07:00', end: '11:00', slot: 20 },
      { unit: 'posto de saude da familia moinho', weekday: 1, start: '07:00', end: '11:00', slot: 20 },
    ],
  },
  {
    name: 'Dr. Paulo Mendes', job_title: 'Cardiologista', registry: 'CRM 54321-PE',
    offers: [
      { unit: 'posto de saude da familia boa esperanca', kind: 'consulta', name: 'Cardiologia' },
      { unit: 'policlinica saude sao sebastiao', kind: 'consulta', name: 'Cardiologia' },
    ],
    schedules: [
      { unit: 'posto de saude da familia boa esperanca', weekday: 2, start: '13:00', end: '17:00', slot: 30 },
      { unit: 'policlinica saude sao sebastiao', weekday: 1, start: '08:00', end: '12:00', slot: 30 },
      { unit: 'policlinica saude sao sebastiao', weekday: 4, start: '08:00', end: '12:00', slot: 30 },
    ],
  },
  {
    name: 'Dra. Ana Beatriz', job_title: 'Pediatra', registry: 'CRM 98765-PE',
    offers: [
      { unit: 'posto de saude da familia moinho', kind: 'consulta', name: 'Pediatria' },
    ],
    schedules: [
      { unit: 'posto de saude da familia moinho', weekday: 3, start: '08:00', end: '12:00', slot: 30 },
      { unit: 'posto de saude da familia moinho', weekday: 5, start: '08:00', end: '12:00', slot: 30 },
    ],
  },
  {
    name: 'Dra. Carla Nogueira', job_title: 'Psicóloga', registry: 'CRP 11111',
    offers: [
      { unit: 'caps flor da pedra', kind: 'consulta', name: 'Saúde Mental' },
      { unit: 'caps flor da pedra', kind: 'consulta', name: 'Psicologia' },
    ],
    schedules: [
      { unit: 'caps flor da pedra', weekday: 1, start: '08:00', end: '12:00', slot: 30 },
      { unit: 'caps flor da pedra', weekday: 2, start: '08:00', end: '12:00', slot: 30 },
      { unit: 'caps flor da pedra', weekday: 3, start: '08:00', end: '12:00', slot: 30 },
      { unit: 'caps flor da pedra', weekday: 4, start: '08:00', end: '12:00', slot: 30 },
      { unit: 'caps flor da pedra', weekday: 5, start: '08:00', end: '12:00', slot: 30 },
    ],
  },
  {
    name: 'Téc. Rafael Lima', job_title: 'Técnico de Radiologia', registry: 'CRTR 22222',
    offers: [
      { unit: 'policlinica saude sao sebastiao', kind: 'exame', name: 'Raio-X' },
      { unit: 'policlinica saude sao sebastiao', kind: 'exame', name: 'Eletrocardiograma' },
      { unit: 'posto de saude da familia boa esperanca', kind: 'exame', name: 'Ultrassonografia' },
    ],
    schedules: [
      { unit: 'policlinica saude sao sebastiao', weekday: 1, start: '13:00', end: '17:00', slot: 30 },
      { unit: 'policlinica saude sao sebastiao', weekday: 3, start: '13:00', end: '17:00', slot: 30 },
      { unit: 'posto de saude da familia boa esperanca', weekday: 5, start: '08:00', end: '12:00', slot: 30 },
    ],
  },
];

// 3 agendamentos já ocupados (mesmo paciente demo, status variados).
// Os horários coincidem com a grade acima → somem dos cartões de vaga.
const BOOKINGS = [
  { prof: 'Dra. Maria da Silva', unit: 'posto de saude da familia boa esperanca', weekday: 1, time: '08:00', status: 'confirmado', table: 'appointments', serviceField: 'specialty', service: 'Cardiologia' },
  { prof: 'Téc. João Souza', unit: 'posto de saude da familia boa esperanca', weekday: 2, time: '07:00', status: 'pendente', table: 'exams', serviceField: 'exam_type', service: 'Hemograma' },
  { prof: 'Dra. Maria da Silva', unit: 'posto de saude da familia moinho', weekday: 2, time: '08:00', status: 'pendente', table: 'appointments', serviceField: 'specialty', service: 'Clínica Geral' },
];

function pad(n) { return String(n).padStart(2, '0'); }
function fmtDT(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}
function nextWeekday(weekday, hh, mm) {
  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  let delta = (weekday - d.getDay() + 7) % 7;
  if (delta === 0 && d.getTime() <= Date.now()) delta = 7;
  d.setDate(d.getDate() + delta);
  return d;
}

async function main() {
  const doReset = process.argv.includes('--reset');

  const [dbUnits] = await pool.query('SELECT id, name FROM health_units');
  const unitByNorm = {};
  for (const u of dbUnits) unitByNorm[norm(u.name)] = u;

  const unitIdOf = (want) => {
    const u = unitByNorm[want];
    if (!u) console.warn(`AVISO: unidade não encontrada: "${want}" (pulando vínculos)`);
    return u ? u.id : null;
  };

  if (doReset) {
    const [demoBookings] = await pool.query(
      `SELECT id FROM appointments WHERE notes = '[seed-demo]'`
    );
    await pool.query(`DELETE FROM appointments WHERE notes = '[seed-demo]'`);
    await pool.query(`DELETE FROM exams WHERE notes = '[seed-demo]'`);
    console.log(`Reset: ${demoBookings.length} agendamento(s) demo removido(s).`);
    for (const p of PROFESSIONALS) {
      await pool.query('DELETE FROM professionals WHERE name = ?', [p.name]);
    }
    console.log('Reset: profissionais demo removidos (vínculos e horários caem em cascata).');
  }

  // 1) ofertas por unidade
  let offerCount = 0;
  for (const u of UNITS) {
    const unitId = unitIdOf(u.want);
    if (!unitId) continue;
    for (const o of u.offers) {
      await pool.query(
        'INSERT IGNORE INTO unit_offers (id, unit_id, kind, name) VALUES (UUID(), ?, ?, ?)',
        [unitId, o.kind, o.name]
      );
      offerCount++;
    }
  }
  console.log(`Serviços verificados: ${offerCount} (4 unidades).`);

  // 2) profissionais + vínculos + horários
  const profIdByName = {};
  for (const p of PROFESSIONALS) {
    let [[prof]] = await pool.query('SELECT id FROM professionals WHERE name = ?', [p.name]);
    if (!prof) {
      const id = crypto.randomUUID();
      await pool.query(
        'INSERT INTO professionals (id, name, job_title, registry) VALUES (?,?,?,?)',
        [id, p.name, p.job_title, p.registry]
      );
      prof = { id };
      console.log(`Profissional criado: ${p.name}`);
    }
    profIdByName[p.name] = prof.id;
    for (const s of p.offers) {
      const unitId = unitIdOf(s.unit);
      if (!unitId) continue;
      await pool.query(
        'INSERT IGNORE INTO professional_offers (id, professional_id, unit_id, kind, name) VALUES (UUID(), ?, ?, ?, ?)',
        [prof.id, unitId, s.kind, s.name]
      );
    }
    for (const s of p.schedules) {
      const unitId = unitIdOf(s.unit);
      if (!unitId) continue;
      await pool.query(
        `INSERT IGNORE INTO work_schedules (id, professional_id, unit_id, weekday, start_time, end_time, slot_minutes)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?)`,
        [prof.id, unitId, s.weekday, s.start + ':00', s.end + ':00', s.slot]
      );
    }
  }
  console.log(`Profissionais verificados: ${PROFESSIONALS.length}.`);

  // 3) agendamentos ocupados (conflito de verdade)
  let [patientRows] = await pool.query(
    `SELECT id FROM users WHERE email = 'paciente1@teste.local' LIMIT 1`
  );
  if (!patientRows.length) {
    const [anyUser] = await pool.query('SELECT id FROM users LIMIT 1');
    patientRows = anyUser;
  }
  if (!patientRows.length) {
    console.warn('AVISO: sem usuários no banco — pulando agendamentos demo.');
  } else {
    const patientId = patientRows[0].id;
    for (const b of BOOKINGS) {
      const profId = profIdByName[b.prof];
      const unitId = unitIdOf(b.unit);
      if (!profId || !unitId) continue;
      const [hh, mm] = b.time.split(':').map(Number);
      const when = fmtDT(nextWeekday(b.weekday, hh, mm));
      const [[exists]] = await pool.query(
        `SELECT id FROM ${b.table} WHERE professional_id = ? AND scheduled_at = ? LIMIT 1`,
        [profId, when]
      );
      if (exists) continue;
      const [[unitRow]] = await pool.query('SELECT name FROM health_units WHERE id = ?', [unitId]);
      const locName = unitRow ? unitRow.name : '';
      if (b.table === 'appointments') {
        await pool.query(
          `INSERT INTO appointments (id, user_id, specialty, doctor, location, unit_id, professional_id, scheduled_at, notes, status)
           VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, '[seed-demo]', ?)`,
          [patientId, b.service, b.prof, locName, unitId, profId, when, b.status]
        );
      } else {
        await pool.query(
          `INSERT INTO exams (id, user_id, exam_type, location, unit_id, professional_id, scheduled_at, notes, status)
           VALUES (UUID(), ?, ?, ?, ?, ?, ?, '[seed-demo]', ?)`,
          [patientId, b.service, locName, unitId, profId, when, b.status]
        );
      }
      console.log(`Vaga ocupada (demo): ${b.service} — ${b.prof} — ${when} (${b.status}).`);
    }
  }

  await pool.end();
  console.log('Seed concluído.');
}

main().catch((err) => { console.error(err); process.exit(1); });
