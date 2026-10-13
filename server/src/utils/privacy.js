// ==========================================================================
// Saúde+ — Privacidade LGPD (Fase 1)
// - PRIVACY_VERSION: versiona o texto aceito no cadastro (consentimento).
// - anonymizeUser: "eliminação" do art. 18, VI via ANONIMIZAÇÃO (não hard
//   delete): preserva audit_log (append-only, FK) e estatísticas de saúde,
//   remove todos os identificadores do titular. Reversível? NÃO — é o ponto.
// ==========================================================================
const crypto = require('crypto');
const { logAction } = require('./audit');

const PRIVACY_VERSION = 'v1-2026-10-09';

async function anonymizeUser(pool, userId, { reason = 'pedido do titular' } = {}) {
  const [[user]] = await pool.query('SELECT id, email FROM users WHERE id = ?', [userId]);
  if (!user) return false;

  const removedEmail = `removido_${userId}@removido.local`;
  await pool.query(
    `UPDATE users SET
       full_name = 'Titular removido', social_name = NULL,
       email = ?, password_hash = ?,
       phone = NULL, mobile = NULL, cpf = NULL, rg = NULL, cns = NULL,
       birth_date = NULL, gender = NULL, priority = NULL, race = NULL,
       blood_type = NULL, mother_name = NULL, father_name = NULL,
       guardian_name = NULL,
       cep = NULL, street = NULL, address_number = NULL, neighborhood = NULL,
       city = NULL, state = NULL, zone = NULL, reference_point = NULL,
       job_role = NULL, account_status = 'inativo', deleted_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [removedEmail, crypto.randomBytes(32).toString('hex'), userId]
  );

  // Consultas/exames futuros são cancelados; histórico passado vira estatística
  // anônima (sem vínculo identificável, pois o perfil foi apagado).
  for (const table of ['appointments', 'exams']) {
    await pool.query(
      `UPDATE ${table} SET status = 'cancelado', notes = NULL
       WHERE user_id = ? AND scheduled_at > CURRENT_TIMESTAMP
       AND status IN ('pendente', 'confirmado')`,
      [userId]
    );
  }

  await pool.query('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', [userId]);
  await logAction(userId, 'lgpd_delete', 'user', userId, `perfil anonimizado (${reason})`);
  return true;
}

module.exports = { PRIVACY_VERSION, anonymizeUser };
