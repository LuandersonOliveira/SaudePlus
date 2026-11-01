/* ==========================================================================
   Saúde+ — Trava de job entre instâncias (achado A4 da Fase 6).

   O job de lembretes roda dentro do processo da API (setInterval). Com duas
   instâncias (réplicas, deploy com sobreposição, reinício rápido), as duas
   executam ao mesmo tempo, e a checagem "já existe lembrete?" seguida do
   INSERT não é atômica: o paciente recebia o mesmo e-mail duas vezes.

   Solução: GET_LOCK do MySQL. É uma trava nomeada do SERVIDOR, presa à conexão
   que a pegou — se a instância cair no meio, a conexão fecha e o MySQL solta a
   trava sozinho (nada de trava órfã nem de TTL para ajustar).

   - timeout 0: quem não consegue a trava PULA a rodada (a outra instância já
     está fazendo o trabalho), em vez de esperar e repetir.
   - o nome inclui o banco: a trava é global no servidor MySQL e dois ambientes
     (ex.: saude e saude_staging) no mesmo servidor não podem se bloquear.
   - a conexão fica reservada durante o job inteiro e é devolvida ao pool no fim,
     com RELEASE_LOCK explícito (conexão reaproveitada não pode carregar trava).
   ========================================================================== */

/**
 * Executa `fn` só se esta instância conseguir a trava `nome`.
 *
 * @param {object} pool pool mysql2/promise
 * @param {string} nome nome lógico do job (ex.: 'reminders')
 * @param {() => Promise<any>} fn trabalho a executar
 * @returns {Promise<{ran: boolean, result?: any}>} ran=false quando outra instância tem a trava
 */
async function comTravaDeJob(pool, nome, fn) {
  const conn = await pool.getConnection();
  let chave = null;
  try {
    const [[db]] = await conn.query('SELECT DATABASE() AS db');
    chave = `saude:${db.db || 'sem-banco'}:${nome}`.slice(0, 64);
    const [[got]] = await conn.query('SELECT GET_LOCK(?, 0) AS got', [chave]);
    if (Number(got.got) !== 1) {
      chave = null; // não é nossa: não pode ser solta por nós
      return { ran: false };
    }
    return { ran: true, result: await fn() };
  } finally {
    if (chave) {
      try {
        await conn.query('SELECT RELEASE_LOCK(?)', [chave]);
      } catch {
        // Se o release falhar a conexão provavelmente morreu — e com ela a trava.
      }
    }
    conn.release();
  }
}

module.exports = { comTravaDeJob };
