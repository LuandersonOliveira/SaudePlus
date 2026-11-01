/* ==========================================================================
   Saúde+ — SQL de `users` para a gestão administrativa (A1 da Fase 6, passo 8b).

   Cada função recebe `db` primeiro: o pool OU a conexão da transação em curso.
   Conta excluída é SOFT delete (`deleted_at`): continua na tabela, e o e-mail dela
   continua reservado (UNIQUE global), por isso `emailExiste` NÃO filtra `deleted_at`.
   ========================================================================== */

// Sem cpf/rg/cns: esses só saem no endpoint individual, que é auditado.
const COLUNAS_LISTA = `id, full_name, social_name, email, role, account_status,
                      phone, mobile, birth_date, gender, priority, race, job_role, admin_level, created_at, last_login_at`;

/**
 * Lista paginada. Contas excluídas não aparecem, nem na contagem.
 * @param {{role?: string, status?: string, search?: string|null, pageSize: number, offset: number}} f
 *   `role` e `status` já devem ter sido validados contra as listas seguras.
 * @returns {Promise<{rows: object[], total: number}>}
 */
async function listar(db, { role, status, search, pageSize, offset }) {
  const filters = ['deleted_at IS NULL'];
  const params = [];
  if (role) { filters.push('role = ?'); params.push(role); }
  if (status) { filters.push('account_status = ?'); params.push(status); }
  if (search) {
    filters.push('(LOWER(full_name) LIKE ? OR LOWER(email) LIKE ? OR phone LIKE ? OR mobile LIKE ?)');
    const pattern = `%${search}%`;
    params.push(pattern, pattern, pattern, pattern);
  }
  const where = ` WHERE ${filters.join(' AND ')}`;
  const [rows] = await db.query(
    `SELECT ${COLUNAS_LISTA} FROM users${where} ORDER BY full_name LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  const [[contagem]] = await db.query(`SELECT COUNT(*) AS total FROM users u${where}`, params);
  return { rows, total: Number(contagem.total) };
}

/** Perfil completo, com documentos AINDA CIFRADOS e o profissional vinculado. */
async function detalhe(db, id) {
  const [rows] = await db.query(
    `SELECT u.id, u.full_name, u.social_name, u.email, u.role, u.account_status,
            u.phone, u.mobile, u.birth_date, u.gender, u.blood_type, u.admin_level,
            u.priority, u.race, u.guardian_name,
            u.mother_name, u.father_name,
            u.cpf, u.rg, u.cns,
            u.cep, u.street, u.address_number, u.neighborhood, u.city, u.state,
            u.job_role, u.created_at,
            p.id AS professional_id, p.name AS professional_name
     FROM users u
     LEFT JOIN professionals p ON p.user_id = u.id
     WHERE u.id = ? AND u.deleted_at IS NULL`,
    [id]
  );
  return rows[0];
}

/** Estado atual para decidir a edição. Com `travar`, `FOR UPDATE` (dentro de transação). */
async function paraEdicao(db, id, { travar = false } = {}) {
  const [[u]] = await db.query(
    `SELECT account_status, job_role, admin_level, role, email, full_name, mobile, phone
     FROM users WHERE id = ? AND deleted_at IS NULL${travar ? ' FOR UPDATE' : ''}`,
    [id]
  );
  return u;
}

/** Dados mínimos para decidir uma exclusão. */
async function paraExclusao(db, id) {
  const [[u]] = await db.query(
    'SELECT full_name, email, role, admin_level FROM users WHERE id = ? AND deleted_at IS NULL',
    [id]
  );
  return u;
}

/** Outra conta usa este e-mail (já minúsculo)? Contas excluídas contam. */
async function emailEmUsoPorOutro(db, emailMinusculo, exceptoId) {
  const [[u]] = await db.query('SELECT id FROM users WHERE LOWER(email) = ? AND id <> ? LIMIT 1', [emailMinusculo, exceptoId]);
  return Boolean(u);
}

/** Este e-mail já existe em QUALQUER conta, inclusive excluída? */
async function emailExiste(db, emailMinusculo) {
  const [[u]] = await db.query('SELECT id FROM users WHERE LOWER(email)=?', [emailMinusculo]);
  return Boolean(u);
}

/** UPDATE parcial de conta viva. @returns {Promise<number>} linhas afetadas */
async function atualizar(db, id, sets, params) {
  const [r] = await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id=? AND deleted_at IS NULL`, [...params, id]);
  return r.affectedRows;
}

async function inserir(db, u) {
  await db.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, account_status, job_role, admin_level, mobile, phone)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [u.id, u.nome, u.email, u.passwordHash, u.role, u.status, u.jobRole, u.adminLevel, u.mobile, u.phone]
  );
}

async function nomeECargo(db, id) {
  const [[u]] = await db.query('SELECT full_name, job_role FROM users WHERE id = ?', [id]);
  return u;
}

async function excluirLogicamente(db, id) {
  await db.query('UPDATE users SET deleted_at = NOW() WHERE id = ?', [id]);
}

/**
 * Derruba as sessões e os links de redefinição pendentes do usuário.
 *
 * Sem isto, desativar, rebaixar ou trocar a senha pelo admin deixava o
 * refresh token anterior valendo por até 30 dias — a pessoa continuava
 * entrando mesmo depois da medida administrativa.
 */
async function revogarAcesso(db, userId) {
  await db.query('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ? AND revoked = 0', [userId]);
  await db.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [userId]);
}

/** Nome e e-mail de vários usuários (para avisos). */
async function contatos(db, ids) {
  if (!ids || !ids.length) return [];
  const [rows] = await db.query('SELECT id, full_name, email FROM users WHERE id IN (?)', [ids]);
  return rows;
}

module.exports = {
  contatos, listar, detalhe, paraEdicao, paraExclusao, emailEmUsoPorOutro, emailExiste,
  atualizar, inserir, nomeECargo, excluirLogicamente, revogarAcesso,
};
