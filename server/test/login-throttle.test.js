/**
 * Proteção contra força bruta no login.
 *
 * Antes: a chave do Map era só o IP. Atrás de nginx/Cloudflare/IIS — a única
 * forma sensata de subir isto — `req.ip` é o IP do PROXY para toda requisição.
 * Cinco logins errados de qualquer origem travavam a rede inteira por 5
 * minutos, e todo mundo recebia 429 "Muitas tentativas de login".
 *
 * Agora a chave é `ip|e-mail`: um ataque contra uma conta não derruba a rede,
 * e uma conta sob ataque não abre a porta para todo mundo atrás do mesmo
 * proxy. O limite global por IP continua no express-rate-limit.
 *
 * Além disso o Map era ilimitado — um spray de IP de origem o crescia sem
 * parar pelo tempo de vida do processo. Aqui ele é varrido e tem teto.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  loginKey,
  loginBlockInfo,
  registerLoginFailure,
  registerLoginSuccess,
  sweep,
  LIMITE_ENTRADAS,
} = require('../src/utils/loginThrottle');

const JANELA = 5 * 60 * 1000;
const MAX = 5;

function novo() {
  return new Map();
}

test('a chave normaliza e-mail e não devolve vazio para IP ausente', () => {
  assert.equal(loginKey('10.0.0.1', '  Admin@Saude.App '), '10.0.0.1|admin@saude.app');
  assert.equal(loginKey('::1', undefined), '::1|');
  assert.equal(loginKey(undefined, undefined), 'desconhecido|');
});

test('a chave separa contas diferentes no mesmo IP', () => {
  const m = novo();
  for (let i = 0; i < MAX; i += 1) registerLoginFailure(m, loginKey('10.0.0.1', 'a@saude.app'), Date.now());
  // A conta A está bloqueada; a conta B, no MESMO IP, não pode estar.
  assert.ok(loginBlockInfo(m, loginKey('10.0.0.1', 'a@saude.app'), Date.now()));
  assert.equal(
    loginBlockInfo(m, loginKey('10.0.0.1', 'b@saude.app'), Date.now()),
    null,
    'bloquear a conta A não pode bloquear a conta B atrás do mesmo proxy'
  );
});

test('a chave separa IPs diferentes na mesma conta', () => {
  const m = novo();
  const agora = Date.now();
  for (let i = 0; i < MAX; i += 1) {
    registerLoginFailure(m, loginKey('10.0.0.1', 'a@saude.app'), agora);
  }
  assert.ok(loginBlockInfo(m, loginKey('10.0.0.1', 'a@saude.app'), agora));
  assert.equal(
    loginBlockInfo(m, loginKey('10.0.0.2', 'a@saude.app'), agora),
    null,
    'a conta continua acessível a partir de outra origem'
  );
});

test('bloqueia depois de MAX falhas e libera quando a janela passa', () => {
  const m = novo();
  const chave = loginKey('10.0.0.1', 'a@saude.app');
  const t0 = 1_000_000;

  for (let i = 1; i < MAX; i += 1) {
    registerLoginFailure(m, chave, t0);
    assert.equal(loginBlockInfo(m, chave, t0), null, `ainda não deve bloquear na falha ${i}`);
  }
  registerLoginFailure(m, chave, t0);
  assert.ok(loginBlockInfo(m, chave, t0), 'a MAXª falha bloqueia');

  assert.ok(loginBlockInfo(m, chave, t0 + JANELA - 1), 'continua bloqueado dentro da janela');
  assert.equal(loginBlockInfo(m, chave, t0 + JANELA + 1), null, 'liberado depois da janela');
});

test('login com sucesso limpa a entrada', () => {
  const m = novo();
  const chave = loginKey('10.0.0.1', 'a@saude.app');
  registerLoginFailure(m, chave, 1000);
  registerLoginSuccess(m, chave);
  assert.equal(m.size, 0);
});

test('sweep remove as entradas expiradas', () => {
  const m = novo();
  const t0 = 1_000_000;
  registerLoginFailure(m, loginKey('1.1.1.1', 'velha@saude.app'), t0);
  registerLoginFailure(m, loginKey('2.2.2.2', 'nova@saude.app'), t0 + JANELA);
  assert.equal(m.size, 2);

  sweep(m, t0 + JANELA + 1);
  assert.equal(m.size, 1, 'a entrada antiga tem que ter sumido');
  assert.ok(m.has(loginKey('2.2.2.2', 'nova@saude.app')));
});

test('registerLoginFailure varre antes de inserir e respeita o teto', () => {
  const m = novo();
  const t0 = 1_000_000;
  // Enche acima do teto: o Map não pode crescer sem limite em /auth/login.
  for (let i = 0; i < LIMITE_ENTRADAS + 50; i += 1) {
    registerLoginFailure(m, loginKey(`10.0.${i >> 8}.${i & 255}`, `u${i}@saude.app`), t0);
  }
  assert.ok(
    m.size <= LIMITE_ENTRADAS,
    `Map com ${m.size} entradas, teto é ${LIMITE_ENTRADAS}`
  );
});

test('uma entrada bloqueada não é varrida pelo sweep', () => {
  const m = novo();
  const chave = loginKey('10.0.0.1', 'a@saude.app');
  const t0 = 1_000_000;
  for (let i = 0; i < MAX; i += 1) registerLoginFailure(m, chave, t0);
  assert.ok(loginBlockInfo(m, chave, t0));

  sweep(m, t0 + 1000);
  assert.ok(
    loginBlockInfo(m, chave, t0 + 1000),
    'sweep não pode liberar um bloqueio em vigor'
  );
});

// ---------------------------------------------------------------------------
// Integração: a chave por conta precisa valer no app real, não só na unidade.
// O setup fica em before/after — é o padrão que fecha limpo em node:test.
// ---------------------------------------------------------------------------

let app;
let server;
let url;
let pool;
const alvos = [];

const tryLogin = (email, senha) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: senha }),
  });

test.before(async () => {
  const path = require('node:path');
  const crypto = require('node:crypto');
  const SERVER = path.resolve(__dirname, '..');
  require(require.resolve('dotenv', { paths: [SERVER] })).config({
    path: path.join(SERVER, '.env'),
  });
  pool = require('../src/db');
  const bcrypt = require(require.resolve('bcryptjs', { paths: [SERVER] }));
  app = require('../src/app');

  // Idempotente: uma execução abortada deixa usuários para trás e a
  // próxima falha com ER_DUP_ENTRY em vez do que está sendo testado.
  await pool.query("DELETE FROM users WHERE email IN (?,?)", [
    'alvo@throttle.local',
    'vizinho@throttle.local',
  ]);
  for (const email of ['alvo@throttle.local', 'vizinho@throttle.local']) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, full_name, email, password_hash, role, account_status)
       VALUES (?,?,?,?,?,?)`,
      [id, 'Alvo', email, await bcrypt.hash('senha-certa-123', 4), 'paciente', 'ativo']
    );
    alvos.push({ id, email });
  }

  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  url = `http://127.0.0.1:${server.address().port}/auth/login`;
});

test.after(async () => {
  // Ordem importa: derruba o servidor (e as keep-alive dele) ANTES de
  // devolver as conexões, senão o processo de node:test não encerra.
  if (server) {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  for (const a of alvos) await pool.query('DELETE FROM users WHERE id = ?', [a.id]).catch(() => {});
  if (pool) await pool.end().catch(() => {});
});

test('bloquear uma conta não devolve 429 para outra conta do mesmo IP', async () => {
  for (let i = 0; i < MAX; i += 1) {
    await tryLogin(alvos[0].email, 'senha-errada');
  }
  const bloqueada = await tryLogin(alvos[0].email, 'senha-certa-123');
  assert.equal(bloqueada.status, 429, 'a conta sob ataque tem que ficar bloqueada');

  // Este é o ponto: mesma origem, conta diferente, não pode herdar o bloqueio.
  const vizinha = await tryLogin(alvos[1].email, 'senha-certa-123');
  assert.equal(
    vizinha.status,
    200,
    'outra conta no mesmo IP foi bloqueada junto — a chave ainda é só por IP'
  );
});

test('a rota de login usa a chave ip|e-mail, não só o IP', () => {
  // Trava o contrato no código: uma volta para chave só por IP e o teste de
  // integração passa a falhar por um caminho que ele não explica.
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'auth.routes.js'), 'utf8');
  assert.match(src, /loginKey\(clientIp\(req\),\s*normalizedEmail\)/);
  assert.match(src, /registerLoginSuccess\(loginAttempts,\s*chave\)/);
});