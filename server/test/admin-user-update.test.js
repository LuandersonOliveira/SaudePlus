/**
 * PATCH /admin/users/:id — dados cadastrais (F0-04).
 *
 * O formulário do painel edita nome, e-mail e telefones junto com status e
 * cargo, mas a rota descartava esses campos em silêncio. O contrato testado:
 * campos de identidade são gravados, validados e auditados; e-mail é único e
 * normalizado; trocar o e-mail derruba as sessões antigas.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'server');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const pool = require('../src/db');
const jwt = require(require.resolve('jsonwebtoken', { paths: [SERVER] }));
const app = require('../src/app');
const bcrypt = require(require.resolve('bcryptjs', { paths: [SERVER] }));

const SENHA = 'senha-de-teste-123';
const CRIADOS = [];

async function inserirUsuario({ email, role = 'paciente', admin_level = null, deleted = false, extra = {} } = {}) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, account_status, admin_level, job_role, mobile, phone, deleted_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, 'Fulano de Teste', email, await bcrypt.hash(SENHA, 4), role, 'ativo', admin_level,
      extra.job_role ?? null, extra.mobile ?? '87988887777', extra.phone ?? null,
      deleted ? new Date() : null,
    ]
  );
  CRIADOS.push(id);
  return id;
}

function tokenPara(id, role, adminLevel, email = 'ator@test.local') {
  return jwt.sign(
    { id, email, role, admin_level: adminLevel, full_name: 'Ator de Teste' },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );
}

let server;
let base;
let superId;
let superToken;

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  superId = await inserirUsuario({
    email: `superadmin+${crypto.randomUUID().slice(0, 8)}@test.local`,
    role: 'admin',
    admin_level: 'superadmin',
  });
  superToken = tokenPara(superId, 'admin', 'superadmin');
});

test.after(async () => {
  await new Promise((r) => server.close(r));
  // audit_log é append-only (trigger bloqueia DELETE) e actor_id é RESTRICT.
  // Mesma saída usada por audit-orphan.test.js: desliga a FK na conexão e
  // remove só os usuários deste arquivo. As linhas de auditoria permanecem,
  // marcadas como ator ausente na listagem.
  const conn = await pool.getConnection().catch(() => null);
  try {
    if (conn) await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    const db = conn || pool;
    for (const id of CRIADOS) {
      await db.query('DELETE FROM refresh_tokens WHERE user_id = ?', [id]).catch(() => {});
      await db.query('DELETE FROM password_reset_tokens WHERE user_id = ?', [id]).catch(() => {});
      await db.query('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
    }
  } finally {
    if (conn) {
      await conn.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
      conn.release();
    }
  }
  await pool.end().catch(() => {});
});

async function patch(id, body, token = superToken) {
  const res = await fetch(`${base}/admin/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* sem corpo */ }
  return { status: res.status, body: json };
}

async function ler(id, colunas) {
  const [[row]] = await pool.query(`SELECT ${colunas.join(', ')} FROM users WHERE id = ?`, [id]);
  return row;
}

test('grava nome, e-mail e telefones e normaliza nome/e-mail', async () => {
  const id = await inserirUsuario({ email: `alvo+${crypto.randomUUID().slice(0, 8)}@test.local` });
  const novoEmail = `NOVO+${crypto.randomUUID().slice(0, 8)}@TEST.LOCAL`;

  const r = await patch(id, {
    full_name: '  Maria da Silva  ',
    email: novoEmail,
    mobile: '87999990000',
    phone: '8133334444',
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  const row = await ler(id, ['full_name', 'email', 'mobile', 'phone']);
  assert.equal(row.full_name, 'Maria da Silva');
  assert.equal(row.email, novoEmail.toLowerCase());
  assert.equal(row.mobile, '87999990000');
  assert.equal(row.phone, '8133334444');
});

test('campo ausente é preservado; campo vazio limpa o telefone', async () => {
  const id = await inserirUsuario({ email: `preserva+${crypto.randomUUID().slice(0, 8)}@test.local` });

  await patch(id, { mobile: '   ' });
  let row = await ler(id, ['full_name', 'email', 'mobile', 'phone']);
  assert.equal(row.mobile, null, 'só espaços limpa');
  assert.equal(row.full_name, 'Fulano de Teste', 'nome ausente não pode ser apagado');
  assert.equal(row.phone, null);

  await patch(id, { phone: '8133334444' });
  row = await ler(id, ['mobile', 'phone']);
  assert.equal(row.mobile, null, 'mobile não foi tocado');
  assert.equal(row.phone, '8133334444');
});

test('e-mail inválido devolve 400 e não grava nada', async () => {
  const id = await inserirUsuario({ email: `invalido+${crypto.randomUUID().slice(0, 8)}@test.local` });
  const antes = await ler(id, ['full_name', 'email']);

  const r = await patch(id, { full_name: 'Nome Novo', email: 'sem-arroba' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /e-mail/i);

  const depois = await ler(id, ['full_name', 'email']);
  assert.deepEqual(depois, antes, 'a rejeição tem de ser atômica');
});

test('e-mail já usado por outra conta devolve 409, comparando sem caixa', async () => {
  const email = `ocupado+${crypto.randomUUID().slice(0, 8)}@test.local`;
  await inserirUsuario({ email });
  const id = await inserirUsuario({ email: `livre+${crypto.randomUUID().slice(0, 8)}@test.local` });

  const r = await patch(id, { email: email.toUpperCase() });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /já está em uso/i);

  const row = await ler(id, ['email']);
  assert.notEqual(row.email, email.toUpperCase());
});

test('e-mail de conta soft-deleted continua reservado: 409, nunca 500', async () => {
  // `users.email` é UNIQUE global no schema; o soft delete não libera a
  // identidade de login. A checagem precisa enxergar a linha excluída — antes
  // o INSERT/UPDATE estourava ER_DUP_ENTRY e o handler devolvia 500.
  const email = `liberado+${crypto.randomUUID().slice(0, 8)}@test.local`;
  await inserirUsuario({ email, deleted: true });
  const id = await inserirUsuario({ email: `novo+${crypto.randomUUID().slice(0, 8)}@test.local` });

  const r = await patch(id, { email });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.match(r.body.error, /já está em uso/i);
});

test('nome fora de 2..150 e telefone acima de 30 são recusados', async () => {
  const id = await inserirUsuario({ email: `limites+${crypto.randomUUID().slice(0, 8)}@test.local` });

  for (const full_name of [' ', 'A', 'x'.repeat(151)]) {
    const r = await patch(id, { full_name });
    assert.equal(r.status, 400, `nome ${JSON.stringify(full_name)} deveria ser 400`);
    assert.match(r.body.error, /nome/i);
  }

  const r = await patch(id, { mobile: '9'.repeat(31) });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /30/);

  const row = await ler(id, ['full_name', 'mobile']);
  assert.equal(row.full_name, 'Fulano de Teste');
  assert.equal(row.mobile, '87988887777');
});

test('trocar o e-mail revoga as sessões antigas', async () => {
  const id = await inserirUsuario({ email: `sessao+${crypto.randomUUID().slice(0, 8)}@test.local` });
  await pool.query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, family, expires_at, revoked)
     VALUES (?,?,?,?, DATE_ADD(NOW(), INTERVAL 7 DAY), 0)`,
    [crypto.randomUUID(), id, crypto.randomBytes(32).toString('hex'), crypto.randomUUID()]
  );

  const r = await patch(id, { email: `trocado+${crypto.randomUUID().slice(0, 8)}@test.local` });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  const [rows] = await pool.query('SELECT revoked FROM refresh_tokens WHERE user_id = ?', [id]);
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].revoked), 1, 'refresh token da identidade antiga precisa morrer');
});

test('gestor edita dados cadastrais mas não define admin_level', async () => {
  const gestorId = await inserirUsuario({
    email: `gestor+${crypto.randomUUID().slice(0, 8)}@test.local`,
    role: 'admin',
    admin_level: 'gestor',
  });
  const gestorToken = tokenPara(gestorId, 'admin', 'gestor');
  const alvoAdmin = await inserirUsuario({
    email: `admin.alvo+${crypto.randomUUID().slice(0, 8)}@test.local`,
    role: 'admin',
    admin_level: 'atendimento',
  });

  const negado = await patch(alvoAdmin, { admin_level: 'gestor' }, gestorToken);
  assert.equal(negado.status, 403);

  const permitido = await patch(alvoAdmin, { full_name: 'Admin Editado' }, gestorToken);
  assert.equal(permitido.status, 200, JSON.stringify(permitido.body));
  assert.equal((await ler(alvoAdmin, ['full_name'])).full_name, 'Admin Editado');
});

test('só quem tem a capability admins troca e-mail ou senha de um administrador', async () => {
  const gestorId = await inserirUsuario({
    email: `gestor+${crypto.randomUUID().slice(0, 8)}@test.local`,
    role: 'admin',
    admin_level: 'gestor',
  });
  const gestorToken = tokenPara(gestorId, 'admin', 'gestor');
  const emailAlvo = `admin.alvo+${crypto.randomUUID().slice(0, 8)}@test.local`;
  const alvoAdmin = await inserirUsuario({ email: emailAlvo, role: 'admin', admin_level: 'atendimento' });

  // Gestor não toma a conta de um admin de nível menor.
  const emailNegado = await patch(alvoAdmin, { email: `tomada+${crypto.randomUUID().slice(0, 8)}@test.local` }, gestorToken);
  assert.equal(emailNegado.status, 403);
  const senhaNegada = await patch(alvoAdmin, { password: 'nova-senha-123' }, gestorToken);
  assert.equal(senhaNegada.status, 403);
  assert.equal((await ler(alvoAdmin, ['email'])).email, emailAlvo);

  // Superadmin (tem 'admins') segue podendo.
  const permitido = await patch(alvoAdmin, { email: `ok+${crypto.randomUUID().slice(0, 8)}@test.local` }, superToken);
  assert.equal(permitido.status, 200, JSON.stringify(permitido.body));

  // Gestor ainda troca e-mail de paciente (a trava vale só para alvo admin).
  const pacienteId = await inserirUsuario({ email: `pac+${crypto.randomUUID().slice(0, 8)}@test.local` });
  const pac = await patch(pacienteId, { email: `pac2+${crypto.randomUUID().slice(0, 8)}@test.local` }, gestorToken);
  assert.equal(pac.status, 200, JSON.stringify(pac.body));
});

test('reenviar o MESMO e-mail de um administrador não aciona a trava (o formulário sempre o envia)', async () => {
  const gestorId = await inserirUsuario({
    email: `gestor+${crypto.randomUUID().slice(0, 8)}@test.local`,
    role: 'admin',
    admin_level: 'gestor',
  });
  const gestorToken = tokenPara(gestorId, 'admin', 'gestor');
  const emailAlvo = `admin.alvo+${crypto.randomUUID().slice(0, 8)}@test.local`;
  const alvoAdmin = await inserirUsuario({ email: emailAlvo, role: 'admin', admin_level: 'atendimento' });

  // mesmo e-mail (inclusive com outra caixa/espaços) + outro campo: permitido
  const ok = await patch(alvoAdmin, { email: `  ${emailAlvo.toUpperCase()} `, mobile: '87911112222' }, gestorToken);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await ler(alvoAdmin, ['mobile'])).mobile, '87911112222');

  // e-mail diferente continua barrado
  const troca = await patch(alvoAdmin, { email: `outro+${crypto.randomUUID().slice(0, 8)}@test.local` }, gestorToken);
  assert.equal(troca.status, 403);
  assert.equal((await ler(alvoAdmin, ['email'])).email, emailAlvo);
});

test('paciente não acessa a rota', async () => {
  const id = await inserirUsuario({ email: `paciente+${crypto.randomUUID().slice(0, 8)}@test.local` });
  const token = tokenPara(id, 'paciente', null);
  const r = await patch(id, { full_name: 'Invasor' }, token);
  assert.equal(r.status, 403);
});
