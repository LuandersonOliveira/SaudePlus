/**
 * services/passwordReset.js (A1, passo 4): as regras sem passar por HTTP.
 * O contrato HTTP (resposta fixa, link /auth?tab=reset) segue em password-reset.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

const SERVER = path.resolve(__dirname, '..');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const pool = require('../src/db');
const bcrypt = require(require.resolve('bcryptjs', { paths: [SERVER] }));
const mailer = require('../src/services/mailer');
const { solicitarRedefinicao, redefinirSenha, LINK_INVALIDO } = require('../src/services/passwordReset');
const { issueRefreshToken, hashRefreshToken } = require('../src/services/session');

const SENHA = 'senha-antiga-123';
const CRIADOS = [];
const enviados = [];
const enviarOriginal = mailer.enviar;

test.before(() => {
  mailer.enviar = async (msg) => { enviados.push(msg); return { enviado: true }; };
});
test.after(async () => {
  mailer.enviar = enviarOriginal;
  for (const id of CRIADOS) await pool.query('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
  await pool.end().catch(() => {});
});

async function usuario(status = 'ativo') {
  const id = crypto.randomUUID();
  const email = `pwd-${id}@test.local`;
  await pool.query(
    "INSERT INTO users (id, full_name, email, password_hash, role, account_status) VALUES (?,?,?,?, 'paciente', ?)",
    [id, 'Titular Teste', email, await bcrypt.hash(SENHA, 4), status]
  );
  CRIADOS.push(id);
  return { id, email };
}
const tokenDoEmail = (msg) => /token=([0-9a-f]{64})/.exec(msg.texto)[1];
const linhas = async (userId) => (await pool.query('SELECT * FROM password_reset_tokens WHERE user_id = ?', [userId]))[0];

test('solicitarRedefinicao: e-mail vazio/inválido, inexistente ou conta desativada → nada é criado nem enviado', async () => {
  enviados.length = 0;
  const inativo = await usuario('inativo');
  for (const e of [undefined, '', '   ', 'sem-arroba', `naoexiste-${crypto.randomUUID()}@test.local`, inativo.email]) {
    assert.deepEqual(await solicitarRedefinicao(e), { enviado: false }, String(e));
  }
  assert.equal(enviados.length, 0);
  assert.equal((await linhas(inativo.id)).length, 0);
});

test('solicitarRedefinicao: conta ativa recebe link; o banco guarda só o SHA-256 do token', async () => {
  enviados.length = 0;
  const u = await usuario();
  const r = await solicitarRedefinicao(`  ${u.email.toUpperCase()} `); // normaliza caixa e espaços
  assert.equal(r.enviado, true);
  assert.equal(r.userId, u.id);
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].para, u.email);
  assert.match(enviados[0].texto, /\/auth\?tab=reset&token=[0-9a-f]{64}/);

  const raw = tokenDoEmail(enviados[0]);
  const [linha] = await linhas(u.id);
  assert.equal(linha.token_hash, hashRefreshToken(raw));
  assert.notEqual(linha.token_hash, raw, 'o token em claro nunca vai para o banco');
  assert.ok(new Date(linha.expires_at).getTime() > Date.now());
});

test('solicitarRedefinicao: um pedido novo invalida o anterior', async () => {
  enviados.length = 0;
  const u = await usuario();
  await solicitarRedefinicao(u.email);
  await solicitarRedefinicao(u.email);
  const [velho, novo] = [tokenDoEmail(enviados[0]), tokenDoEmail(enviados[1])];
  assert.deepEqual(await redefinirSenha({ token: velho, password: 'nova-senha-1' }), { ok: false, status: 401, error: LINK_INVALIDO });
  assert.equal((await redefinirSenha({ token: novo, password: 'nova-senha-1' })).ok, true);
});

test('redefinirSenha: ausente → 401; senha curta ou de tipo errado → 400 SEM consumir o link', async () => {
  enviados.length = 0;
  const u = await usuario();
  await solicitarRedefinicao(u.email);
  const token = tokenDoEmail(enviados[0]);

  assert.equal((await redefinirSenha({ password: 'abcdef' })).status, 401);
  assert.equal((await redefinirSenha({ token })).status, 401);
  assert.equal((await redefinirSenha({ token: 'nao-existe', password: 'abcdef' })).status, 401);

  const curta = await redefinirSenha({ token, password: '123' });
  assert.deepEqual([curta.status, curta.error], [400, 'A senha precisa ter pelo menos 6 caracteres.']);
  assert.equal((await redefinirSenha({ token, password: 123456789 })).status, 400);

  const ok = await redefinirSenha({ token, password: 'senha-nova-456' });
  assert.equal(ok.ok, true, 'o link continuava válido depois das recusas por validação');
});

test('redefinirSenha: troca a senha, derruba as sessões abertas e o link é de uso único', async () => {
  enviados.length = 0;
  const u = await usuario();
  const sessao = await issueRefreshToken(u.id);
  await solicitarRedefinicao(u.email);
  const token = tokenDoEmail(enviados[0]);

  const r = await redefinirSenha({ token, password: 'senha-nova-456' });
  assert.deepEqual(r, { ok: true, userId: u.id });

  const [[row]] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [u.id]);
  assert.equal(await bcrypt.compare('senha-nova-456', row.password_hash), true);
  assert.equal(await bcrypt.compare(SENHA, row.password_hash), false);

  const [[rt]] = await pool.query('SELECT revoked FROM refresh_tokens WHERE token_hash = ?', [hashRefreshToken(sessao.raw)]);
  assert.equal(Number(rt.revoked), 1, 'refresh token aberto precisa cair');

  assert.deepEqual(await redefinirSenha({ token, password: 'outra-senha-789' }), { ok: false, status: 401, error: LINK_INVALIDO });
});

test('redefinirSenha: link vencido → 401; dois usos simultâneos → só um vence', async () => {
  enviados.length = 0;
  const u = await usuario();
  await solicitarRedefinicao(u.email);
  const vencido = tokenDoEmail(enviados[0]);
  await pool.query('UPDATE password_reset_tokens SET expires_at = ? WHERE user_id = ?', [new Date(Date.now() - 1000), u.id]);
  assert.equal((await redefinirSenha({ token: vencido, password: 'senha-nova-456' })).status, 401);

  const v = await usuario();
  await solicitarRedefinicao(v.email);
  const token = tokenDoEmail(enviados[1]);
  const resultados = await Promise.all([1, 2, 3, 4].map((i) => redefinirSenha({ token, password: `senha-nova-${i}-xyz` })));
  assert.equal(resultados.filter((r) => r.ok).length, 1);
  assert.ok(resultados.filter((r) => !r.ok).every((r) => r.status === 401));
});
