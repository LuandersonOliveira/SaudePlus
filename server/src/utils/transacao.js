/* ==========================================================================
   Saúde+ — transação com resultado explícito (A1 da Fase 6, passo 8d).

   `emTransacao(pool, fn)` abre uma conexão, roda `fn(conn)` dentro de uma transação e:
     - devolve o resultado e CONFIRMA se ele for `{ ok: true, ... }`;
     - DESFAZ em qualquer outro resultado (recusa de negócio) e quando `fn` lança;
     - sempre devolve a conexão ao pool.
   Serviços usam o mesmo formato `{ ok, ... }` para recusar sem exceção; aqui a recusa
   vira rollback, e nada escrito até ali sobrevive.
   ========================================================================== */
async function emTransacao(pool, fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const r = await fn(conn);
    if (r && r.ok) await conn.commit();
    else await conn.rollback();
    return r;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { emTransacao };
