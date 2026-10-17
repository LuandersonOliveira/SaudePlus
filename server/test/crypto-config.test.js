/**
 * Duas defesas que sumiam em silêncio quando a configuração estava errada.
 *
 * 1. encryptField devolvia o valor em TEXTO PURO quando DATA_ENCRYPTION_KEY
 *    faltava ou era inválida — com um único console.warn, uma vez. CPF, RG e
 *    CNS iam para o MySQL em claro e o `isEncrypted` os tratava como legado
 *    para sempre. Um controle que se desliga sozinho é pior que um que
 *    falha: em produção não há ninguém para ver o aviso.
 *
 * 2. O pool do mysql2 não tinha listener de 'error'. Conexão ociosa morre
 *    quando o MySQL reinicia ou expira por wait_timeout; sem listener o Node
 *    lança "Unhandled 'error' event" e o processo inteiro morre. Não há
 *    uncaughtException registrado em lugar nenhum.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const SERVER = path.resolve(__dirname, '..');

// Manipulamos process.env antes de cada caso, porque crypto.js lê a chave a
// cada chamada (não no boot) — é justamente o que faz o modo degradado.
const { encryptField, decryptField, isEncrypted, assertCryptoConfigured } =
  require('../src/utils/crypto');

const CHAVE = 'a'.repeat(64);
const original = {};

test.beforeEach(() => {
  original.NODE_ENV = process.env.NODE_ENV;
  original.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY;
});

test.afterEach(() => {
  for (const [k, v] of Object.entries(original)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test('com chave válida, cifra e decifra de volta', () => {
  process.env.DATA_ENCRYPTION_KEY = CHAVE;
  const out = encryptField('52998224725');
  assert.ok(out.startsWith('enc:v1:'), `formato inesperado: ${out}`);
  assert.equal(decryptField(out), '52998224725');
  assert.ok(isEncrypted(out));
});

test('o ciphertext NÃO contém o valor original', () => {
  process.env.DATA_ENCRYPTION_KEY = CHAVE;
  const out = encryptField('52998224725');
  assert.ok(!out.includes('52998224725'), 'o CPF está legível no texto cifrado');
});

test('a mesma entrada produz ciphertexts diferentes (IV aleatório)', () => {
  process.env.DATA_ENCRYPTION_KEY = CHAVE;
  assert.notEqual(encryptField('52998224725'), encryptField('52998224725'));
});

test('encryptField é idempotente: não cifra duas vezes', () => {
  process.env.DATA_ENCRYPTION_KEY = CHAVE;
  const uma = encryptField('52998224725');
  assert.equal(encryptField(uma), uma);
});

test('null, undefined e vazio viram null, não texto', () => {
  process.env.DATA_ENCRYPTION_KEY = CHAVE;
  assert.equal(encryptField(null), null);
  assert.equal(encryptField(undefined), null);
  assert.equal(encryptField(''), null);
});

test('EM PRODUÇÃO sem chave válida, encryptField LANÇA em vez de gravar em claro', () => {
  // Este é o coração do bug: a falha precisa ser fechada.
  for (const chave of [undefined, '', 'curta', 'z'.repeat(63), 'x'.repeat(70)]) {
    process.env.NODE_ENV = 'production';
    if (chave === undefined) delete process.env.DATA_ENCRYPTION_KEY;
    else process.env.DATA_ENCRYPTION_KEY = chave;
    assert.throws(
      () => encryptField('52998224725'),
      /DATA_ENCRYPTION_KEY/,
      `chave ${JSON.stringify(chave)} deveria fazer o encryptField lançar`
    );
  }
});

test('em produção o boot também falha cedo', () => {
  process.env.NODE_ENV = 'production';
  process.env.DATA_ENCRYPTION_KEY = 'invalida';
  assert.throws(() => assertCryptoConfigured(), /DATA_ENCRYPTION_KEY/);
});

test('em desenvolvimento a chave ausente ainda degrada (para o aluno conseguir rodar)', () => {
  process.env.NODE_ENV = 'development';
  delete process.env.DATA_ENCRYPTION_KEY;
  // Não lança — senão `npm run setup` num ambiente novo seria impossível.
  assert.doesNotThrow(() => encryptField('52998224725'));
});

test('assertCryptoConfigured aceita chave de 64 hex em qualquer ambiente', () => {
  process.env.NODE_ENV = 'production';
  process.env.DATA_ENCRYPTION_KEY = crypto.createHash('sha256').update('x').digest('hex');
  assert.doesNotThrow(() => assertCryptoConfigured());
});

test('o boot valida os segredos antes de listening', () => {
  const src = fs.readFileSync(path.join(SERVER, 'src', 'server.js'), 'utf8');
  assert.match(src, /assertCryptoConfigured/, 'server.js deveria validar a chave de cripto');
  assert.match(src, /JWT_SECRET/, 'server.js deveria validar o JWT_SECRET');
  // E a validação tem que acontecer ANTES do listen, senão o processo sobe
  // vulnerável e só depois avisa.
  const iValida = src.indexOf('assertCryptoConfigured');
  const iListen = src.indexOf('app.listen');
  assert.ok(iValida > -1 && iListen > -1);
  assert.ok(iValida < iListen, 'a validação precisa vir antes de app.listen');
});

test('o pool tem handler de erro — sem ele o processo morre com o MySQL fora', () => {
  const src = fs.readFileSync(path.join(SERVER, 'src', 'db.js'), 'utf8');
  assert.match(
    src,
    /pool\.on\(\s*'error'/,
    'db.js precisa de pool.on("error") — sem isso o mysql2 reemite e o Node aborta'
  );
});

test('o pool de verdade registra um listener', () => {
  const pool = require('../src/db');
  const n = pool.listenerCount ? pool.listenerCount('error') : 0;
  assert.ok(n >= 1, `pool sem listener de error (tem ${n})`);
  return pool.end().catch(() => {});
});