/* ==========================================================================
   Saúde+ — perfil do próprio titular e direitos LGPD (A1 da Fase 6, passo 5).

   Leitura (GET /auth/me), portabilidade (GET /auth/me/export), atualização
   parcial (PUT /auth/me) e eliminação por anonimização (DELETE /auth/me).

   Os documentos (cpf/rg/cns) são cifrados em repouso. A cifra/decifra chega por
   parâmetro (`docs = { encrypt, decrypt }`, o que a rota tem em req.encryptDoc /
   req.decryptDoc), para o serviço não conhecer a chave. Nada aqui toca em
   `req`/`res`: as funções devolvem `{ ok: true, ... }` ou `{ ok: false, status, error }`.
   ========================================================================== */
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { PRIVACY_VERSION, anonymizeUser } = require('../utils/privacy');
const { hmacCpf, ehCpfDuplicado, MENSAGEM_CPF_DUPLICADO } = require('../utils/cpf');
const { normalizarAtualizacaoPerfil } = require('../schemas/profile');

const falha = (status, error) => ({ ok: false, status, error });
const NAO_ENCONTRADO = 'Usuário não encontrado.';

/**
 * Perfil completo do próprio usuário, com documentos decifrados (P4: "complete seu
 * perfil"). É dado do próprio titular, mesma regra do export; `password_hash` e
 * `totp_secret` nunca saem (colunas fora do SELECT).
 */
async function obterPerfil(userId, { decrypt }) {
  const [rows] = await pool.query(
    `SELECT id, full_name, social_name, email, role, account_status,
            phone, mobile, birth_date, gender, priority, race, guardian_name, blood_type,
            mother_name, father_name, cpf, rg, cns,
            cep, street, address_number, neighborhood, city, state, zone, reference_point,
            job_role, totp_enabled, created_at
     FROM users WHERE id = ?`,
    [userId]
  );
  if (!rows.length) return falha(404, NAO_ENCONTRADO);
  const user = rows[0];
  for (const col of ['cpf', 'rg', 'cns']) {
    try { user[col] = decrypt(user[col]); } catch { user[col] = null; }
  }
  return { ok: true, user };
}

/**
 * Portabilidade (LGPD art. 18, V): tudo que o sistema guarda sobre o titular, incluindo
 * documentos decifrados e registro de consentimento.
 *
 * Segurança (P0.1): credenciais NUNCA saem aqui. `password_hash` e `totp_secret` são
 * removidos — exportar o segredo TOTP inverteria o controle do segundo fator
 * (com ele + relógio, recria-se o MFA).
 */
async function exportarDados(userId, { decrypt }) {
  const [[profile]] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
  if (!profile) return falha(404, NAO_ENCONTRADO);
  const [appointments] = await pool.query('SELECT * FROM appointments WHERE user_id = ? ORDER BY scheduled_at DESC', [userId]);
  const [exams] = await pool.query('SELECT * FROM exams WHERE user_id = ? ORDER BY scheduled_at DESC', [userId]);
  const [reminders] = await pool.query('SELECT * FROM reminders WHERE user_id = ? ORDER BY remind_at DESC', [userId]);
  // Segredos removidos antes de qualquer serialização.
  delete profile.password_hash;
  delete profile.totp_secret;
  for (const col of ['cpf', 'rg', 'cns']) {
    try { profile[col] = decrypt(profile[col]); } catch { profile[col] = '[ilegível: chave ausente]'; }
  }
  return {
    ok: true,
    dados: {
      exported_at: new Date().toISOString(),
      privacy_version: PRIVACY_VERSION,
      profile, appointments, exams, reminders,
    },
  };
}

/**
 * Atualização parcial do perfil. Validação em schemas/profile.js; aqui entram a
 * cifra dos documentos, o índice cego do CPF e o UPDATE.
 *
 * @returns {Promise<{ok: true, atualizados: number, campos: string[]} | {ok: false, status: number, error: string}>}
 *   `atualizados` conta colunas gravadas (o CPF conta 2: `cpf` e `cpf_hmac`); `campos` lista os campos pedidos.
 */
async function atualizarPerfil(userId, body, { encrypt }) {
  const n = normalizarAtualizacaoPerfil(body);
  if (!n.ok) return falha(400, n.error);

  const sets = n.campos.map(([coluna]) => `${coluna}=?`);
  const params = n.campos.map(([, valor]) => valor);

  const { cpf, rg, cns } = n.documentos;
  if ('cpf' in n.documentos) {
    sets.push('cpf=?', 'cpf_hmac=?');
    params.push(cpf === null ? null : encrypt(cpf), cpf === null ? null : hmacCpf(cpf));
  }
  if ('rg' in n.documentos) {
    sets.push('rg=?');
    params.push(rg === null ? null : encrypt(rg));
  }
  if ('cns' in n.documentos) {
    sets.push('cns=?');
    params.push(cns === null ? null : encrypt(cns));
  }

  try {
    await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...params, userId]);
  } catch (err) {
    if (ehCpfDuplicado(err)) return falha(409, MENSAGEM_CPF_DUPLICADO);
    throw err;
  }
  // `campos`: NOMES das colunas gravadas (para a trilha). Nunca os valores: ADR-0012.
  const campos = [...n.campos.map(([coluna]) => coluna), ...Object.keys(n.documentos)];
  return { ok: true, atualizados: sets.length, campos };
}

/**
 * Eliminação (LGPD art. 18, VI) via anonimização: exige a senha e torna a conta
 * inutilizável. Histórico clínico vira estatística anônima; a auditoria é preservada.
 * Encerrar a sessão da requisição fica com a rota.
 */
async function excluirConta(userId, password) {
  const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [userId]);
  if (!rows.length) return falha(404, NAO_ENCONTRADO);
  const ok = await bcrypt.compare(password, rows[0].password_hash);
  if (!ok) return falha(401, 'Senha incorreta.');
  await anonymizeUser(pool, userId);
  return { ok: true };
}

module.exports = { obterPerfil, exportarDados, atualizarPerfil, excluirConta };
