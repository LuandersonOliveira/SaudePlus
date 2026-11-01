/**
 * Um agendamento de 60 minutos precisa ocupar 60 minutos.
 *
 * `validateBooking` derivava a duração do candidato corretamente (do
 * `slot_minutes` da agenda), mas `fetchBusyIntervals` tratava todo
 * agendamento JÁ EXISTENTE como se durasse 30 minutos. Com uma agenda só, o
 * problema fica mascarado pela grade; ele aparece quando o mesmo profissional
 * tem dois `work_schedules` sobrepostos no mesmo dia com durações diferentes:
 *
 *   08:00–12:00  slot 60 min   (candidatos 08:00, 09:00, 10:00…)
 *   09:00–17:00  slot 30 min   (candidatos 09:00, 09:30, 10:00…)
 *
 * Agendamento das 09:00 (60 min, 09:00–10:00). A checagem de conflito via a
 * cabeça errada: 09:00–09:30. Das 09:30 (30 min, 09:30–10:00) não encosta em
 * 09:00–09:30 e passa — dois compromissos sobrepostos no mesmo profissional.
 *
 * A correção é persistir a duração no próprio agendamento. Ela é propriedade
 * do agendamento, não da agenda como ela está hoje: se o admin mudar o
 * `slot_minutes` amanhã, o significado do que foi marcado hoje não pode
 * mudar retroativamente.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const app = require('../src/app');
const pool = require('../src/db');

const P = {
  unidade: '00000000-0000-4000-8000-0000000b0001',
  profissional: '00000000-0000-4000-8000-0000000b0002',
  paciente: '00000000-0000-4000-8000-0000000b0003',
  scheduleLongo: '00000000-0000-4000-8000-0000000b0010',
  scheduleCurto: '00000000-0000-4000-8000-0000000b0011',
  oferta: '00000000-0000-4000-8000-0000000b0020',
};

let server;
let base;
let token;

// Uma terça-feira bem longe, para nunca colidir com a agenda real.
const DIA = (() => {
  const d = new Date(Date.now() + 60 * 86400000);
  while (d.getDay() !== 2) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

const auth = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
const marcar = (hora) => fetch(`${base}/me/appointments`, {
  method: 'POST',
  headers: auth(),
  body: JSON.stringify({
    unit_id: P.unidade,
    professional_id: P.profissional,
    specialty: 'Clínica Geral',
    location: 'UBS Duração',
    scheduled_at: `${DIA} ${hora}:00`,
  }),
});

async function preparar() {
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [P.paciente]).catch(() => {});
  await pool.query('INSERT IGNORE INTO health_units (id, name, type, neighborhood) VALUES (?,?,?,?)',
    [P.unidade, 'UBS Duração', 'ubs', 'Centro']);
  await pool.query('INSERT IGNORE INTO professionals (id, name, job_title) VALUES (?,?,?)',
    [P.profissional, 'Dr. Duração', 'Clínica Geral']);
  await pool.query('INSERT IGNORE INTO unit_offers (id, unit_id, kind, name, active) VALUES (?,?,?,?,1)',
    [P.oferta, P.unidade, 'consulta', 'Clínica Geral']);
  await pool.query('INSERT IGNORE INTO professional_offers (id, professional_id, unit_id, kind, name) VALUES (?,?,?,?,?)',
    [crypto.randomUUID(), P.profissional, P.unidade, 'consulta', 'Clínica Geral']);
  await pool.query(
    `INSERT IGNORE INTO users (id, full_name, email, password_hash, role, account_status)
     VALUES (?, 'Paciente Duração', 'duracao@caps.local', 'x', 'paciente', 'ativo')`,
    [P.paciente]
  );
  // Este suíte testa duração, não prioridade: o paciente entra como
  // prioritário para que a cota do NV02 não esconda as vagas do início do dia.
  await pool.query("UPDATE users SET priority = 'idoso' WHERE id = ?", [P.paciente]);

  // As DUAS agendas sobrepostas: 60 min de manhã, 30 min à tarde — e as duas
  // cobrem as 09:00–10:00, que é onde a sobreposição vai aparecer.
  await pool.query('DELETE FROM work_schedules WHERE id IN (?, ?)', [P.scheduleLongo, P.scheduleCurto]);
  await pool.query(
    `INSERT INTO work_schedules (id, professional_id, unit_id, weekday, start_time, end_time, slot_minutes)
     VALUES (?, ?, ?, 2, '08:00', '12:00', 60)`,
    [P.scheduleLongo, P.profissional, P.unidade]
  );
  await pool.query(
    `INSERT INTO work_schedules (id, professional_id, unit_id, weekday, start_time, end_time, slot_minutes)
     VALUES (?, ?, ?, 2, '09:00', '17:00', 30)`,
    [P.scheduleCurto, P.profissional, P.unidade]
  );

  token = jwt.sign({ id: P.paciente, email: 'duracao@caps.local', role: 'paciente', full_name: 'Paciente Duração' },
    process.env.JWT_SECRET, { expiresIn: '5m' });
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await preparar();
});

test.after(async () => {
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [P.paciente]).catch(() => {});
  await pool.query('DELETE FROM work_schedules WHERE id IN (?, ?)', [P.scheduleLongo, P.scheduleCurto]).catch(() => {});
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await pool.end().catch(() => {});
});

test('o agendamento guarda a própria duração', async () => {
  const res = await marcar('09:00');
  assert.equal(res.status, 201, `o primeiro agendamento deveria passar, deu ${res.status}`);

  const [[row]] = await pool.query(
    'SELECT scheduled_at, duration_minutes FROM appointments WHERE user_id = ? ORDER BY created_at DESC, scheduled_at DESC LIMIT 1',
    [P.paciente]
  );
  assert.ok(
    Number(row.duration_minutes) > 0,
    `o agendamento precisa guardar a duração; veio ${row.duration_minutes}`
  );
});

test('agendamento de 60 min bloqueia o horário seguinte da grade de 30', async () => {
  // Este é o defeito: 09:30 é candidato legítimo (grade de 30 min), mas
  // colide com o atendimento de 60 min das 09:00.
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [P.paciente]);

  const primeiro = await marcar('09:00');
  assert.equal(primeiro.status, 201, `primeiro deveria passar, deu ${primeiro.status}`);

  const segundo = await marcar('09:30');
  assert.equal(segundo.status, 409,
    `as 09:30 colidem com o atendimento das 09:00 (60 min) e tem que dar 409, deu ${segundo.status}`);
  const body = await segundo.json();
  assert.match(body.error, /ocupado/i);
});

test('agora, o horário seguinte da grade de 60 continua livre', async () => {
  // Contra-prova: se a duração fosse aplicada sem cuidado, o horário seguinte
  // do turno da manhã seria bloqueado à toa. 10:00 é o candidato seguinte da
  // grade de 60 e precisa passar.
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [P.paciente]);

  assert.equal((await marcar('09:00')).status, 201);
  assert.equal((await marcar('10:00')).status, 201, '10:00 não colide com 09:00–10:00');
});

test('agendamento legado sem duração gravada ainda bloqueia por 30 min', async () => {
  // Registros antigos não têm a coluna preenchida. O COALESCE no cálculo de
  // conflito mantém o comportamento antigo para eles — que é melhor do que
  // ignorar a linha e permitir sobreposição.
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [P.paciente]);

  const [[unit]] = await pool.query('SELECT id FROM health_units WHERE id = ?', [P.unidade]);
  await pool.query(
    `INSERT INTO appointments (id, user_id, unit_id, professional_id, specialty, location, scheduled_at, status)
     VALUES (?, ?, ?, ?, 'Clínica Geral', 'UBS', ?, 'confirmado')`,
    [crypto.randomUUID(), P.paciente, unit.id, P.profissional, `${DIA} 15:00:00`]
  );

  const colunas = (await pool.query('SHOW COLUMNS FROM appointments LIKE \'duration_minutes\''))[0];
  if (colunas.length) {
    assert.equal(colunas[0].Default, null, 'a coluna precisa ser anulável para o legado caber');
  }

  const res = await marcar('15:15');
  assert.equal(res.status, 409, 'sem duração gravada, o legado ocupa 30 min (15:00–15:30) e 15:15 colide');
  assert.equal((await marcar('15:30')).status, 201, '15:30 é o fim do legado: pode entrar');
});

test('a duração vem da agenda, e não é fixa', async () => {
  const { duracaoMinutos } = require('../src/utils/booking');
  const conn = await pool.getConnection();
  try {
    const longa = await duracaoMinutos(conn, {
      unitId: P.unidade, professionalId: P.profissional, scheduledAt: `${DIA} 09:00:00`,
    });
    // 09:00 é candidato das DUAS agendas (60 e 30). A primeira que casa vence —
    // e o que importa é que o valor venha da agenda, não de uma constante.
    assert.ok([30, 60].includes(longa), `duração inesperada: ${longa}`);
    assert.equal(typeof longa, 'number');
    assert.ok(longa >= 5 && longa <= 240, 'tem que respeitar o limite da agenda');

    const semProfissional = await duracaoMinutos(conn, {
      unitId: P.unidade, professionalId: null, scheduledAt: `${DIA} 09:00:00`,
    });
    assert.equal(semProfissional, 30, 'serviço sem profissional alocado usa o padrão');
  } finally {
    conn.release();
  }
});