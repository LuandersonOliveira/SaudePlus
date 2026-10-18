/**
 * Replay de TOTP sob concorrência real.
 *
 * A proteção por `totp_last_step` era ler → comparar → gravar. Essa janela
 * basta para passar: duas requisições simultâneas com o mesmo ticket e o
 * mesmo código leem o mesmo valor de `totp_last_step`, as duas passam na
 * comparação em JS e as duas emitem sessão — duas sessões abertas com UM
 * único código, que é exatamente o que o segundo fator existe para impedir.
 *
 * Basta um duplo clique no botão, ou um F5 repetido dentro da janela de 30s.
 *
 * Este teste dispara N requisições ao MESMO tempo (não em sequência, que
 * seria trivial) e exige que exatamente UMA seja aceita. Ele mora em
 * test/race/ porque precisa de concorrência real e de banco — mesmo princípio
 * do teste de booking.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const path = require('node:path');

const SERVER = path.resolve(__dirname, '..', '..');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const app = require('../../src/app');
const pool = require('../../src/db');
const jwt = require('jsonwebtoken');
const { randomSecret, totpNow } = require('../../src/utils/totp');
const { mfaAttempts } = require('../../src/utils/mfaAttempts');

const ALVO = { id: '00000000-0000-4000-8000-00000000d0c1', email: 'mfa-corrida@caps.local' };
const PARALELAS = Number(process.env.RACE_PARALLEL) || 6;

let server;
let base;
let segredo;

const ticket = () => jwt.sign(
  { id: ALVO.id, purpose: 'mfa' },
  process.env.JWT_SECRET,
  { expiresIn: '5m' }
);

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  segredo = randomSecret();
  const hash = await bcrypt.hash('Corrida123!', 10);
  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, account_status,
                        totp_secret, totp_enabled, totp_last_step)
     VALUES (?, 'Alvo Corrida', ?, ?, 'paciente', 'ativo', ?, 1, NULL)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), account_status = 'ativo',
                             totp_secret = VALUES(totp_secret), totp_enabled = 1, totp_last_step = NULL`,
    [ALVO.id, ALVO.email, hash, segredo]
  );
  mfaAttempts.clear();
});

test.after(async () => {
  mfaAttempts.clear();
  await pool.query('DELETE FROM users WHERE id = ?', [ALVO.id]).catch(() => {});
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await pool.end().catch(() => {});
});

test(`${PARALELAS} verificações simultâneas do MESMO código: só uma entra`, async () => {
  // Zera o passo: este é o primeiro uso do código.
  await pool.query('UPDATE users SET totp_last_step = NULL WHERE id = ?', [ALVO.id]);

  const code = totpNow(segredo);
  const manda = () => fetch(`${base}/auth/mfa/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket: ticket(), code }),
  });

  // Promise.all é o que faz as requisições partirem de verdade ao mesmo
  // tempo; em sequência, a segunda já encontraria o passo gravado.
  const respostas = await Promise.all(Array.from({ length: PARALELAS }, manda));

  const status = respostas.map((r) => r.status);
  const aceitas = status.filter((s) => s === 200).length;
  const recusadas = status.filter((s) => s === 401).length;

  assert.equal(
    aceitas,
    1,
    `um único código tem que abrir exatamente uma sessão; abriram ${aceitas} (status: ${status.join(', ')})`
  );
  assert.equal(
    aceitas + recusadas,
    PARALELAS,
    `as demais deveriam ser 401 de replay, não ${status.join(', ')}`
  );

  // E o duplo clique NÃO pode trancar a conta. Replay de código válido não é
  // tentativa errada: com o contador contando replay, cinco cliques rápidos
  // davam 429 e o titular ficava cinco minutos sem conseguir entrar — pelo
  // próprio motivo que ele clicou duas vezes.
  const { bloqueioMfa } = require('../../src/utils/mfaAttempts');
  assert.equal(
    bloqueioMfa(mfaAttempts, ALVO.id),
    null,
    'a corrida não pode ter contado como tentativa — o titular ficaria trancado por duplo clique'
  );

  // E o passo gravado é o do código — não um pulo para o futuro, que
  // quebraria o próximo login legítimo.
  const [[row]] = await pool.query('SELECT totp_last_step FROM users WHERE id = ?', [ALVO.id]);
  const esperado = Math.floor(Date.now() / 1000 / 30);
  assert.ok(
    Number(row.totp_last_step) >= esperado - 1 && Number(row.totp_last_step) <= esperado + 1,
    `totp_last_step deveria ser o passo do código (${esperado}), veio ${row.totp_last_step}`
  );
});

test('depois da corrida, o próximo código ainda entra', async () => {
  // Contra-prova: se a proteção fosse "bloqueia tudo depois da primeira
  // tentativa", este teste falharia — e o usuário ficaria sem conseguir entrar
  // até a janela virar.
  await pool.query('UPDATE users SET totp_last_step = NULL WHERE id = ?', [ALVO.id]);
  mfaAttempts.clear();

  const codigoFuturo = totpNow(segredo, Date.now() + 30 * 1000);
  const passoAtual = Math.floor(Date.now() / 1000 / 30);
  await pool.query('UPDATE users SET totp_last_step = ? WHERE id = ?', [passoAtual, ALVO.id]);

  const res = await fetch(`${base}/auth/mfa/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket: ticket(), code: codigoFuturo }),
  });
  assert.equal(res.status, 200, `o código seguinte tem que entrar, deu ${res.status}`);
});