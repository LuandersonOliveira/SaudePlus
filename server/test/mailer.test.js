/**
 * `utils/mailer` (na prática `services/mailer.js`).
 *
 * Duas regras que o resto do projeto já segue para govbr e rnds e que o
 * e-mail precisa cumprir também:
 *
 *  1. Sem serviço externo configurado, o sistema FUNCIONA mas não finge que
 *     enviou. `enviar()` devolve `{ enviado: false, motivo:
 *     'smtp_nao_configurado' }`. Um lembrete que "saiu" sem sair é pior que
 *     um lembrete cujo envio o operador sabe que falhou.
 *  2. A senha do SMTP nunca aparece em log nem no status.
 *
 * Não há SMTP de teste aqui: o teste do transporte real é do provedor, não
 * nosso. O que medimos é a decisão de negócio em volta dele.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const SERVER = path.resolve(__dirname, '..');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const mailer = require('../src/services/mailer');

const guardarEnv = () => ({ ...process.env });
const restaurar = (antes) => {
  for (const k of Object.keys(process.env)) {
    if (!(k in antes)) delete process.env[k];
  }
  Object.assign(process.env, antes);
  mailer.resetTransporte();
};

test.beforeEach(() => mailer.resetTransporte());
test.afterEach(() => restaurar(guardarEnv()));

test('sem SMTP_HOST o transporte é declarado não configurado', () => {
  delete process.env.SMTP_HOST;
  const cfg = mailer.mailerConfig();
  assert.equal(cfg.configured, false, 'sem host não há como enviar');
  assert.equal(mailer.mailerStatus().configured, false);
});

test('com SMTP_HOST o transporte é declarado configurado', () => {
  process.env.SMTP_HOST = 'smtp.exemplo.org';
  const cfg = mailer.mailerConfig();
  assert.equal(cfg.configured, true);
  assert.equal(cfg.port, 587, '587 é o padrão; 465 só com SMTP_SECURE');
  assert.equal(cfg.secure, false, '587 é STARTTLS, não TLS implícito');
});

test('porta 465 implica TLS implícito', () => {
  process.env.SMTP_HOST = 'smtp.exemplo.org';
  process.env.SMTP_PORT = '465';
  assert.equal(mailer.mailerConfig().secure, true);
});

test('SMTP_SECURE=true liga o TLS implícito em qualquer porta', () => {
  process.env.SMTP_HOST = 'smtp.exemplo.org';
  process.env.SMTP_PORT = '2525';
  process.env.SMTP_SECURE = 'true';
  assert.equal(mailer.mailerConfig().secure, true);
});

test('o status NUNCA expõe a senha do SMTP', () => {
  process.env.SMTP_HOST = 'smtp.exemplo.org';
  process.env.SMTP_USER = 'robot';
  process.env.SMTP_PASS = 'senha-super-secreta';

  const serializado = JSON.stringify(mailer.mailerStatus());
  assert.ok(!serializado.includes('senha-super-secreta'), `a senha vazou: ${serializado}`);
  assert.equal(mailer.mailerStatus().temCredencial, true, 'diz que há credencial sem dizer qual');
});

test('sem SMTP configurado, enviar devolve "não enviado" em vez de lançar', async () => {
  delete process.env.SMTP_HOST;
  const r = await mailer.enviar({ para: 'alguem@exemplo.org', assunto: 'oi', texto: 'oi' });
  assert.equal(r.enviado, false);
  assert.equal(r.motivo, 'smtp_nao_configurado');
});

test('destinatário ausente ou sem @ não é enviado', async () => {
  process.env.SMTP_HOST = 'smtp.exemplo.org';
  for (const para of ['', null, undefined, 'sem-arroba', '   ']) {
    const r = await mailer.enviar({ para, assunto: 'oi', texto: 'oi' });
    assert.equal(r.enviado, false, `destinatário ${JSON.stringify(para)} não deveria ser aceito`);
    assert.equal(r.motivo, 'destinatario_invalido');
  }
});

test('enviar nunca lança, mesmo com transporte quebrado', async () => {
  // Host que não resolve: o nodemailer vai rejeitar. A regra é a mesma do
  // job de lembretes — quem chama trata o envio como parte de algo maior e
  // não pode ser derrubado por ele.
  process.env.SMTP_HOST = 'host-que-nao-existe.invalid';
  process.env.SMTP_PORT = '1';
  process.env.SMTP_REJECT_UNAUTHORIZED = 'false';

  const r = await mailer.enviar({ para: 'alguem@exemplo.org', assunto: 'oi', texto: 'oi' });
  assert.equal(r.enviado, false);
  assert.ok(r.motivo, 'a falha precisa de um motivo, não de uma exceção');
});

test('o motivo da falha vem com código de transporte, não com a senha', async () => {
  process.env.SMTP_HOST = 'host-que-nao-existe.invalid';
  process.env.SMTP_PORT = '1';
  process.env.SMTP_USER = 'robot';
  process.env.SMTP_PASS = 'senha-super-secreta';
  process.env.SMTP_REJECT_UNAUTHORIZED = 'false';

  const r = await mailer.enviar({ para: 'alguem@exemplo.org', assunto: 'oi', texto: 'oi' });
  assert.equal(r.enviado, false);
  const serializado = JSON.stringify(r);
  assert.ok(!serializado.includes('senha-super-secreta'), `a senha vazou no retorno: ${serializado}`);
});