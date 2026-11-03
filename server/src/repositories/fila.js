/* ==========================================================================
   Saúde+ — SQL da lista de espera (`waitlist`) que a administração usa.

   Cada função recebe `db` primeiro: o pool OU a conexão da transação em curso. A entrada e a saída do
   próprio paciente (routes/me.waitlist.routes.js) e a conversão em atendimento (services/waitlist.js)
   seguem onde estão até a onda 3.
   ========================================================================== */

/**
 * Cancela as entradas ATIVAS presas a uma unidade (a unidade foi desativada). Entrada "qualquer
 * unidade" (`unit_id` nulo) não é tocada. Devolve as entradas canceladas, para avisar os pacientes.
 * @returns {Promise<{id: string, user_id: string}[]>}
 */
async function cancelarDaUnidade(db, unitId) {
  const [rows] = await db.query(
    "SELECT id, user_id FROM waitlist WHERE unit_id = ? AND status = 'aguardando' FOR UPDATE",
    [unitId]
  );
  if (rows.length) {
    await db.query("UPDATE waitlist SET status = 'cancelado' WHERE id IN (?)", [rows.map((r) => r.id)]);
  }
  return rows;
}

module.exports = { cancelarDaUnidade };