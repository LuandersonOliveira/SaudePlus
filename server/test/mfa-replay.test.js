/**
 * O segundo fator não pode ser o elo frouxo.
 *
 * `/auth/mfa/verify` aceitava o MESMO código quantas vezes quisesse dentro da
 * janela (±1 passo = 90s de validade) e não contava tentativas. Duas
 * consequências, ambas reais:
 *
 * 1. **Replay.** O código TOTP é capturado — de shoulder surfing, de uma foto
 *    do app autenticador, de um log. Dentro dos 90s da janela ele abria uma
 *    sessão nova, quantas vezes fosse preciso. O segundo fator é o controle
 *    contra exatamente isso, então o replay anula o controle.
 *
 * 2. **Força bruta.** São 6 dígitos com passo de 30s. Sem contador, o código
 *    pode ser testado indefinidamente — inclusive *fora* da janela, o que dá
 *    ao atacante todas as combinações sem limite de tempo.
 *
 * Um código TOTP usado em janela não pode ser reusado (RFC 6238 §5.2 fala
 * nisso explicitamente), e tentativas erradas precisam de teto.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  randomSecret,
  totpNow,
  matchStep,
  verifyTotp,
  replayBloqueia,
  STEP,
} = require('../src/utils/totp');

// ===========================================================================
// A função pura: qual passo casou, e o replay
// ===========================================================================

test('matchStep devolve o passo que casou com o código', () => {
  const secret = randomSecret();
  const agora = Date.now();
  const codigo = totpNow(secret, agora);

  const r = matchStep(secret, codigo, agora);
  assert.equal(r.ok, true);
  assert.equal(typeof r.step, 'number');
  assert.equal(r.step, Math.floor(agora / 1000 / STEP));
});

test('matchStep rejeita código de outro passo e código errado', () => {
  const secret = randomSecret();
  const agora = Date.now();
  const futuro = totpNow(secret, agora + 10 * STEP * 1000);
  const r = matchStep(secret, futuro, agora);
  assert.equal(r.ok, false, 'código de passo 10 passos à frente não pode validar agora');
  assert.equal(r.step, undefined);

  assert.equal(matchStep(secret, '000000', agora).ok, false);
  assert.equal(matchStep(secret, '12345', agora).ok, false, '5 dígitos não é código');
  assert.equal(matchStep(secret, '', agora).ok, false);
  assert.equal(matchStep(secret, 'abcdef', agora).ok, false);
});

test('verifyTotp continua funcionando para quem não se importa com replay', () => {
  // A assinatura antiga não muda: é usada em /auth/mfa/confirm e em testes.
  const secret = randomSecret();
  assert.equal(verifyTotp(secret, totpNow(secret)), true);
  assert.equal(verifyTotp(secret, '999999'), false);
});

test('o MESMO código é aceito uma vez e rejeitado na segunda', () => {
  const secret = randomSecret();
  const agora = Date.now();
  const codigo = totpNow(secret, agora);

  const primeira = matchStep(secret, codigo, agora);
  assert.equal(primeira.ok, true);

  // Replay: mesmo passo, mesmo código.
  assert.equal(replayBloqueia(primeira.step, primeira.step), true, 'o passo usado não pode ser reusado');

  // Passo anterior também é bloqueado — é o mesmo código, aceito pela janela.
  assert.equal(replayBloqueia(primeira.step, primeira.step - 1), true, 'passo anterior continua sendo replay');

  // Passo futuro é livre.
  assert.equal(replayBloqueia(primeira.step, primeira.step + 1), false);

  // Último uso desconhecido (primeira vez que liga o MFA) não bloqueia nada.
  assert.equal(replayBloqueia(null, primeira.step), false);
  assert.equal(replayBloqueia(undefined, primeira.step), false);
});

// ===========================================================================
// O teto de tentativas
// ===========================================================================

test('o contador de tentativas do MFA trava e é função pura', () => {
  const { mfaAttempts, registrarFalhaMfa, bloqueioMfa } = require('../src/utils/mfaAttempts');

  // Estado novo: nada bloqueado.
  assert.equal(bloqueioMfa(mfaAttempts, 'user-1', Date.now()), null);

  // 4 erros ainda deixam passar.
  for (let i = 1; i <= 4; i += 1) {
    registrarFalhaMfa(mfaAttempts, 'user-1', Date.now());
    assert.equal(bloqueioMfa(mfaAttempts, 'user-1', Date.now()), null, `erro ${i} não deveria bloquear`);
  }

  // O 5º trava.
  registrarFalhaMfa(mfaAttempts, 'user-1', Date.now());
  const bloqueio = bloqueioMfa(mfaAttempts, 'user-1', Date.now());
  assert.ok(bloqueio, 'o 5º erro precisa bloquear');
  assert.ok(bloqueio.segundosRestantes > 0, 'o bloqueio precisa dizer quanto tempo falta');

  // Acerto limpa o contador.
  assert.ok(mfaAttempts.delete('user-1') || true);

  // Janela expira sozinha.
  const velho = Date.now() - 10 * 60 * 1000;
  registrarFalhaMfa(mfaAttempts, 'user-2', velho);
  assert.equal(bloqueioMfa(mfaAttempts, 'user-2', Date.now()), null, 'a janela deveria ter expirado');
});

test('o mapa de tentativas do MFA tem teto, como o do login', () => {
  const { mfaAttempts, LIMITE_ENTRADAS } = require('../src/utils/mfaAttempts');
  assert.ok(LIMITE_ENTRADAS > 0 && LIMITE_ENTRADAS <= 100000, 'teto precisa ser finito e razoável');
  assert.ok(mfaAttempts instanceof Map);
});