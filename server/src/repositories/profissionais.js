/* ==========================================================================
   Saúde+ — SQL de `professionals` (A1 da Fase 6, passos 8b e 8c).

   Neste passo: o vínculo atendente ↔ profissional que a gestão de usuários
   mantém. (O CRUD administrativo de profissionais entra no passo 8c.)

   Cada função recebe `db` primeiro: o pool OU a conexão da transação em curso.
   ========================================================================== */
const crypto = require('crypto');

/**
 * Profissional ATIVO para vincular a um atendente. Com `travar`, usa `FOR UPDATE`
 * (dentro de transação), para que dois admins não vinculem o mesmo profissional.
 * @returns {Promise<{id: string, user_id: string|null}|undefined>}
 */
async function ativoParaVinculo(db, professionalId, { travar = false } = {}) {
  const [[p]] = await db.query(
    `SELECT id, user_id FROM professionals WHERE id = ? AND active = 1${travar ? ' FOR UPDATE' : ''}`,
    [professionalId]
  );
  return p;
}

/** Solta qualquer profissional vinculado a este usuário. */
async function desvincularUsuario(db, userId) {
  await db.query('UPDATE professionals SET user_id = NULL WHERE user_id = ?', [userId]);
}

async function vincular(db, professionalId, userId) {
  await db.query('UPDATE professionals SET user_id = ? WHERE id = ?', [userId, professionalId]);
}

/** O usuário já tem profissional vinculado? */
async function doUsuario(db, userId) {
  const [[p]] = await db.query('SELECT id FROM professionals WHERE user_id = ?', [userId]);
  return p;
}

/** Cria o profissional de um atendente que ainda não tem. @returns {Promise<string>} id */
async function criarParaAtendente(db, { name, jobTitle, userId }) {
  const id = crypto.randomUUID();
  await db.query(
    'INSERT INTO professionals (id, name, job_title, registry, active, user_id) VALUES (?,?,?,?,1,?)',
    [id, name, jobTitle, null, userId]
  );
  return id;
}

/** Acompanha a mudança de cargo do atendente (o nome só é preenchido se estiver vazio). */
async function acompanharCargo(db, userId, jobRole) {
  await db.query(
    'UPDATE professionals SET name = COALESCE(name, ?), job_title = ? WHERE user_id = ?',
    [jobRole, jobRole, userId]
  );
}

module.exports = { ativoParaVinculo, desvincularUsuario, vincular, doUsuario, criarParaAtendente, acompanharCargo };
