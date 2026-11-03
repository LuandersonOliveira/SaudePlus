/* ==========================================================================
   Saúde+ — escrita sobre `appointments` / `exams` na alteração por staff/admin
   (A1, passo 7c).

   Escrita de `appointments` / `exams`: a CRIAÇÃO (`inserir`, usada só por
   `services/bookingCreate.js`) e as operações da alteração por staff/admin. O UNIQUE de
   horário (B2) é a rede de proteção de qualquer escrita.
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

/**
 * O ÚNICO INSERT de atendimento novo (E-06). `doctor` só existe em `appointments`; o `status` fica no
 * padrão da tabela (`pendente`).
 */
async function inserir(db, { table, id, userId, serviceName, doctor, location, unitId, professionalId, scheduledAt, notes, duracao }) {
  const { serviceColumn } = tabelaSegura(table);
  const colunas = ['id', 'user_id', serviceColumn];
  const valores = [id, userId, serviceName];
  if (table === 'appointments') {
    colunas.push('doctor');
    valores.push(doctor || null);
  }
  colunas.push('location', 'unit_id', 'professional_id', 'scheduled_at', 'notes', 'duration_minutes');
  valores.push(location, unitId || null, professionalId || null, scheduledAt, notes || null, duracao);
  await db.query(
    `INSERT INTO ${table} (${colunas.join(', ')}) VALUES (${colunas.map(() => '?').join(',')})`,
    valores
  );
}

/** Atendimentos futuros e ATIVOS (pendente/confirmado) de um profissional numa tabela. */
async function futurosAtivosDoProfissional(db, table, professionalId) {
  tabelaSegura(table);
  const [rows] = await db.query(
    `SELECT id, user_id, scheduled_at FROM ${table}
     WHERE professional_id = ? AND status IN ('pendente', 'confirmado')
       AND scheduled_at >= NOW()`,
    [professionalId]
  );
  return rows;
}

/** Atendimentos futuros e ATIVOS (pendente/confirmado) de uma UNIDADE numa tabela. Trava as linhas (`FOR UPDATE`). */
async function futurosAtivosDaUnidade(db, table, unitId) {
  tabelaSegura(table);
  const [rows] = await db.query(
    `SELECT id, user_id, scheduled_at, professional_id FROM ${table}
     WHERE unit_id = ? AND status IN ('pendente', 'confirmado')
       AND scheduled_at >= NOW()
     FOR UPDATE`,
    [unitId]
  );
  return rows;
}

/** Manda o atendimento para a fila "Para remarcar" com o motivo (o horário fica livre no UNIQUE de B2). */
async function moverParaRemarcar(db, table, id, reason) {
  tabelaSegura(table);
  await db.query(`UPDATE ${table} SET status = 'para_remarcar', reschedule_reason = ? WHERE id = ?`, [reason, id]);
}

module.exports = { inserir, lerETravar, atualizar, futurosAtivosDoProfissional, futurosAtivosDaUnidade, moverParaRemarcar, TABELAS };
