// ==========================================================================
// Saúde+ — Privacidade LGPD (Fase 1)
// - PRIVACY_VERSION: versiona o texto aceito no cadastro (consentimento).
// - anonymizeUser: "eliminação" do art. 18, VI via ANONIMIZAÇÃO (não hard
//   delete): preserva audit_log (append-only, FK) e estatísticas de saúde,
//   remove todos os identificadores do titular. Reversível? NÃO — é o ponto.
//
// ADR-0009: é o ÚNICO caminho de eliminação de conta. Quem pede é o titular
// (DELETE /auth/me), o expurgo de inatividade ou o admin (DELETE /admin/users/:id).
// ==========================================================================
const crypto = require('crypto');
const { logAction } = require('./audit');

const PRIVACY_VERSION = 'v1-2026-10-09';

/**
 * As escritas da eliminação, SEM abrir nem fechar transação: quem chama controla o
 * BEGIN/COMMIT. Existe separada para o admin poder anonimizar na MESMA transação que
 * solta o vínculo com o profissional e derruba as sessões.
 *
 * Zera tudo que identifica a pessoa ou guarda segredo dela: documentos, contato,
 * endereço, `govbr_sub` (vínculo com o Gov.br), `consent_ip` (IP é dado pessoal) e o
 * segundo fator (`totp_*`). `consent_at` e `privacy_version` ficam: dizem qual texto
 * foi aceito e quando, sem identificar ninguém.
 *
 * `deleted_at` usa COALESCE para não sobrescrever a data de uma exclusão anterior
 * (o script de correção das contas "excluídas" pelo admin antes do ADR-0009).
 */
async function anonimizarNaTransacao(db, userId) {
  const removedEmail = `removido_${userId}@removido.local`;
  await db.query(
    `UPDATE users SET
       full_name = 'Titular removido', social_name = NULL,
       email = ?, password_hash = ?,
       phone = NULL, mobile = NULL, cpf = NULL, cpf_hmac = NULL, rg = NULL, cns = NULL,
       birth_date = NULL, gender = NULL, priority = NULL, race = NULL,
       blood_type = NULL, mother_name = NULL, father_name = NULL,
       guardian_name = NULL,
       cep = NULL, street = NULL, address_number = NULL, neighborhood = NULL,
       city = NULL, state = NULL, zone = NULL, reference_point = NULL,
       job_role = NULL, govbr_sub = NULL, consent_ip = NULL,
       totp_secret = NULL, totp_enabled = 0, totp_last_step = NULL,
       account_status = 'inativo', deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP)
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
  // Links de redefinição pendentes: sem isto, um e-mail antigo ainda poderia trocar a senha.
  await db.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [userId]);
}

/**
 * Registra na trilha que a eliminação ACABOU. Só depois do COMMIT: uma linha "perfil
 * anonimizado" com a transação ainda pendente seria o registro de algo que talvez nem
 * tenha sido gravado. `actorId` é quem pediu (o admin, no caso administrativo); sem ele,
 * o próprio titular.
 */
async function registrarEliminacao(userId, { reason = 'pedido do titular', actorId = null } = {}) {
  await logAction(actorId || userId, 'lgpd_delete', 'user', userId, `perfil anonimizado (${reason})`);
}

async function anonymizeUser(pool, userId, { reason = 'pedido do titular', actorId = null } = {}) {
  // Tudo ou nada.
  //
  // As escritas eram independentes. Se a terceira falhasse, o estado deixado era o
  // pior possível num pedido do art. 18, VI: o perfil JÁ estava apagado, mas as
  // consultas futuras NÃO foram canceladas e os refresh tokens continuavam válidos.
  // O titular estava removido e mesmo assim conseguia entrar e tinha agenda — e, sem
  // e-mail nem telefone, nunca saberia.
  //
  // Exige um pool de verdade (com getConnection). Degrada para "roda sem transação"
  // seria uma armadilha: a atomicidade sumiria em silêncio, e o estado parcial que ela
  // evita é justamente o que não pode acontecer num pedido de exclusão. Melhor um erro
  // visível na hora do bug.
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
    await anonimizarNaTransacao(db, userId);
    await db.commit();

    await registrarEliminacao(userId, { reason, actorId });
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

module.exports = { PRIVACY_VERSION, anonymizeUser, anonimizarNaTransacao, registrarEliminacao };
