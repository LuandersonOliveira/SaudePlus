/**
 * Replay e força bruta no segundo fator, testados pela ROTA (não só pela função).
 *
 * A função pura garante a lógica; este arquivo garante que a rota realmente
 * consulta o último passo, grava o novo e devolve 401 no replay. Um teste que
 * só exercita `replayBloqueia()` passaria mesmo com a rota forgot de chamar.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const app = require('../src/app');
const pool = require('../src/db');
const { randomSecret, totpNow } = require('../src/utils/totp');
const { mfaAttempts } = require('../src/utils/mfaAttempts');

const ALVO = { id: '00000000-0000-4000-8000-00000000d007', email: 'mfa-replay@caps.local' };

let server;
let base;
let segredo;

const ticket = () => jwt.sign(
  { id: ALVO.id, purpose: 'mfa' },
  process.env.JWT_SECRET,
  { expiresIn: '5m' }
);

async function criarAlvo() {
  const hash = await bcrypt.hash('Reveal123!', 10);
  segredo = randomSecret();
  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, account_status,
                        totp_secret, totp_enabled, totp_last_step)
     VALUES (?, 'Alvo MFA', ?, ?, 'paciente', 'ativo', ?, 1, NULL)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), account_status = 'ativo',
                             totp_secret = VALUES(totp_secret), totp_enabled = 1, totp_last_step = NULL`,
    [ALVO.id, ALVO.email, hash, segredo]
  );
  // O id fixo reaproveita a linha entre execuções; o segredo é sempre novo,
  // então o código válido muda a cada run.
  mfaAttempts.delete(ALVO.id);
}

const verify = (code) => fetch(`${base}/auth/mfa/verify`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ticket: ticket(), code }),
});

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await criarAlvo();
});

test.after(async () => {
  mfaAttempts.delete(ALVO.id);
  // Este DELETE quase nunca funciona: depois do primeiro login com MFA passa a
  // existir linha em audit_log, e audit_log.actor_id e FK ON DELETE RESTRICT.
  // O .catch evita que a limpeza derrube o arquivo, mas nao esconde o
  // motivo: a conta de teste FICA na base. Isso e aceitavel porque o id e
  // fixo e o setup faz UPSERT — a conta nao se multiplica a cada execucao.
  await pool.query('DELETE FROM users WHERE id = ?', [ALVO.id]).catch((e) => {
    if (e.code !== 'ER_ROW_IS_REFERENCED_2') throw e;
  });
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await pool.end().catch(() => {});
});

test('código válido entra e grava o passo usado', async () => {
  const code = totpNow(segredo);
  const res = await verify(code);
  assert.equal(res.status, 200, `login com MFA deveria funcionar, deu ${res.status}`);
  const body = await res.json();
  assert.ok(body.token, 'deveria devolver access token');
  assert.ok(body.user && body.user.email === ALVO.email);

  const [[row]] = await pool.query('SELECT totp_last_step FROM users WHERE id = ?', [ALVO.id]);
  const esperado = Math.floor(Date.now() / 1000 / 30);
  assert.ok(
    row.totp_last_step !== null && Number(row.totp_last_step) >= esperado - 1,
    `totp_last_step deveria guardar o passo usado, veio ${row.totp_last_step}`
  );
});

test('REPLAY: o mesmo código na segunda vez é recusado', async () => {
  // Este é o defeito. Antes, a segunda chamada devolvia 200 e uma sessão nova.
  const [[row]] = await pool.query('SELECT totp_secret FROM users WHERE id = ?', [ALVO.id]);
  // Zera o passo: os testes dividem a janela de 30s, e o código do teste
  // anterior é o MESMO código deste — sem zerar, estaríamos testando replay
  // sem querer (o que passa, mas não pelo motivo que queremos medir).
  await pool.query('UPDATE users SET totp_last_step = NULL WHERE id = ?', [ALVO.id]);
  const code = totpNow(row.totp_secret);

  const primeira = await verify(code);
  assert.equal(primeira.status, 200, `a primeira vez precisa passar, deu ${primeira.status}`);

  const segunda = await verify(code);
  assert.equal(segunda.status, 401, 'a segunda vez do MESMO código tem que falhar');
  const body = await segunda.json();
  assert.match(body.error, /já utilizado|inválido/i);

  // E não pode ter emitido token nenhum na segunda.
  assert.ok(!segunda.token, 'o replay não pode devolver token');
});

test('o passo seguinte do autenticador funciona de novo', async () => {
  // O bloqueio é do MESMO código, não da conta: 30s depois o próximo código
  // precisa entrar, senão a trava seria pior que o defeito.
  const [[row]] = await pool.query('SELECT totp_secret FROM users WHERE id = ?', [ALVO.id]);
  const codeFuturo = totpNow(row.totp_secret, Date.now() + 30 * 1000);
  // Avança o último passo para o valor imediatamente anterior.
  const passoAtual = Math.floor(Date.now() / 1000 / 30);
  await pool.query('UPDATE users SET totp_last_step = ? WHERE id = ?', [passoAtual, ALVO.id]);

  const res = await verify(codeFuturo);
  assert.equal(res.status, 200, `o próximo código devia entrar, deu ${res.status}`);
});

test('código errado é contado e trava a conta no 5º erro', async () => {
  await pool.query('UPDATE users SET totp_last_step = NULL WHERE id = ?', [ALVO.id]);
  mfaAttempts.delete(ALVO.id);

  for (let i = 1; i <= 4; i += 1) {
    const res = await verify('000001');
    assert.equal(res.status, 401, `erro ${i} deveria dar 401, deu ${res.status}`);
  }

  // O erro que completa a cota já responde 429 — mesma regra do lockout de
  // senha. Quem só descobrisse no próximo F5 ficaria cinco minutos tentando.
  const quinto = await verify('000001');
  assert.equal(quinto.status, 429, `o 5º erro deveria dar 429, deu ${quinto.status}`);
  const body = await quinto.json();
  assert.match(body.error, /min/i, 'o bloqueio precisa dizer quando tentar de novo');

  // E mesmo com o código CERTO, a conta bloqueada não entra.
  const [[row]] = await pool.query('SELECT totp_secret FROM users WHERE id = ?', [ALVO.id]);
  const valido = await verify(totpNow(row.totp_secret));
  assert.equal(valido.status, 429, 'o bloqueio tem que valer mesmo para o código certo');

  // Sucesso limpa o contador: zerando o passo e esperando a janela, volta.
  mfaAttempts.delete(ALVO.id);
});

test('o contador é por usuário — travar uma conta não tranca as outras', async () => {
  // A chave é o id, não ip|email: atrás de um proxy, um lockout por IP
  // trancaria todo mundo de uma vez.
  mfaAttempts.clear();
  const { registrarFalhaMfa, bloqueioMfa } = require('../src/utils/mfaAttempts');
  for (let i = 0; i < 6; i += 1) registrarFalhaMfa(mfaAttempts, 'conta-A', Date.now());
  assert.ok(bloqueioMfa(mfaAttempts, 'conta-A', Date.now()), 'conta-A deveria estar travada');
  assert.equal(bloqueioMfa(mfaAttempts, 'conta-B', Date.now()), null, 'conta-B tem que continuar livre');
});

test('a rota grava o passo na MESMA instrução que o confere', () => {
  // Ler → comparar → gravar tem janela. Duas requisições simultâneas com o
  // mesmo ticket e o mesmo código leem o mesmo totp_last_step, as duas passam
  // na comparação e as duas emitem sessão — F5 duas vezes na janela de 30s.
  //
  // A correção é mover a checagem para dentro do UPDATE: só grava (só aceita)
  // quem tem o passo estritamente maior que o gravado, e o affectedRows
  // distingue quem ganhou. Este teste trava a intenção: reintroduzir o
  // ler→comparar→gravar quebraria a atomicidade em silêncio, e todo o resto
  // da suíte continuaria passando.
  //
  // A prova de que a atomicidade segura está em
  // server/test/race/mfa-replay-race.test.js, com duas requisições de verdade.
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'auth.routes.js'), 'utf8');
  const bloco = src.slice(src.indexOf("router.post('/mfa/verify'"), src.indexOf("router.post('/mfa/setup'"));

  assert.match(
    bloco,
    /UPDATE users SET totp_last_step = \?[\s\S]{0,200}WHERE id = \? AND \(totp_last_step IS NULL OR totp_last_step < \?\)/,
    'o UPDATE do mfa/verify precisa condicionar a gravação ao passo ser maior'
  );
  assert.match(
    bloco,
    /affectedRows/,
    'a rota precisa olhar affectedRows para saber se ganhou a corrida'
  );
});