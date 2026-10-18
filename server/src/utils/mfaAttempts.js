/* ==========================================================================
   Proteção contra força bruta no segundo fator.

   O limite de senha (utils/loginThrottle.js) protege o PRIMEIRO fator. Sem um
   limite próprio, `/auth/mfa/verify` virava uma porta sem trinco: são 6
   dígitos, o passo é de 30s, e a rota não contava nada — o atacante testava
   combinações indefinidamente, inclusive fora da janela, onde o tempo não
   limita nada.

   A chave é o **usuário**, não `ip|email`: o ticket MFA já prova que a senha
   certa foi digitada, então o alvo é quebrar o segundo fator de uma conta
   específica. Um proxy na frente não deve permitir que uma conta sob ataque
   seja travada por todo mundo atrás dele.

   Funções puras com `now` injetado, como as do loginThrottle — é o que torna
   isso testável sem esperar minutos nem depender do relógio do sistema.
   ========================================================================== */

const JANELA_MS = 5 * 60 * 1000;
const MAX_TENTATIVAS = 5;
// Mesmo raciocínio do loginThrottle: um spray de ids faria o Map crescer sem
// parar pelo tempo de vida do processo.
const LIMITE_ENTRADAS = 10000;

/** Chave por usuário: `user:<id>`. */
function mfaKey(userId) {
  return `user:${String(userId || '').trim() || 'desconhecido'}`;
}

function sweep(map, now) {
  for (const [chave, entrada] of map) {
    if (!entrada || now - entrada.janelaEm >= JANELA_MS) map.delete(chave);
  }
}

function aplicarTeto(map) {
  while (map.size >= LIMITE_ENTRADAS) {
    const maisAntigo = map.keys().next();
    if (maisAntigo.done) break;
    map.delete(maisAntigo.value);
  }
}

/**
 * Estado atual do bloqueio, ou null se pode tentar.
 * @returns {{tentativas: number, segundosRestantes: number}|null}
 */
function bloqueioMfa(map, userId, now = Date.now()) {
  const entrada = map.get(mfaKey(userId));
  if (!entrada) return null;
  if (now - entrada.janelaEm >= JANELA_MS) {
    map.delete(mfaKey(userId));
    return null;
  }
  if (entrada.falhas < MAX_TENTATIVAS) return null;
  const terminaEm = entrada.janelaEm + JANELA_MS;
  return {
    tentativas: entrada.falhas,
    segundosRestantes: Math.max(1, Math.ceil((terminaEm - now) / 1000)),
  };
}

/** Registra um código errado. */
function registrarFalhaMfa(map, userId, now = Date.now()) {
  sweep(map, now);
  const chave = mfaKey(userId);
  const entrada = map.get(chave);
  if (!entrada || now - entrada.janelaEm >= JANELA_MS) {
    aplicarTeto(map);
    map.set(chave, { falhas: 1, janelaEm: now });
    return 1;
  }
  entrada.falhas += 1;
  return entrada.falhas;
}

/** Código certo: limpa o contador. */
function registrarSucessoMfa(map, userId) {
  map.delete(mfaKey(userId));
}

/** O mapa é compartilhado pelo processo, como o de login. */
const mfaAttempts = new Map();

module.exports = {
  mfaAttempts,
  mfaKey,
  bloqueioMfa,
  registrarFalhaMfa,
  registrarSucessoMfa,
  sweep,
  JANELA_MS,
  MAX_TENTATIVAS,
  LIMITE_ENTRADAS,
};
