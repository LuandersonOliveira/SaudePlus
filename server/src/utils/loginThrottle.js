/* ==========================================================================
   Saúde+ — proteção contra força bruta no login.

   A chave é `ip|e-mail`, não só o IP. Atrás de nginx/Cloudflare/IIS — a
   única forma sensata de subir isto — `req.ip` é o IP do PROXY para toda
   requisição, e cinco logins errados de qualquer origem travavam a rede
   inteira por 5 minutos. Com a chave por conta:

     - um ataque contra uma conta não derruba as demais;
     - uma conta sob ataque não tranca todo mundo atrás do mesmo proxy.

   O limite global por IP continua no express-rate-limit (globalLimiter).

   O Map também era ilimitado: um spray de IP de origem o crescia sem parar
   pelo tempo de vida do processo. Aqui ele é varrido e tem teto duro.

   Funções puras, com `now` injetado — é o que torna isso testável sem
   esperar 5 minutos nem depender de relógio do sistema.
   ========================================================================== */

const JANELA_MS = 5 * 60 * 1000;
const MAX_TENTATIVAS = 5;
// Teto de entradas simultâneas. Cada entrada ocupa ~100 bytes; 10k é
// folgado para uso normal e corta o spray de IP de fora.
const LIMITE_ENTRADAS = 10000;

/** Monta a chave normalizada: `ip|email`. */
function loginKey(ip, email) {
  const quem = String(ip || '').trim() || 'desconhecido';
  const conta = String(email || '').trim().toLowerCase();
  return `${quem}|${conta}`;
}

/**
 * Remove entradas cuja janela E bloqueio já passaram. Entradas bloqueadas
 * em vigor ficam: um sweep não pode liberar um bloqueio.
 */
function sweep(map, now) {
  for (const [chave, entry] of map) {
    const bloqueado = entry.blockedUntil && entry.blockedUntil > now;
    const janelaPassou = !entry.windowEndsAt || entry.windowEndsAt < now;
    if (!bloqueado && janelaPassou) map.delete(chave);
  }
  return map;
}

/** Aplica o teto descartando as entradas mais antigas (Map mantém ordem). */
function aplicarTeto(map) {
  while (map.size > LIMITE_ENTRADAS) {
    const maisAntiga = map.keys().next().value;
    map.delete(maisAntiga);
  }
  return map;
}

/** Estado do bloqueio, ou null se a conta não está bloqueada agora. */
function loginBlockInfo(map, chave, now = Date.now()) {
  const entry = map.get(chave);
  if (!entry) return null;
  if (entry.blockedUntil && entry.blockedUntil > now) return entry;
  if (entry.windowEndsAt && entry.windowEndsAt < now) map.delete(chave);
  return null;
}

/** Conta uma falha e bloqueia ao atingir MAX_TENTATIVAS. */
function registerLoginFailure(map, chave, now = Date.now()) {
  sweep(map, now);
  const entry = map.get(chave) || { count: 0, windowEndsAt: now + JANELA_MS };
  if (entry.blockedUntil && entry.blockedUntil > now) return entry;
  if (entry.windowEndsAt < now) {
    entry.count = 0;
    entry.windowEndsAt = now + JANELA_MS;
  }
  entry.count += 1;
  if (entry.count >= MAX_TENTATIVAS) {
    entry.blockedUntil = now + JANELA_MS;
    entry.count = 0;
  }
  map.set(chave, entry);
  aplicarTeto(map);
  return entry;
}

/** Login certo limpa a entrada — não faz sentido continuar contando. */
function registerLoginSuccess(map, chave) {
  map.delete(chave);
}

module.exports = {
  loginKey,
  loginBlockInfo,
  registerLoginFailure,
  registerLoginSuccess,
  sweep,
  JANELA_MS,
  MAX_TENTATIVAS,
  LIMITE_ENTRADAS,
};
