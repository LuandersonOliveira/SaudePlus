/* ==========================================================================
   Saúde+ — SQL de `health_units` para a gestão administrativa (item 2.6 da Fase 8).

   Cada função recebe `db` primeiro: o pool OU a conexão da transação em curso.
   ========================================================================== */

/** Estado atual para decidir a edição. Com `travar`, `FOR UPDATE` (dentro de transação). */
async function paraEdicao(db, id, { travar = false } = {}) {
  const [[u]] = await db.query(
    `SELECT id, name, type, neighborhood, active FROM health_units WHERE id = ?${travar ? ' FOR UPDATE' : ''}`,
    [id]
  );
  return u;
}

/** UPDATE parcial. `sets` são fragmentos `coluna=?` de um conjunto fixo. @returns linhas encontradas */
async function atualizar(db, id, sets, params) {
  const [r] = await db.query(`UPDATE health_units SET ${sets.join(', ')} WHERE id=?`, [...params, id]);
  return r.affectedRows;
}

module.exports = { paraEdicao, atualizar };