/* ==========================================================================
   Saúde+ — escrita sobre `appointments` / `exams` na alteração por staff/admin
   (A1, passo 7c).

   Só as duas operações que `services/bookingChange.js` precisa. A criação pelo
   paciente continua em routes/me.booking.routes.js; o UNIQUE de horário (B2) é a
   rede de proteção de qualquer escrita.
   ========================================================================== */

// Tabelas e colunas vêm de um mapa fechado (nunca de entrada do usuário).
const TABELAS = {
  appointments: { serviceColumn: 'specialty' },
  exams: { serviceColumn: 'exam_type' },
};

function tabelaSegura(table) {
  if (!TABELAS[table]) throw new Error(`Tabela de atendimento inválida: ${table}`);
  return TABELAS[table];
}

/**
 * Lê o registro ATUAL e o TRAVA (`FOR UPDATE`) até o fim da transação, para evitar
 * corrida com outro reagendamento do mesmo item ou do mesmo utente.
 * @returns {Promise<object|undefined>}
 */
async function lerETravar(db, table, id) {
  const { serviceColumn } = tabelaSegura(table);
  const [[row]] = await db.query(
    `SELECT id, status, scheduled_at, professional_id, unit_id, user_id,
            ${serviceColumn} AS service_name
     FROM ${table} WHERE id = ? FOR UPDATE`,
    [id]
  );
  return row;
}

/**
 * UPDATE parcial. `sets` são fragmentos `coluna=?` (montados pelo serviço a partir de
 * um conjunto fixo de colunas) e `params` os valores na mesma ordem.
 * @returns {Promise<number>} linhas afetadas
 */
async function atualizar(db, table, id, sets, params) {
  tabelaSegura(table);
  const [result] = await db.query(`UPDATE ${table} SET ${sets.join(', ')} WHERE id=?`, [...params, id]);
  return result.affectedRows;
}

module.exports = { lerETravar, atualizar, TABELAS };
