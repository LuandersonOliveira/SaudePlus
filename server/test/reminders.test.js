/**
 * O job de lembretes montava a mensagem como
 * `${subject} em ${location}, às HH:MM.` — subject vem de specialty
 * (VARCHAR 120) e location de VARCHAR 180, dando ~315 caracteres. A coluna
 * `reminders.message` é VARCHAR(255). Uma consulta com especialidade longa
 * estourava ER_DATA_TOO_LONG, o erro subia pelo `for` e abortava o LOTE
 * INTEIRO: nenhuma consulta e nenhum exame desse dia recebiam lembrete, com
 * uma única linha no console.
 *
 * O que se espera: um registro problemático não pode levar os outros junto.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'server');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const pool = require('../src/db');
const bcrypt = require(require.resolve('bcryptjs', { paths: [SERVER] }));

const CRIADOS = [];

function pad(v) {
  return String(v).padStart(2, '0');
}

// Amanhã, para o job (que olha a janela "de amanhã") encontrar.
function amanha() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function criarUsuario() {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, account_status)
     VALUES (?,?,?,?,?,?)`,
    [id, 'Lembrete', `lembrete+${id.slice(0, 8)}@test.local`, await bcrypt.hash('senha12345', 4), 'paciente', 'ativo']
  );
  CRIADOS.push(id);
  return id;
}

let reminders;

test.before(() => {
  reminders = require('../src/jobs/reminders');
});

test.after(async () => {
  for (const id of CRIADOS) {
    await pool.query('DELETE FROM reminders WHERE user_id = ?', [id]).catch(() => {});
    await pool.query('DELETE FROM appointments WHERE user_id = ?', [id]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
  }
  await pool.end().catch(() => {});
});

test('a coluna message realmente é menor que a mensagem montada', async () => {
  const [[col]] = await pool.query(
    `SELECT CHARACTER_MAXIMUM_LENGTH AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reminders' AND COLUMN_NAME = 'message'`
  );
  assert.ok(
    Number(col.n) < 315,
    `reminders.message é VARCHAR(${col.n}); a mensagem com specialty+location longos passa de 255`
  );
});

test('uma especialidade longa não impede o lembrete de ninguém', async () => {
  const dia = amanha();

  // especialidade(120) + local(180) + conectores = ~314 > 255.
  const especialidadeLonga = 'D'.repeat(120);
  const localLongo = 'L'.repeat(180);

  const u1 = await criarUsuario();
  const u2 = await criarUsuario();
  const u3 = await criarUsuario();

  await pool.query(
    `INSERT INTO appointments (id, user_id, specialty, location, scheduled_at, status)
     VALUES (?,?,?,?,?,'pendente')`,
    [crypto.randomUUID(), u1, especialidadeLonga, localLongo, `${dia} 08:00:00`]
  );
  await pool.query(
    `INSERT INTO appointments (id, user_id, specialty, location, scheduled_at, status)
     VALUES (?,?,?,?,?,'pendente')`,
    [crypto.randomUUID(), u2, 'Clínica Geral', 'UBS Boa Esperança', `${dia} 09:00:00`]
  );
  await pool.query(
    `INSERT INTO appointments (id, user_id, specialty, location, scheduled_at, status)
     VALUES (?,?,?,?,?,'pendente')`,
    [crypto.randomUUID(), u3, 'Cardiologia', 'UBS Moinho', `${dia} 10:00:00`]
  );

  // Auto-verificação: confirma que o cenário é mesmo o do bug, em vez de
  // confiar no tamanho das strings montadas aqui.
  const [[cenario]] = await pool.query(
    'SELECT CHAR_LENGTH(?) + CHAR_LENGTH(?) + 20 AS n FROM appointments WHERE user_id = ?',
    [especialidadeLonga, localLongo, u1]
  );
  assert.ok(
    Number(cenario.n) > 255,
    `o cenário precisa gerar mensagem > 255; está gerando ${cenario.n}`
  );

  const r = await reminders.runReminderJob();

  // Antes da correção, a linha longa estourava e TODAS as outras perdiam o
  // lembrete do dia. O resultado agora: as três recebem.
  assert.equal(r.failed, 0, `nada deveria falhar: ${JSON.stringify(r)}`);
  assert.equal(r.created, 3, `as três consultas deveriam ter recebido lembrete: ${JSON.stringify(r)}`);
  for (const u of [u1, u2, u3]) {
    const [[row]] = await pool.query('SELECT COUNT(*) AS n FROM reminders WHERE user_id = ?', [u]);
    assert.ok(Number(row.n) >= 1, `o usuário ${u} deveria ter recebido lembrete`);
  }

  // E a mensagem longa foi cortada, não cortada pela metade sem querer.
  const [[longa]] = await pool.query(
    'SELECT CHAR_LENGTH(message) AS n FROM reminders WHERE user_id = ?',
    [u1]
  );
  assert.ok(Number(longa.n) <= 255, `mensagem de ${longa.n} caracteres não cabe em VARCHAR(255)`);
  assert.ok(Number(longa.n) > 200, 'o corte não pode ter comido o lembrete inteiro');
});

test('uma linha que falha de verdade não derruba as outras', async () => {
  const dia = amanha();
  const u = await criarUsuario();
  const quebrado = await criarUsuario();

  await pool.query(
    `INSERT INTO appointments (id, user_id, specialty, location, scheduled_at, status)
     VALUES (?,?,?,?,?,'pendente')`,
    [crypto.randomUUID(), quebrado, 'Ortopedia', 'UBS Igarassu', `${dia} 07:00:00`]
  );
  await pool.query(
    `INSERT INTO appointments (id, user_id, specialty, location, scheduled_at, status)
     VALUES (?,?,?,?,?,'pendente')`,
    [crypto.randomUUID(), u, 'Neurologia', 'UBS Nova Itaenga', `${dia} 08:30:00`]
  );

  // Falha no INSERT do lembrete de UM usuário. Não dá para provoke pela FK:
  // appointments.user_id e reminders.user_id rejeitam o usuário inexistente
  // na hora de criar a consulta, antes do job rodar. Injetamos no pool para
  // exercitar o caminho real de isolamento.
  const original = pool.query.bind(pool);
  pool.query = (sql, params) => {
    if (String(sql).includes('INSERT INTO reminders') && params && params[1] === quebrado) {
      return Promise.reject(Object.assign(new Error('falha injetada'), { code: 'E_FAKED' }));
    }
    return original(sql, params);
  };

  let r;
  try {
    r = await reminders.runReminderJob();
  } finally {
    pool.query = original;
  }

  assert.ok(r.failed >= 1, `a linha quebrada deveria estar em failed: ${JSON.stringify(r)}`);
  assert.ok(r.created >= 1, 'a consulta boa deveria ter recebido lembrete mesmo assim');

  const [[row]] = await pool.query('SELECT COUNT(*) AS n FROM reminders WHERE user_id = ?', [u]);
  assert.ok(Number(row.n) >= 1, 'a linha válida não pode ser vítima da que quebrou');
});

test('createReminderFor distingue criado, já existente e falho', async () => {
  const u = await criarUsuario();
  const dia = amanha();
  const row = {
    user_id: u,
    specialty: 'Oftalmologia',
    location: 'UBS CapS',
    scheduled_at: `${dia} 11:00:00`,
  };

  assert.equal(await reminders.createReminderFor(row, 'appointment'), 'created');
  assert.equal(
    await reminders.createReminderFor(row, 'appointment'),
    'exists',
    'a segunda chamada tem que dizer "exists", não "created"'
  );

  const original = pool.query.bind(pool);
  pool.query = (sql, params) => {
    if (String(sql).includes('INSERT INTO reminders') && params && params[1] === u) {
      return Promise.reject(Object.assign(new Error('falha injetada'), { code: 'E_FAKED' }));
    }
    return original(sql, params);
  };
  try {
    assert.equal(
      await reminders.createReminderFor({ ...row, scheduled_at: `${dia} 11:30:00` }, 'appointment'),
      'failed',
      'o resultado precisa distinguir falha de "já existe"'
    );
  } finally {
    pool.query = original;
  }
});

test('a mensagem gravada cabe na coluna', async () => {
  const u = await criarUsuario();
  const dia = amanha();
  await reminders.createReminderFor(
    { user_id: u, specialty: 'A'.repeat(120), location: 'B'.repeat(180), scheduled_at: `${dia} 12:00:00` },
    'exam'
  );
  const [[row]] = await pool.query(
    'SELECT CHAR_LENGTH(message) AS n FROM reminders WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
    [u]
  );
  assert.ok(row, 'o lembrete deveria ter sido gravado');
  assert.ok(Number(row.n) <= 255, `mensagem de ${row.n} caracteres não cabe em VARCHAR(255)`);
});

test('runReminderJob é idempotente: rodar duas vezes não duplica', async () => {
  const u = await criarUsuario();
  const dia = amanha();
  await pool.query(
    `INSERT INTO appointments (id, user_id, specialty, location, scheduled_at, status)
     VALUES (?,?,?,?,?,'pendente')`,
    [crypto.randomUUID(), u, 'Oftalmologia', 'UBS Salinas', `${dia} 14:00:00`]
  );
  await reminders.runReminderJob();
  const depois = await pool.query('SELECT COUNT(*) AS n FROM reminders WHERE user_id = ?', [u]);
  await reminders.runReminderJob();
  const final = await pool.query('SELECT COUNT(*) AS n FROM reminders WHERE user_id = ?', [u]);
  assert.equal(Number(final[0][0].n), Number(depois[0][0].n), 'a segunda rodada duplicou lembrete');
});

test('o job devolve o total de falhas no resultado', async () => {
  const r = await reminders.runReminderJob();
  assert.ok('failed' in r, `o resultado precisa expor failed: ${JSON.stringify(r)}`);
  assert.equal(typeof r.failed, 'number');
  assert.equal(typeof r.created, 'number');
});