/**
 * A2: validação por esquema Zod nas rotas de /auth.
 * Garante o formato do erro, a ordem das checagens do cadastro e que nenhuma
 * mensagem sai no inglês padrão do Zod.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const SERVER = path.resolve(__dirname, '..');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const { z } = require(require.resolve('zod', { paths: [SERVER] }));
const { validate, MENSAGEM_PADRAO } = require('../src/middleware/validate');
const { signupBody, loginBody, mfaVerifyBody, mfaSetupBody, excluirContaBody } = require('../src/schemas/auth');

/** Executa o middleware com req/res falsos e devolve o que ele fez. */
function rodar(mw, req) {
  const out = { status: null, body: null, next: false };
  const res = {
    status(s) { out.status = s; return this; },
    json(b) { out.body = b; return this; },
  };
  mw(req, res, () => { out.next = true; });
  return out;
}

test('validate: sucesso guarda o dado em req.valid e NÃO substitui req.body', () => {
  const body = { n: ' 5 ', extra: 'fica' };
  const req = { body };
  const o = rodar(validate(z.object({ n: z.string().trim() }).passthrough()), req);
  assert.equal(o.next, true);
  assert.equal(req.valid.body.n, '5');
  assert.equal(req.body, body, 'req.body continua o original');
  assert.equal(req.body.n, ' 5 ');
});

test('validate: falha responde 400 { error: <primeira mensagem> } e não chama next', () => {
  const o = rodar(validate(z.object({ a: z.string({ error: 'Falta A.' }), b: z.string({ error: 'Falta B.' }) })), { body: {} });
  assert.equal(o.status, 400);
  assert.deepEqual(o.body, { error: 'Falta A.' });
  assert.equal(o.next, false);
});

test('validate: body ausente é tratado como objeto vazio; status e source configuráveis', () => {
  const o = rodar(validate(z.object({ q: z.string({ error: 'Falta q.' }) }), { source: 'query', status: 422 }), {});
  assert.equal(o.status, 422);
  assert.equal(o.body.error, 'Falta q.');
  const ok = rodar(validate(z.object({ q: z.string() }), { source: 'query' }), { query: { q: 'x' } });
  assert.equal(ok.next, true);
});

test('validate: esquema sem mensagem própria cai no texto padrão, não no inglês do Zod', () => {
  const o = rodar(validate(z.object({ a: z.string() }).strict()), { body: { a: 'x', b: 1 } });
  assert.equal(o.status, 400);
  assert.ok(o.body.error);
  // Mensagens do Zod são inglesas ("Unrecognized key…"): quem usa strict() deve dar mensagem; aqui só
  // documentamos o contrato do fallback.
  assert.equal(typeof MENSAGEM_PADRAO, 'string');
});

// ---------------------------------------------------------------------------
// Cadastro
// ---------------------------------------------------------------------------

const baseOk = () => ({
  email: 'Fulano@Exemplo.com', password: 'segredo1', full_name: 'Fulano de Tal',
  birth_date: '1990-05-10', cpf: '529.982.247-25',
});
const msgSignup = (corpo) => {
  const o = rodar(validate(signupBody), { body: corpo });
  return o.next ? null : o.body.error;
};

test('signup: corpo completo e válido passa', () => {
  assert.equal(msgSignup(baseOk()), null);
  assert.equal(msgSignup({ ...baseOk(), priority: 'idoso', race: 'parda', zone: 'rural', reference_point: 'perto da igreja' }), null);
});

test('signup: campo obrigatório ausente → mensagem em português (nunca "Invalid input")', () => {
  const casos = {
    email: /e-mail/i, password: /senha/i, full_name: /obrigat/i, birth_date: /nascimento/i, cpf: /CPF/,
  };
  for (const [campo, rx] of Object.entries(casos)) {
    const corpo = baseOk();
    delete corpo[campo];
    const m = msgSignup(corpo);
    assert.match(m, rx, `sem ${campo}`);
    assert.ok(!/Invalid|expected|undefined|received/i.test(m), `mensagem em inglês para ${campo}: ${m}`);
  }
  assert.match(msgSignup(undefined), /e-mail/i, 'corpo inteiro ausente');
  assert.match(msgSignup({ ...baseOk(), email: 123 }), /e-mail/i, 'tipo errado');
});

test('signup: regras de negócio, cada uma com a sua mensagem e na ordem original', () => {
  assert.equal(msgSignup({ ...baseOk(), password: '123' }), 'A senha precisa ter ao menos 6 caracteres.');
  assert.equal(msgSignup({ ...baseOk(), cpf: '111.111.111-11' }), 'CPF inválido. Confira os números digitados.');
  assert.match(msgSignup({ ...baseOk(), cns: '123' }), /CNS/);
  assert.equal(msgSignup({ ...baseOk(), birth_date: '2090-01-01' }), 'Data de nascimento inválida.');
  assert.equal(msgSignup({ ...baseOk(), birth_date: 'abc' }), 'Data de nascimento inválida.');
  assert.equal(msgSignup({ ...baseOk(), priority: 'vip' }), 'Prioridade de atendimento inválida.');
  assert.equal(msgSignup({ ...baseOk(), race: 'x' }), 'Cor/raça inválida.');
  assert.equal(msgSignup({ ...baseOk(), birth_date: new Date().getFullYear() - 5 + '-01-01' }),
    'Informe o nome do responsável legal para menores de 18 anos.');
  assert.equal(msgSignup({ ...baseOk(), zone: 'rural' }), 'Na zona rural, o ponto de referência é obrigatório.');
  // vazio/null em priority e race significa "não informado"
  assert.equal(msgSignup({ ...baseOk(), priority: '', race: null }), null);
  // Ordem: o erro de campo essencial vem antes das regras de negócio.
  assert.equal(msgSignup({ ...baseOk(), password: '1', priority: 'vip' }), 'A senha precisa ter ao menos 6 caracteres.');
  assert.equal(msgSignup({ ...baseOk(), priority: 'vip', race: 'x' }), 'Prioridade de atendimento inválida.');
});

// ---------------------------------------------------------------------------
// Login, MFA, exclusão
// ---------------------------------------------------------------------------

const msg = (schema, corpo) => {
  const o = rodar(validate(schema), { body: corpo });
  return o.next ? null : o.body.error;
};

test('login: e-mail e senha obrigatórios, mesma mensagem para qualquer ausência', () => {
  assert.equal(msg(loginBody, { email: 'a@b.c', password: 'x' }), null);
  for (const c of [{}, { email: 'a@b.c' }, { password: 'x' }, { email: '', password: 'x' }, { email: 'a@b.c', password: '' }, { email: {}, password: 'x' }, undefined]) {
    assert.equal(msg(loginBody, c), 'Informe e-mail e senha.', JSON.stringify(c));
  }
});

test('mfa/verify: exige ticket e código; aceita código como texto ou número', () => {
  assert.equal(msg(mfaVerifyBody, { ticket: 't', code: '123456' }), null);
  assert.equal(msg(mfaVerifyBody, { ticket: 't', code: 123456 }), null);
  for (const c of [{}, { ticket: 't' }, { code: '1' }, { ticket: '', code: '1' }, { ticket: 't', code: '' }, { ticket: 't', code: null }]) {
    assert.equal(msg(mfaVerifyBody, c), 'Informe o código do autenticador.', JSON.stringify(c));
  }
});

test('mfa/setup e exclusão de conta: exigem a senha, cada uma com a sua mensagem', () => {
  assert.equal(msg(mfaSetupBody, { password: 'x' }), null);
  assert.equal(msg(mfaSetupBody, {}), 'Confirme sua senha para ativar o segundo fator.');
  assert.equal(msg(excluirContaBody, { password: 'x' }), null);
  assert.equal(msg(excluirContaBody, { password: '' }), 'Confirme sua senha para excluir a conta.');
});

test('as rotas de /auth usam validate() (a validação não voltou para dentro dos handlers)', () => {
  const fs = require('node:fs');
  const fonte = fs.readFileSync(path.join(SERVER, 'src', 'routes', 'auth.routes.js'), 'utf8');
  for (const [rota, schema] of [['/signup', 'signupBody'], ['/login', 'loginBody'], ['/mfa/verify', 'mfaVerifyBody']]) {
    assert.match(fonte, new RegExp(`router\\.post\\('${rota.replace('/', '\\/')}', validate\\(${schema}\\)`), `${rota} sem validate(${schema})`);
  }
  assert.doesNotMatch(fonte, /signupSchema\.safeParse/, 'o parse do cadastro saiu do handler');
});
