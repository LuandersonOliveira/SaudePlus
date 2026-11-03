/**
 * ADR-0010 (E-24): atendente e admin só usam a API depois de ter o segundo fator ativo.
 *
 * Sem MFA, o login por senha emite uma sessão RESTRITA: o access token leva `mfa_setup: true` e
 * `verifyToken` responde 403 `MFA_SETUP_REQUIRED` a tudo, exceto a configuração do próprio segundo
 * fator (`/auth/mfa/setup`, `/auth/mfa/enable`), `/auth/me` e `/auth/logout`. Paciente segue opcional.
 * Quem perde o aparelho tem o MFA redefinido por um superadmin (com a senha dele) ou por terminal.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

const SERVER = path.resolve(__dirname, '..');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const pool = require('../src/db');
const bcrypt = require(require.resolve('bcryptjs', { paths: [SERVER] }));
const app = require('../src/app');
const { totpNow } = require('../src/utils/totp');
const { redefinirMfaPorEmail } = require('../scripts/mfa-reset');

const SENHA = 'Senha-Forte-123';
const USUARIOS = [];
let server;
let porta;

const chamar = async (method, rota, { token, cookie, body } = {}) => {
  const res = await fetch(`http://127.0.0.1:${porta}/api${rota}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: `saude_refresh=${cookie}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('saude_refresh='));
  return {
    status: res.status,
    body: await res.json().catch(() => ({})),
    refresh: setCookie ? decodeURIComponent(setCookie.split(';')[0].slice('saude_refresh='.length)) : null,
  };
};

async function conta({ role = 'paciente', nivel = null } = {}) {
  const id = crypto.randomUUID();
  const email = `mfa-${id}@test.local`;
  await pool.query(
    'INSERT INTO users (id, full_name, email, password_hash, role, admin_level, account_status) VALUES (?,?,?,?,?,?,?)',
    [id, 'Conta MFA', email, await bcrypt.hash(SENHA, 4), role, nivel, 'ativo']
  );
  USUARIOS.push(id);
  return { id, email, role };
}

const entrar = async (email) => {
  const r = await chamar('POST', '/auth/login', { body: { email, password: SENHA } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r;
};

/** Configura o MFA pela API e devolve o segredo e o token JÁ liberado (a resposta de /mfa/enable). */
async function ativarMfa(email) {
  const login = await entrar(email);
  const setup = await chamar('POST', '/auth/mfa/setup', { token: login.body.token, body: { password: SENHA } });
  assert.equal(setup.status, 200, JSON.stringify(setup.body));
  const enable = await chamar('POST', '/auth/mfa/enable', { token: login.body.token, body: { code: totpNow(setup.body.secret) } });
  assert.equal(enable.status, 200, JSON.stringify(enable.body));
  return { secret: setup.body.secret, token: enable.body.token, user: enable.body.user };
}

const linha = async (id) => (await pool.query('SELECT * FROM users WHERE id = ?', [id]))[0][0];

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  porta = server.address().port;
});
test.after(async () => {
  await new Promise((r) => server.close(r));
  for (const id of USUARIOS) {
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = ?', [id]).catch(() => {});
    await pool.query('DELETE FROM professionals WHERE user_id = ?', [id]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
  }
  await pool.end().catch(() => {});
});

// ---------------------------------------------------------------------------
// sessão restrita
// ---------------------------------------------------------------------------

test('login sem MFA: atendente e admin recebem sessão restrita; paciente não', async () => {
  const at = await conta({ role: 'atendente' });
  const ad = await conta({ role: 'admin', nivel: 'gestor' });
  const pa = await conta({ role: 'paciente' });
  assert.equal((await entrar(at.email)).body.user.mfa_setup, true);
  assert.equal((await entrar(ad.email)).body.user.mfa_setup, true);
  assert.ok(!(await entrar(pa.email)).body.user.mfa_setup, 'paciente não é obrigado');
});

test('sessão restrita: tudo dá 403 MFA_SETUP_REQUIRED, menos a configuração do MFA, /auth/me e logout', async () => {
  const at = await conta({ role: 'atendente' });
  const { body: { token } } = await entrar(at.email);

  for (const rota of ['/staff/waitlist', '/me/reminders', '/diseases', '/health-units']) {
    const r = await chamar('GET', rota, { token });
    assert.equal(r.status, 403, `${rota} deveria ser barrada`);
    assert.equal(r.body.code, 'MFA_SETUP_REQUIRED');
    assert.match(r.body.error, /segundo fator/i);
  }

  assert.equal((await chamar('GET', '/auth/me', { token })).status, 200);
  assert.equal((await chamar('POST', '/auth/mfa/setup', { token, body: { password: SENHA } })).status, 200);
  assert.equal((await chamar('POST', '/auth/logout', { token, body: {} })).status, 200);
});

test('sessão restrita de admin também é barrada nas rotas administrativas', async () => {
  const ad = await conta({ role: 'admin', nivel: 'superadmin' });
  const { body: { token } } = await entrar(ad.email);
  for (const rota of ['/admin/stats', '/admin/users']) {
    const r = await chamar('GET', rota, { token });
    assert.equal(r.status, 403, rota);
    assert.equal(r.body.code, 'MFA_SETUP_REQUIRED');
  }
});

test('paciente usa a API normalmente, sem MFA', async () => {
  const pa = await conta({ role: 'paciente' });
  const { body: { token } } = await entrar(pa.email);
  assert.equal((await chamar('GET', '/me/reminders', { token })).status, 200);
});

// ---------------------------------------------------------------------------
// ativar o MFA libera a sessão
// ---------------------------------------------------------------------------

test('mfa/enable devolve um token LIBERADO e a API passa a responder', async () => {
  const at = await conta({ role: 'atendente' });
  const { token, user } = await ativarMfa(at.email);
  assert.ok(token);
  assert.ok(!user.mfa_setup, 'o usuário devolvido não está mais restrito');
  assert.equal((await chamar('GET', '/staff/waitlist', { token })).status, 200);
  assert.equal(Number((await linha(at.id)).totp_enabled), 1);
});

test('com MFA ativo o login pede o segundo fator e a sessão sai liberada', async () => {
  const at = await conta({ role: 'atendente' });
  const { secret } = await ativarMfa(at.email);

  const l = await chamar('POST', '/auth/login', { body: { email: at.email, password: SENHA } });
  assert.equal(l.body.mfa_required, true);
  assert.equal(l.body.token, undefined, 'sem sessão antes do segundo fator');

  const v = await chamar('POST', '/auth/mfa/verify', { body: { ticket: l.body.mfa_ticket, code: totpNow(secret) } });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.ok(!v.body.user.mfa_setup);
  assert.equal((await chamar('GET', '/staff/waitlist', { token: v.body.token })).status, 200);
});

test('refresh mantém a marca enquanto não há MFA e a tira depois que há', async () => {
  const at = await conta({ role: 'atendente' });
  const login = await entrar(at.email);
  assert.ok(login.refresh);

  const r1 = await chamar('POST', '/auth/refresh', { cookie: login.refresh, body: {} });
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.equal(r1.body.user.mfa_setup, true, 'a renovação não pode liberar quem ainda não configurou o MFA');

  const setup = await chamar('POST', '/auth/mfa/setup', { token: r1.body.token, body: { password: SENHA } });
  await chamar('POST', '/auth/mfa/enable', { token: r1.body.token, body: { code: totpNow(setup.body.secret) } });
  const r2 = await chamar('POST', '/auth/refresh', { cookie: r1.refresh, body: {} });
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  assert.ok(!r2.body.user.mfa_setup);
});

// ---------------------------------------------------------------------------
// desativar
// ---------------------------------------------------------------------------

test('atendente e admin não desativam o próprio MFA; paciente continua podendo', async () => {
  const at = await conta({ role: 'atendente' });
  const { token } = await ativarMfa(at.email);
  const r = await chamar('POST', '/auth/mfa/disable', { token, body: { password: SENHA } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'O segundo fator é obrigatório para o seu perfil.');
  assert.equal(Number((await linha(at.id)).totp_enabled), 1, 'continua ativo');

  const pa = await conta({ role: 'paciente' });
  const pl = await entrar(pa.email);
  const s = await chamar('POST', '/auth/mfa/setup', { token: pl.body.token, body: { password: SENHA } });
  await chamar('POST', '/auth/mfa/enable', { token: pl.body.token, body: { code: totpNow(s.body.secret) } });
  assert.equal((await chamar('POST', '/auth/mfa/disable', { token: pl.body.token, body: { password: SENHA } })).status, 200);
});

// ---------------------------------------------------------------------------
// redefinição pelo superadmin
// ---------------------------------------------------------------------------

async function superadminComMfa() {
  const sa = await conta({ role: 'admin', nivel: 'superadmin' });
  const { token } = await ativarMfa(sa.email);
  return { ...sa, token };
}

test('superadmin redefine o MFA de um atendente: zera o segredo, derruba as sessões e audita', async () => {
  const sa = await superadminComMfa();
  const at = await conta({ role: 'atendente' });
  const { secret } = await ativarMfa(at.email);
  assert.ok(secret);
  const sessao = await chamar('POST', '/auth/mfa/verify', { body: {
    ticket: (await chamar('POST', '/auth/login', { body: { email: at.email, password: SENHA } })).body.mfa_ticket,
    code: totpNow(secret, Date.now() + 30_000),
  } });
  assert.equal(sessao.status, 200, JSON.stringify(sessao.body));

  const r = await chamar('POST', `/admin/users/${at.id}/mfa/reset`, { token: sa.token, body: { password: SENHA } });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  const depois = await linha(at.id);
  assert.equal(Number(depois.totp_enabled), 0);
  assert.equal(depois.totp_secret, null);
  const [[vivos]] = await pool.query('SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id = ? AND revoked = 0', [at.id]);
  assert.equal(Number(vivos.n), 0, 'as sessões do atendente caem');

  const [[trilha]] = await pool.query(
    "SELECT actor_id, details FROM audit_log WHERE action = 'mfa_reset' AND entity_id = ? ORDER BY seq DESC LIMIT 1",
    [at.id]
  );
  assert.equal(trilha.actor_id, sa.id);
  assert.equal(trilha.details, 'segundo fator redefinido (role=atendente)');

  assert.equal((await entrar(at.email)).body.user.mfa_setup, true, 'no próximo login, volta a configurar o MFA');
});

test('redefinição recusa: senha errada (401), gestor sem a capability (403), conta própria, paciente e inexistente', async () => {
  const sa = await superadminComMfa();
  const at = await conta({ role: 'atendente' });
  await ativarMfa(at.email);

  const errada = await chamar('POST', `/admin/users/${at.id}/mfa/reset`, { token: sa.token, body: { password: 'senha-errada-999' } });
  assert.equal(errada.status, 401);
  assert.equal(Number((await linha(at.id)).totp_enabled), 1, 'nada muda com a senha errada');

  const gestor = await conta({ role: 'admin', nivel: 'gestor' });
  const g = await ativarMfa(gestor.email);
  assert.equal((await chamar('POST', `/admin/users/${at.id}/mfa/reset`, { token: g.token, body: { password: SENHA } })).status, 403);

  const propria = await chamar('POST', `/admin/users/${sa.id}/mfa/reset`, { token: sa.token, body: { password: SENHA } });
  assert.equal(propria.status, 400);

  const pa = await conta({ role: 'paciente' });
  assert.equal((await chamar('POST', `/admin/users/${pa.id}/mfa/reset`, { token: sa.token, body: { password: SENHA } })).status, 400);

  assert.equal((await chamar('POST', `/admin/users/${crypto.randomUUID()}/mfa/reset`, { token: sa.token, body: { password: SENHA } })).status, 404);
});

// ---------------------------------------------------------------------------
// redefinição por terminal (superadmin que perdeu o aparelho)
// ---------------------------------------------------------------------------

test('terminal: simulação não muda nada; --apply zera o MFA, derruba sessões e audita', async () => {
  const sa = await conta({ role: 'admin', nivel: 'superadmin' });
  await ativarMfa(sa.email);

  const seco = await redefinirMfaPorEmail(pool, sa.email);
  assert.equal(seco.ok, true);
  assert.equal(seco.aplicado, false);
  assert.equal(Number((await linha(sa.id)).totp_enabled), 1, 'simulação não altera');

  const r = await redefinirMfaPorEmail(pool, sa.email, { apply: true });
  assert.equal(r.aplicado, true);
  const depois = await linha(sa.id);
  assert.equal(Number(depois.totp_enabled), 0);
  assert.equal(depois.totp_secret, null);
  const [[vivos]] = await pool.query('SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id = ? AND revoked = 0', [sa.id]);
  assert.equal(Number(vivos.n), 0);
  const [[trilha]] = await pool.query("SELECT actor_id, details FROM audit_log WHERE action = 'mfa_reset_terminal' AND entity_id = ?", [sa.id]);
  assert.equal(trilha.actor_id, sa.id);
  assert.equal(trilha.details, 'segundo fator redefinido por terminal (role=admin)');
});

test('terminal: e-mail desconhecido ou conta de paciente não é redefinido', async () => {
  assert.equal((await redefinirMfaPorEmail(pool, `ninguem-${crypto.randomUUID()}@test.local`, { apply: true })).ok, false);
  const pa = await conta({ role: 'paciente' });
  const r = await redefinirMfaPorEmail(pool, pa.email, { apply: true });
  assert.equal(r.ok, false);
  assert.match(r.erro, /atendente e admin/);
});
