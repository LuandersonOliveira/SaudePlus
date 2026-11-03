/* ==========================================================================
   Saúde+ — SQL de `reminders` (lembretes do paciente).

   Cada função recebe `db` primeiro: o pool OU a conexão de uma transação.
   Quem GRAVA lembretes é o job (jobs/reminders.js); aqui só ficam a leitura do
   próprio paciente e a marcação de "lido".
   ========================================================================== */

/** Lembretes do usuário, do mais próximo ao mais distante. */
async function doUsuario(db, userId) {
  const [rows] = await db.query(
    'SELECT * FROM reminders WHERE user_id = ? ORDER BY remind_at ASC',
    [userId]
  );
  return rows;
}

/** O lembrete existe e é deste usuário? (Conferir antes: `affectedRows` não distingue "já lido" de "inexistente".) */
async function existeDoUsuario(db, userId, id) {
  const [[row]] = await db.query('SELECT id FROM reminders WHERE id = ? AND user_id = ?', [id, userId]);
  return Boolean(row);
}

/** Marca como lido. Escopo por `user_id` na própria cláusula: nunca altera lembrete alheio. */
async function marcarComoLido(db, userId, id) {
  await db.query('UPDATE reminders SET `read` = 1 WHERE id = ? AND user_id = ?', [id, userId]);
}

module.exports = { doUsuario, existeDoUsuario, marcarComoLido };
