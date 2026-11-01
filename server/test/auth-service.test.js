/**
 * services/auth.js (A1, passo 6) + cookie de refresh pelo ponto de montagem.
 * O contrato HTTP segue em api.test, login-throttle, cpf-hmac, refresh-prazo e mfa-*.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

const SERVER = path.resolve(__dirname, '..');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

// Gov.br falso: troca as funções ANTES de carregar serviço e app.
let perfilGovbr = {};
const govbr = require('../src/services/govbr');
govbr.exchangeCode = async () => ({ access_token: 'token-falso' });
govbr.fetchUserInfo = async () => perfilGovbr;

const pool = require('../src/db');
const app = require('../src/app');
const bcrypt = require(require.resolve('bcryptjs', { paths: [SERVER] }));
const jwt = require(require.resolve('jsonwebtoken', { paths: [SERVER] }));
const { cadastrar, autenticar, entrarComGovbr, loginAttempts } = require('../src/services/auth');
const { encryptField, decryptField } = require('../src/utils/crypto');
const { hmacCpf } = require('../src/utils/cpf');
const { randomSecret } = require('../src/utils/totp');
const { cookiePath } = require('../src/services/session');

const SENHA = 'senha-de-teste-123';
const CRIADOS = [];
let hash;
let server;
let base;

test.before(async () => {
  hash = await bcrypt.hash(SENHA, 4);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((r) => server.close(r));
  for (const id of CRIADOS) await pool.query('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
  await pool.end().catch(() => {});
});

function cpfUnico() {
  const dig = (n) => { const r = (n.reduce((a, d, i) => a + d * (n.length + 1 - i), 0) * 10) % 11; return r === 10 ? 0 : r; };
  const n = [...String(crypto.randomInt(100000000, 999999999))].map(Number);
  n.push(dig(n)); n.push(dig(n));
  return n.join('');
}
let ipSeq = 0;
const ipNovo = () => `10.9.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`; // evita o limite por IP entre testes

async function usuario({ status = 'ativo', mfa = false, cpf = null } = {}) {
  const id = crypto.randomUUID();
  const email = `authsvc-${id}@test.local`;
  await pool.query(
    "INSERT INTO users (id, full_name, email, password_hash, role, account_status, totp_secret, totp_enabled, cpf, cpf_hmac) VALUES (?,?,?,?, 'paciente', ?, ?, ?, ?, ?)",
    [id, 'Auth Svc', email, hash, status, mfa ? randomSecret() : null, mfa ? 1 : 0, cpf ? encryptField(cpf) : null, cpf ? hmacCpf(cpf) : null]
  );
  CRIADOS.push(id);
  return { id, email };
}
const corpoCadastro = (extra = {}) => ({
  email: `Cad-${crypto.randomUUID()}@Test.Local`, password: SENHA, full_name: 'Cadastro Svc',
  birth_date: '1990-05-10', cpf: cpfUnico(), ...extra,
});

// ---------------------------------------------------------------------------
// cadastrar
// ---------------------------------------------------------------------------

test('cadastrar: grava normalizado e cifrado, com consentimento e IP', async () => {
  const corpo = corpoCadastro({ rg: ' 123456 ', priority: 'idoso' });
  const r = await cadastrar(corpo, { encrypt: encryptField, ip: '203.0.113.7' });
  assert.equal(r.ok, true);
  assert.equal(r.message, null);
  CRIADOS.push(r.id);
  const [[u]] = await pool.query('SELECT * FROM users WHERE id = ?', [r.id]);
  assert.equal(u.email, corpo.email.toLowerCase());
  assert.equal(u.role, 'paciente');
  assert.equal(u.account_status, 'ativo');
  assert.equal(u.priority, 'idoso');
  assert.equal(await bcrypt.compare(SENHA, u.password_hash), true);
  assert.equal(decryptField(u.cpf), corpo.cpf);
  assert.equal(u.cpf_hmac, hmacCpf(corpo.cpf));
  assert.equal(decryptField(u.rg), '123456');
  assert.equal(u.consent_ip, '203.0.113.7');
  assert.ok(u.consent_at && u.privacy_version);
});

test('cadastrar: atendente nasce pendente e com cargo; paciente ignora o cargo; papel desconhecido vira paciente', async () => {
  const a = await cadastrar(corpoCadastro({ role: 'atendente', job_role: 'Recepção' }), { encrypt: encryptField, ip: 'x' });
  CRIADOS.push(a.id);
  assert.match(a.message, /Aguarde a ativação/);
  const [[ua]] = await pool.query('SELECT account_status, job_role FROM users WHERE id = ?', [a.id]);
  assert.deepEqual([ua.account_status, ua.job_role], ['pendente', 'Recepção']);

  const p = await cadastrar(corpoCadastro({ role: 'admin', job_role: 'Chefe' }), { encrypt: encryptField, ip: 'x' });
  CRIADOS.push(p.id);
  const [[up]] = await pool.query('SELECT role, job_role FROM users WHERE id = ?', [p.id]);
  assert.deepEqual([up.role, up.job_role], ['paciente', null], 'não dá para se cadastrar como admin');
});

test('cadastrar: e-mail ou CPF repetido → 409 com mensagem própria', async () => {
  const corpo = corpoCadastro();
  const ok = await cadastrar(corpo, { encrypt: encryptField, ip: 'x' });
  CRIADOS.push(ok.id);
  const mesmoEmail = await cadastrar({ ...corpoCadastro(), email: corpo.email.toUpperCase() }, { encrypt: encryptField, ip: 'x' });
  assert.deepEqual([mesmoEmail.ok, mesmoEmail.status, mesmoEmail.error], [false, 409, 'Este e-mail já está cadastrado.']);
  const mesmoCpf = await cadastrar(corpoCadastro({ cpf: corpo.cpf }), { encrypt: encryptField, ip: 'x' });
  assert.deepEqual([mesmoCpf.status, mesmoCpf.error], [409, 'CPF já cadastrado. Entre na conta existente ou recupere a senha.']);
});

test('cadastrar: menores sem CPF (só CNS) convivem — NULL não colide no UNIQUE do cpf_hmac', async () => {
  const crianca = (nome) => ({
    email: `menor-${crypto.randomUUID()}@test.local`, password: SENHA, full_name: nome,
    birth_date: `${new Date().getFullYear() - 7}-03-01`, guardian_name: 'Responsável Legal', cns: '898001234567891',
  });
  const a = await cadastrar(crianca('Criança A'), { encrypt: encryptField, ip: 'x' });
  const b = await cadastrar(crianca('Criança B'), { encrypt: encryptField, ip: 'x' });
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal(b.ok, true, 'a segunda criança sem CPF não é barrada como duplicata');
  CRIADOS.push(a.id, b.id);
  const [[u]] = await pool.query('SELECT cpf, cpf_hmac, cns, guardian_name FROM users WHERE id = ?', [a.id]);
  assert.equal(u.cpf, null);
  assert.equal(u.cpf_hmac, null);
  assert.equal(decryptField(u.cns), '898001234567891', 'o CNS fica cifrado, como sempre');
  assert.equal(u.guardian_name, 'Responsável Legal');
});

// ---------------------------------------------------------------------------
// autenticar
// ---------------------------------------------------------------------------

test('autenticar: sucesso devolve payload sem MFA e registra o acesso', async () => {
  const u = await usuario();
  const r = await autenticar({ email: u.email.toUpperCase(), password: SENHA, ip: ipNovo() });
  assert.equal(r.ok, true);
  assert.equal(r.mfaRequired, false);
  assert.equal(r.userId, u.id);
  assert.equal(r.payload.email, u.email);
  assert.ok(!('password_hash' in r.payload));
  const [[row]] = await pool.query('SELECT last_login_at FROM users WHERE id = ?', [u.id]);
  assert.ok(row.last_login_at);
});

test('autenticar: com MFA ativo devolve ticket de 5 min, não sessão', async () => {
  const u = await usuario({ mfa: true });
  const r = await autenticar({ email: u.email, password: SENHA, ip: ipNovo() });
  assert.equal(r.mfaRequired, true);
  const claim = jwt.verify(r.ticket, process.env.JWT_SECRET);
  assert.deepEqual([claim.id, claim.purpose], [u.id, 'mfa']);
  assert.ok(claim.exp - claim.iat <= 300);
});

test('autenticar: senha errada e e-mail inexistente dão a mesma resposta', async () => {
  const u = await usuario();
  const ip = ipNovo();
  const errada = await autenticar({ email: u.email, password: 'errada', ip });
  const inexistente = await autenticar({ email: `x-${u.id}@test.local`, password: SENHA, ip });
  assert.deepEqual([errada.status, errada.error], [401, 'Credenciais inválidas.']);
  assert.deepEqual([inexistente.status, inexistente.error], [401, 'Credenciais inválidas.']);
});

test('autenticar: conta pendente ou desativada → 403 que NÃO conta como tentativa', async () => {
  const pend = await usuario({ status: 'pendente' });
  const inat = await usuario({ status: 'inativo' });
  const ip = ipNovo();
  for (let i = 0; i < 8; i += 1) assert.equal((await autenticar({ email: pend.email, password: SENHA, ip })).status, 403);
  assert.match((await autenticar({ email: pend.email, password: SENHA, ip })).error, /aguardando ativação/);
  assert.match((await autenticar({ email: inat.email, password: SENHA, ip })).error, /desativada/);
});

test('autenticar: excesso de senhas erradas bloqueia (429) só aquele IP+conta', async () => {
  const alvo = await usuario();
  const outra = await usuario();
  const ip = ipNovo();
  let status;
  for (let i = 0; i < 12 && status !== 429; i += 1) status = (await autenticar({ email: alvo.email, password: 'errada', ip })).status;
  assert.equal(status, 429);
  const bloqueado = await autenticar({ email: alvo.email, password: SENHA, ip });
  assert.equal(bloqueado.status, 429);
  assert.match(bloqueado.error, /Tente novamente em \d+ minuto/);
  assert.equal((await autenticar({ email: outra.email, password: SENHA, ip })).ok, true, 'outra conta no mesmo IP segue livre');
  assert.equal((await autenticar({ email: alvo.email, password: SENHA, ip: ipNovo() })).ok, true, 'outro IP segue livre');
  assert.ok(loginAttempts.size > 0);
});

// ---------------------------------------------------------------------------
// entrarComGovbr
// ---------------------------------------------------------------------------

test('entrarComGovbr: acha por sub, depois por e-mail, depois por CPF (com máscara) e grava o sub', async () => {
  const cpf = cpfUnico();
  const u = await usuario({ cpf });
  const sub = `sub-${crypto.randomUUID()}`;
  perfilGovbr = { sub, cpf: `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`, nome: 'Fulano' };
  const porCpf = await entrarComGovbr({ code: 'abc', decrypt: decryptField });
  assert.equal(porCpf.ok, true);
  assert.equal(porCpf.userId, u.id);
  assert.equal((await pool.query('SELECT govbr_sub FROM users WHERE id = ?', [u.id]))[0][0].govbr_sub, sub);

  perfilGovbr = { sub, cpf: cpfUnico() }; // agora o sub já está vinculado: CPF nem é consultado
  assert.equal((await entrarComGovbr({ code: 'abc', decrypt: decryptField })).userId, u.id);

  const v = await usuario();
  perfilGovbr = { sub: `sub-${crypto.randomUUID()}`, email: v.email };
  assert.equal((await entrarComGovbr({ code: 'abc', decrypt: decryptField })).userId, v.id);
});

test('entrarComGovbr: sem sub → 502; sem vínculo → 404 com perfil; conta desativada → 403; MFA → ticket', async () => {
  perfilGovbr = {};
  assert.equal((await entrarComGovbr({ code: 'abc', decrypt: decryptField })).status, 502);

  perfilGovbr = { sub: `sub-${crypto.randomUUID()}`, cpf: cpfUnico(), email: `ninguem-${crypto.randomUUID()}@test.local`, nome: 'Ninguém', telefone: '8799' };
  const semVinculo = await entrarComGovbr({ code: 'abc', decrypt: decryptField });
  assert.equal(semVinculo.status, 404);
  assert.equal(semVinculo.govbr_profile.nome, 'Ninguém');
  assert.equal(semVinculo.govbr_profile.telefone, '8799');

  const inativo = await usuario({ status: 'inativo' });
  perfilGovbr = { sub: `sub-${crypto.randomUUID()}`, email: inativo.email };
  assert.equal((await entrarComGovbr({ code: 'abc', decrypt: decryptField })).status, 403);

  const comMfa = await usuario({ mfa: true });
  perfilGovbr = { sub: `sub-${crypto.randomUUID()}`, email: comMfa.email };
  const r = await entrarComGovbr({ code: 'abc', decrypt: decryptField });
  assert.equal(r.mfaRequired, true);
  assert.ok(r.ticket);
});

// ---------------------------------------------------------------------------
// Cookie de refresh: o path segue o ponto de montagem
// ---------------------------------------------------------------------------

test('cookiePath: usa o ponto de montagem do roteador; sem requisição ou valor estranho, o padrão', () => {
  assert.equal(cookiePath({ req: { baseUrl: '/api/auth' } }), '/api/auth');
  assert.equal(cookiePath({ req: { baseUrl: '/auth' } }), '/auth');
  assert.equal(cookiePath({}), '/auth');
  assert.equal(cookiePath(undefined), '/auth');
  assert.equal(cookiePath({ req: { baseUrl: '' } }), '/auth');
  assert.equal(cookiePath({ req: { baseUrl: '/a;Path=/' } }), '/auth', 'valor com caractere de atributo não vira cookie');
});

test('o Set-Cookie do login leva o Path de onde a API foi chamada (/auth e /api/auth)', async () => {
  const u = await usuario();
  for (const prefixo of ['/auth', '/api/auth']) {
    const res = await fetch(`${base}${prefixo}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: u.email, password: SENHA }),
    });
    assert.equal(res.status, 200, prefixo);
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('saude_refresh='));
    assert.ok(cookie, `sem cookie em ${prefixo}`);
    assert.match(cookie, new RegExp(`Path=${prefixo};`, 'i'));
    assert.match(cookie, /HttpOnly/i);
  }
});

test('logout limpa o cookie no mesmo Path em que ele foi gravado', async () => {
  const res = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 200);
  const limpo = res.headers.getSetCookie().find((c) => c.startsWith('saude_refresh='));
  assert.match(limpo, /Path=\/api\/auth;/i);
});
