/**
 * E-26 (Fase 8, item 1.4): cadastro, login por senha, exportação e edição do perfil entram na trilha.
 *
 * Antes só o login por MFA e pelo Gov.br deixava linha em `audit_log`. O kit do auditor
 * (`TRILHA_AUDITORIA.md`, "logins com MFA vs sem MFA") não tinha como contar os logins SEM
 * segundo fator, e a exportação dos dados do titular (LGPD, art. 18, V) não deixava rastro.
 *
 * Regra do ADR-0012: o `details` leva só dados operacionais, nunca nome, e-mail, CPF ou valores.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

const SERVER = path.resolve(__dirname, '..');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const pool = require('../src/db');
const jwt = require(require.resolve('jsonwebtoken', { paths: [SERVER] }));
const app = require('../src/app');

const SENHA = 'Senha-Forte-123';
const NOME = 'Quitéria Albuquerque Montenegro';
const CRIADOS = [];
let server;
let base;

// CPF válido (dígitos verificadores corretos) e único por execução.
function cpfValido() {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (digs) => {
    const soma = digs.reduce((acc, d, i) => acc + d * (digs.length + 1 - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(n);
  const d2 = dv([...n, d1]);
  return [...n, d1, d2].join('');
}

const chamar = async (method, rota, body, token) => {
  const res = await fetch(`${base}/api${rota}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

async function cadastrar() {
  const email = `trilha-${crypto.randomUUID()}@test.local`;
  const r = await chamar('POST', '/auth/signup', {
    email, password: SENHA, full_name: NOME, birth_date: '1990-05-10', cpf: cpfValido(),
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  CRIADOS.push(r.body.id);
  return { id: r.body.id, email };
}

const tokenPara = (id, email) =>
  jwt.sign({ id, email, role: 'paciente', admin_level: null, full_name: NOME }, process.env.JWT_SECRET, { expiresIn: '10m' });

const trilha = async (entityId, action) =>
  (await pool.query(
    'SELECT actor_id, action, entity_type, details FROM audit_log WHERE entity_id = ? AND action = ? ORDER BY seq',
    [entityId, action]
  ))[0];

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((r) => server.close(r));
  for (const id of CRIADOS) {
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = ?', [id]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
  }
  await pool.end().catch(() => {});
});

function semDadoPessoal(linhas, ...proibidos) {
  for (const l of linhas) {
    for (const p of proibidos) {
      assert.ok(!String(l.details).includes(p), `a trilha cita "${p}": ${l.details}`);
    }
  }
}

test('cadastro: grava "signup" em nome do próprio titular, sem nome nem e-mail', async () => {
  const { id, email } = await cadastrar();
  const linhas = await trilha(id, 'signup');
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].actor_id, id);
  assert.equal(linhas[0].entity_type, 'user');
  assert.match(linhas[0].details, /^cadastro: role=paciente status=ativo$/);
  semDadoPessoal(linhas, NOME, 'Quitéria', email);
});

test('login por senha sem MFA: grava "login_senha" marcando que não houve segundo fator', async () => {
  const { id, email } = await cadastrar();
  const r = await chamar('POST', '/auth/login', { email, password: SENHA });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.token);

  const linhas = await trilha(id, 'login_senha');
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].actor_id, id);
  assert.equal(linhas[0].details, 'sessão iniciada sem segundo fator');
  semDadoPessoal(linhas, email, NOME);
});

test('login por senha com MFA ativo: grava "login_senha" aguardando o segundo fator', async () => {
  const { id, email } = await cadastrar();
  await pool.query("UPDATE users SET totp_enabled = 1, totp_secret = 'segredo-de-teste' WHERE id = ?", [id]);

  const r = await chamar('POST', '/auth/login', { email, password: SENHA });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.mfa_required, true);

  const linhas = await trilha(id, 'login_senha');
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].details, 'senha validada, aguardando segundo fator');
});

test('senha errada não grava nada (não há titular certo para atribuir a linha)', async () => {
  const { id, email } = await cadastrar();
  const r = await chamar('POST', '/auth/login', { email, password: 'senha-errada-999' });
  assert.equal(r.status, 401);
  assert.equal((await trilha(id, 'login_senha')).length, 0);
});

test('exportação dos dados: grava "lgpd_export" em nome do titular', async () => {
  const { id, email } = await cadastrar();
  const r = await chamar('GET', '/auth/me/export', null, tokenPara(id, email));
  assert.equal(r.status, 200);

  const linhas = await trilha(id, 'lgpd_export');
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].actor_id, id);
  assert.equal(linhas[0].details, 'exportação dos dados do titular');
});

test('edição do perfil: grava "profile_update" com os NOMES dos campos, nunca os valores', async () => {
  const { id, email } = await cadastrar();
  const r = await chamar('PUT', '/auth/me', { mobile: '81988887766', city: 'Lagoa de Itaenga' }, tokenPara(id, email));
  assert.equal(r.status, 200, JSON.stringify(r.body));

  const linhas = await trilha(id, 'profile_update');
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].actor_id, id);
  assert.match(linhas[0].details, /^campos alterados: /);
  assert.match(linhas[0].details, /\bmobile\b/);
  assert.match(linhas[0].details, /\bcity\b/);
  semDadoPessoal(linhas, '81988887766', 'Lagoa de Itaenga');
});

test('edição de perfil recusada (400) não grava linha', async () => {
  const { id, email } = await cadastrar();
  const r = await chamar('PUT', '/auth/me', { email: 'isto-nao-e-um-email' }, tokenPara(id, email));
  assert.ok(r.status >= 400);
  assert.equal((await trilha(id, 'profile_update')).length, 0);
});
