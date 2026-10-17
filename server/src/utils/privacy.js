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
  // Tudo ou nada.
  //
  // As 6 escritas abaixo eram independentes. Se a terceira falhasse, o estado
  // deixado era o pior possível num pedido do art. 18, VI: o perfil JÁ estava
  // apagado, mas as consultas futuras NÃO foram canceladas e os refresh tokens
  // continuavam válidos. O titular estava removido e mesmo assim conseguia
  // entrar e tinha agenda — e, sem e-mail nem telefone, nunca saberia.
  //
  // A auditoria fica de fora de propósito: ela registra que a anonimização
  // ACABOU. Uma linha "perfil anonimizado" com o commit ainda pendente seria
  // um registro de algo que talvez nem tenha sido persistido.
  // Exige um pool de verdade (com getConnection). Degrada para "roda sem
  // transação" seria uma armadilha: a atomicidade sumiria em silêncio, e o
  // estado parcial que ela evita é justamente o que não pode acontecer num
  // pedido de exclusão. Melhor um erro visível na hora do bug.
if (!pool || typeof pool.getConnection !== 'function') {
    throw new TypeError(
      'anonymizeUser exige um pool com getConnection() — sem transação a exclusão ficaria pela metade'
    );
  }
  const db = await pool.getConnection();
  try {
    // A existência é conferida antes de abrir a transação: para usuário
    // inexistente não há o que transacionar, e abrir/reverter só para isso é
    // ruído. Todo o resto — o que importa — fica dentro.
    const [[existe]] = await db.query('SELECT id FROM users WHERE id = ?', [userId]);
    if (!existe) return false;

    await db.beginTransaction();

    const removedEmail = `removido_${userId}@removido.local`;
    await db.query(
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
      await db.query(
        `UPDATE ${table} SET status = 'cancelado', notes = NULL
       WHERE user_id = ? AND scheduled_at > CURRENT_TIMESTAMP
       AND status IN ('pendente', 'confirmado')`,
        [userId]
      );
    }

    await db.query('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', [userId]);
    await db.commit();

    // Só depois do commit a trilha registra o que aconteceu.
    await logAction(userId, 'lgpd_delete', 'user', userId, `perfil anonimizado (${reason})`);
    return true;
  } catch (err) {
    // Só reverte se a transação chegou a ser aberta; no caminho do SELECT
    // inicial pode não haver rollback pendente.
    try { await db.rollback(); } catch { /* já desfeita */ }
    throw err;
  } finally {
    if (typeof db.release === 'function') db.release();
  }
}

module.exports = { PRIVACY_VERSION, anonymizeUser };
