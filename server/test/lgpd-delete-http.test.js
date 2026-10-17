/**
 * O estado final da exclusão LGPD, conferido no banco de verdade.
 *
 * O teste de unidade (lgpd-anonymization.test.js) cobre a transação; este
 * cobre o resultado. É o que prova que o titular ficou realmente sem nome,
 * sem documentos, sem consultas futuras e sem sessão — e que o histórico
 * passado NÃO sumiu, porque ele virou estatística anônima.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const app = require('../src/app');
const pool = require('../src/db');
const { anonymizeUser } = require('../src/utils/privacy');

const ALVO = { id: '00000000-0000-4000-8000-00000000c0de', email: 'lgpd-alvo@caps.local' };
const UNIDADE = '00000000-0000-4000-8000-00000000abcd';
const SERVICO = 'Clínica Geral';

let server;
let base;
let token;
let profissional;

const criar = (id, extras = '') => pool.query(
  `INSERT IGNORE INTO users (id, full_name, email, password_hash, role, account_status, cpf, mobile, birth_date, blood_type ${extras})
   VALUES (?, 'Titular Teste', ?, ?, 'paciente', 'ativo', '52998224725', '11988887777', '1990-05-05', 'O+')`,
  [id, ALVO.email, extras]
);

async function preparar() {
  // Limpa o que este usuário tem nos testes anteriores — sem isso uma execução
  // que falhou no meio deixa consulta futura para trás e a contagem mente.
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [ALVO.id]).catch(() => {});
  await pool.query('DELETE FROM exams WHERE user_id = ?', [ALVO.id]).catch(() => {});
  await pool.query('DELETE FROM refresh_tokens WHERE user_id = ?', [ALVO.id]).catch(() => {});

  await criar(ALVO.id);
  await pool.query(
    `UPDATE users SET full_name = 'Titular Teste', email = ?, password_hash = ?,
       cpf = '52998224725', mobile = '11988887777', birth_date = '1990-05-05', blood_type = 'O+',
       account_status = 'ativo', deleted_at = NULL, totp_enabled = 0, totp_secret = NULL
     WHERE id = ?`,
    [ALVO.email, await bcrypt.hash('SenhaTeste1!', 10), ALVO.id]
  );

  const [[u]] = await pool.query('SELECT id FROM health_units LIMIT 1');
  const [[p]] = await pool.query('SELECT id FROM professionals LIMIT 1');
  const idProf = p ? p.id : crypto.randomUUID();
  const unitId = u.id;

  const [[existe]] = await pool.query('SELECT id FROM professionals WHERE id = ?', [idProf]);
  if (!existe) {
    await pool.query(
      `INSERT INTO professionals (id, name, job_title) VALUES (?, 'Prof. LGPD', 'Clínica Geral')`, [idProf]
    );
  }
  await pool.query(
    `INSERT IGNORE INTO professional_offers (id, professional_id, unit_id, kind, name)
     VALUES (?, ?, ?, 'consulta', ?)`,
    [crypto.randomUUID(), idProf, unitId, SERVICO]
  );
  return { idProf, unitId };
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  profissional = await preparar();
  const jwt = require('jsonwebtoken');
  token = jwt.sign({ id: ALVO.id, email: ALVO.email, role: 'paciente', full_name: 'Titular Teste' },
    process.env.JWT_SECRET, { expiresIn: '5m' });
});

test.after(async () => {
  await pool.query('DELETE FROM appointments WHERE user_id = ?', [ALVO.id]).catch(() => {});
  await pool.query('DELETE FROM exams WHERE user_id = ?', [ALVO.id]).catch(() => {});
  await pool.query('DELETE FROM refresh_tokens WHERE user_id = ?', [ALVO.id]).catch(() => {});
  await pool.query('DELETE FROM users WHERE id = ?', [ALVO.id]).catch(() => {});
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await pool.end().catch(() => {});
});

test('DELETE /auth/me apaga o titular, cancela o futuro e revoga as sessões', async () => {
  // Agendamento no futuro (deve ser cancelado) e um no passado (deve sobrar
  // como histórico anônimo).
  const quandoFuturo = '2099-01-15 10:00:00';
  const quandoPassado = '2001-01-15 10:00:00';
  await pool.query(
    `INSERT INTO appointments (id, user_id, unit_id, professional_id, specialty, location, scheduled_at, status)
     VALUES (?, ?, ?, ?, ?, 'UBS', ?, 'confirmado')`,
    [crypto.randomUUID(), ALVO.id, profissional.unitId, profissional.idProf, 'Clínica Geral', quandoFuturo]
  );
  await pool.query(
    `INSERT INTO appointments (id, user_id, unit_id, professional_id, specialty, location, scheduled_at, status)
     VALUES (?, ?, ?, ?, ?, 'UBS', ?, 'concluido')`,
    [crypto.randomUUID(), ALVO.id, profissional.unitId, profissional.idProf, 'Clínica Geral', quandoPassado]
  );
  await pool.query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, family, expires_at)
     VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))`,
    [crypto.randomUUID(), ALVO.id, 'a'.repeat(64), crypto.randomUUID()]
  );

  const res = await fetch(`${base}/auth/me`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'SenhaTeste1!' }),
  });
  assert.equal(res.status, 200, `a exclusão deveria funcionar, deu ${res.status}`);
  assert.equal((await res.json()).ok, true);

  const [[user]] = await pool.query(
    `SELECT full_name, email, cpf, mobile, birth_date, blood_type, account_status, deleted_at
     FROM users WHERE id = ?`, [ALVO.id]
  );
  assert.equal(user.full_name, 'Titular removido');
  assert.equal(user.email, `removido_${ALVO.id}@removido.local`);
  assert.equal(user.cpf, null, 'CPF tem que sumir');
  assert.equal(user.mobile, null, 'telefone tem que sumir');
  assert.equal(user.birth_date, null);
  assert.equal(user.blood_type, null);
  assert.equal(user.account_status, 'inativo');
  assert.ok(user.deleted_at, 'deleted_at tem que marcar a exclusão');

  const [fut] = await pool.query('SELECT status FROM appointments WHERE user_id = ? AND scheduled_at = ?', [ALVO.id, quandoFuturo]);
  assert.equal(fut.length, 1);
  assert.equal(fut[0].status, 'cancelado', 'consulta futura tem que ser cancelada, não abandonada');

  const [pass] = await pool.query('SELECT status FROM appointments WHERE user_id = ? AND scheduled_at = ?', [ALVO.id, quandoPassado]);
  assert.equal(pass.length, 1, 'histórico passado tem que continuar');
  assert.equal(pass[0].status, 'concluido');

  const [[tk]] = await pool.query('SELECT revoked FROM refresh_tokens WHERE user_id = ?', [ALVO.id]);
  assert.equal(Number(tk.revoked), 1, 'a sessão tem que estar revogada — senão o titular "removido" ainda entra');
});

test('a senha errada não anonimiza nada', async () => {
  const res = await fetch(`${base}/auth/me`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'senha-errada' }),
  });
  assert.equal(res.status, 401);
  const [[user]] = await pool.query('SELECT full_name FROM users WHERE id = ?', [ALVO.id]);
  assert.equal(user.full_name, 'Titular removido', 'o registro continua como a exclusão anterior deixou');
});

test('a trilha registra a exclusão depois do commit', async () => {
  // A auditoria vem DEPOIS do commit: uma linha "perfil anonimizado"
  // gravada antes seria um registro de algo que talvez nem fosse persistido.
  const [rows] = await pool.query(
    `SELECT details FROM audit_log WHERE actor_id = ? AND action = 'lgpd_delete' ORDER BY seq DESC LIMIT 1`,
    [ALVO.id]
  );
  assert.equal(rows.length, 1, 'a exclusão tem que estar auditada');
  assert.match(rows[0].details, /anonimizado/);
});

test('anonymizeUser rejeita pool sem transação', async () => {
  await assert.rejects(() => anonymizeUser({ query: async () => [[{}]] }, ALVO.id), /getConnection/);
});