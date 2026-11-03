/**
 * services/mfa.js (A1, passo 3): as regras do segundo fator sem passar por HTTP.
 * Os testes de rota (mfa-setup, mfa-replay-http, race/mfa-replay-race) cobrem o contrato HTTP.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

const SERVER = path.resolve(__dirname, '..');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const pool = require('../src/db');
const jwt = require(require.resolve('jsonwebtoken', { paths: [SERVER] }));
const bcrypt = require(require.resolve('bcryptjs', { paths: [SERVER] }));
const {
  criarTicketMfa, verificarSegundoFator, iniciarCadastroMfa, ativarMfa, desativarMfa,
} = require('../src/services/mfa');
const { randomSecret, totpNow } = require('../src/utils/totp');
const { encryptField, decryptField } = require('../src/utils/crypto');

const SENHA = 'senha-de-teste-123';
const CRIADOS = [];
let hash;

test.before(async () => { hash = await bcrypt.hash(SENHA, 4); });
test.after(async () => {
  for (const id of CRIADOS) await pool.query('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
  await pool.end().catch(() => {});
});

async function usuario({ mfa = false, status = 'ativo' } = {}) {
  const id = crypto.randomUUID();
  const secret = mfa ? randomSecret() : null;
  await pool.query(
    "INSERT INTO users (id, full_name, email, password_hash, role, account_status, totp_secret, totp_enabled) VALUES (?,?,?,?, 'paciente', ?, ?, ?)",
    [id, 'MFA Svc', `mfasvc-${id}@test.local`, hash, status, secret, mfa ? 1 : 0]
  );
  CRIADOS.push(id);
  return { id, secret, email: `mfasvc-${id}@test.local` };
}

test('verificarSegundoFator: ticket ruim, expirado ou de outro propósito', async () => {
  const lixo = await verificarSegundoFator({ ticket: 'abc', code: '000000' });
  assert.deepEqual([lixo.ok, lixo.status, lixo.error], [false, 401, 'Sessão MFA expirada. Entre novamente.']);

  const outro = jwt.sign({ id: 'x', purpose: 'acesso' }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const r = await verificarSegundoFator({ ticket: outro, code: '000000' });
  assert.deepEqual([r.status, r.error], [401, 'Ticket inválido.']);

  const venceu = jwt.sign({ id: 'x', purpose: 'mfa' }, process.env.JWT_SECRET, { expiresIn: -10 });
  assert.equal((await verificarSegundoFator({ ticket: venceu, code: '1' })).status, 401);
});

test('verificarSegundoFator: usuário sem MFA, inexistente ou desativado → "Verificação indisponível."', async () => {
  const semMfa = await usuario();
  const inativo = await usuario({ mfa: true, status: 'inativo' });
  for (const id of [semMfa.id, inativo.id, crypto.randomUUID()]) {
    const r = await verificarSegundoFator({ ticket: criarTicketMfa(id), code: '123456' });
    assert.deepEqual([r.ok, r.status, r.error], [false, 401, 'Verificação indisponível.']);
  }
});

test('verificarSegundoFator: código certo entrega o payload; o mesmo código de novo é replay', async () => {
  const u = await usuario({ mfa: true });
  const codigo = totpNow(u.secret);
  const r1 = await verificarSegundoFator({ ticket: criarTicketMfa(u.id), code: codigo });
  assert.equal(r1.ok, true);
  assert.equal(r1.payload.id, u.id);
  assert.equal(r1.payload.email, u.email);
  assert.equal(r1.user.password_hash, hash, 'a rota recebe a linha completa (precisa dela para o resto do login)');

  const r2 = await verificarSegundoFator({ ticket: criarTicketMfa(u.id), code: codigo });
  assert.deepEqual([r2.ok, r2.status, r2.error], [false, 401, 'Código já utilizado. Aguarde o próximo.']);
});

test('verificarSegundoFator: código errado → 401 e, repetido, trava com 429 informando os minutos', async () => {
  const u = await usuario({ mfa: true });
  const vistos = [];
  for (let i = 0; i < 12; i += 1) {
    const r = await verificarSegundoFator({ ticket: criarTicketMfa(u.id), code: i % 2 ? '000001' : '000002' });
    vistos.push(r.status);
    if (r.status === 429) {
      assert.match(r.error, /Tente de novo em \d+ min/);
      break;
    }
    assert.equal(r.error, 'Código inválido.');
  }
  assert.ok(vistos.includes(429), `nunca travou: ${vistos}`);
  assert.ok(vistos[0] === 401);
  // Já travado: nem o código certo passa.
  const certo = await verificarSegundoFator({ ticket: criarTicketMfa(u.id), code: totpNow(u.secret) });
  assert.equal(certo.status, 429);
});

test('ciclo de vida: setup exige a senha, ativar exige o código, desativar exige a senha', async () => {
  const u = await usuario();

  const errada = await iniciarCadastroMfa({ userId: u.id, email: u.email, password: 'errada' });
  assert.deepEqual([errada.ok, errada.status, errada.error], [false, 401, 'Senha incorreta.']);
  assert.equal((await iniciarCadastroMfa({ userId: crypto.randomUUID(), email: 'x', password: SENHA })).status, 404);

  assert.deepEqual(await ativarMfa({ userId: u.id, code: '123456' }), { ok: false, status: 400, error: 'Gere o segredo primeiro.' });

  const setup = await iniciarCadastroMfa({ userId: u.id, email: u.email, password: SENHA });
  assert.equal(setup.ok, true);
  assert.match(setup.secret, /^[A-Z2-7]{32}$/);
  assert.ok(setup.otpauthUrl.startsWith('otpauth://totp/'));
  const [[gravado]] = await pool.query('SELECT totp_secret, totp_enabled FROM users WHERE id = ?', [u.id]);
  const chaveValida = /^[0-9a-fA-F]{64}$/.test((process.env.DATA_ENCRYPTION_KEY || '').trim());
  if (chaveValida) assert.ok(gravado.totp_secret.startsWith('enc:v1:'), 'segredo cifrado em repouso');
  assert.equal(decryptField(gravado.totp_secret), setup.secret);
  assert.equal(Number(gravado.totp_enabled), 0, 'ainda não ativo');

  assert.equal((await ativarMfa({ userId: u.id, code: '000000' })).status, 401);
  const ativado = await ativarMfa({ userId: u.id, code: totpNow(setup.secret) });
  assert.equal(ativado.ok, true);
  assert.equal(ativado.payload.id, u.id, 'devolve o payload do usuário, sem a marca de sessão restrita (ADR-0010)');
  assert.ok(!ativado.payload.mfa_setup);
  assert.equal(Number((await pool.query('SELECT totp_enabled FROM users WHERE id = ?', [u.id]))[0][0].totp_enabled), 1);

  const denovo = await iniciarCadastroMfa({ userId: u.id, email: u.email, password: SENHA });
  assert.deepEqual([denovo.status, denovo.error], [400, 'O segundo fator já está ativo. Desative-o antes de gerar um novo.']);

  assert.equal((await desativarMfa({ userId: u.id, password: 'errada' })).status, 401);
  assert.equal((await desativarMfa({ userId: u.id, password: undefined })).status, 401);
  assert.equal((await desativarMfa({ userId: crypto.randomUUID(), password: SENHA })).status, 404);
  assert.deepEqual(await desativarMfa({ userId: u.id, password: SENHA }), { ok: true });
  const [[fim]] = await pool.query('SELECT totp_secret, totp_enabled FROM users WHERE id = ?', [u.id]);
  assert.equal(fim.totp_secret, null);
  assert.equal(Number(fim.totp_enabled), 0);
});

// ---------------------------------------------------------------------------
// Segredo cifrado em repouso
// ---------------------------------------------------------------------------

const comChave = /^[0-9a-fA-F]{64}$/.test((process.env.DATA_ENCRYPTION_KEY || '').trim());

test('segredo CIFRADO no banco funciona de ponta a ponta (setup → ativar → verificar) e não vaza em claro', { skip: !comChave && 'sem DATA_ENCRYPTION_KEY válida' }, async () => {
  const u = await usuario();
  const setup = await iniciarCadastroMfa({ userId: u.id, email: u.email, password: SENHA });
  const [[bruto]] = await pool.query('SELECT totp_secret FROM users WHERE id = ?', [u.id]);
  assert.ok(bruto.totp_secret.startsWith('enc:v1:'));
  assert.ok(!bruto.totp_secret.includes(setup.secret), 'o segredo em claro não aparece no valor gravado');

  const ativado = await ativarMfa({ userId: u.id, code: totpNow(setup.secret) });
  assert.equal(ativado.ok, true);
  assert.equal(ativado.payload.id, u.id, 'devolve o payload do usuário, sem a marca de sessão restrita (ADR-0010)');
  assert.ok(!ativado.payload.mfa_setup);
  const r = await verificarSegundoFator({ ticket: criarTicketMfa(u.id), code: totpNow(setup.secret, Date.now() + 30000) });
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('segredo LEGADO em texto puro segue válido até a migration 0006 (compatibilidade na troca de versão)', async () => {
  const u = await usuario({ mfa: true }); // o helper grava em claro
  const r = await verificarSegundoFator({ ticket: criarTicketMfa(u.id), code: totpNow(u.secret) });
  assert.equal(r.ok, true);
});

test('segredo ilegível (cifrado com outra chave) → "Verificação indisponível.", nunca aceita nem nega por engano', { skip: !comChave && 'sem DATA_ENCRYPTION_KEY válida' }, async () => {
  const u = await usuario({ mfa: true });
  const original = process.env.DATA_ENCRYPTION_KEY;
  await pool.query('UPDATE users SET totp_secret = ? WHERE id = ?', [encryptField(u.secret), u.id]);
  process.env.DATA_ENCRYPTION_KEY = 'ab'.repeat(32); // chave diferente da que cifrou
  const silenciar = console.error;
  console.error = () => {};
  try {
    const v = await verificarSegundoFator({ ticket: criarTicketMfa(u.id), code: totpNow(u.secret) });
    assert.deepEqual([v.ok, v.status, v.error], [false, 401, 'Verificação indisponível.']);
    const a = await ativarMfa({ userId: u.id, code: totpNow(u.secret) });
    assert.deepEqual([a.ok, a.status, a.error], [false, 401, 'Verificação indisponível.']);
  } finally {
    console.error = silenciar;
    process.env.DATA_ENCRYPTION_KEY = original;
  }
});
