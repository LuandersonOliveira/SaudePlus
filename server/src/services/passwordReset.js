/* ==========================================================================
   Saúde+ — recuperação de senha (Fase 7; A1 da Fase 6, passo 4).

   O pedido (`solicitarRedefinicao`) NUNCA diz se a conta existe: a rota
   responde sempre igual. A diferença é o que impede a rota de virar um
   enumerador de contas — num sistema de saúde, saber quem tem cadastro já é
   informação sensível.

   O token é como o `refresh_tokens`: só o SHA-256 vai para o banco, tem prazo
   curto, é de uso único (`used_at`) e um pedido novo invalida o anterior. E
   redefinir a senha DERRUBA as sessões abertas — quem roubou o link pode estar
   com um refresh válido, e a troca de senha é justamente o que a vítima faz
   para expulsar quem roubou.

   Nada aqui toca em `req`/`res`; a rota responde e audita.
   ========================================================================== */
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../db');
const mailer = require('./mailer');
const { hashRefreshToken: hashToken } = require('./session');

const PASSWORD_RESET_EXPIRES_IN = process.env.PASSWORD_RESET_EXPIRES_IN || '1h';

// Mesmo teto do front (minlength=6 no formulário de cadastro) — o front não
// é a validação, e um cliente direto não passa por ele.
const SENHA_RESET_MIN = 6;

const LINK_INVALIDO = 'Link inválido ou expirado. Peça um novo.';
const MENSAGEM_PEDIDO = 'Se houver uma conta com este e-mail, enviaremos um link para redefinir a senha.';

function passwordResetTtlMs() {
  const m = String(PASSWORD_RESET_EXPIRES_IN).trim().match(/^(\d+)\s*([smhd])$/i);
  if (!m) return 60 * 60 * 1000;
  const n = Number(m[1]);
  const unit = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2].toLowerCase()];
  return n * unit;
}

/** Base do link enviado no e-mail. Vem do ambiente; nunca de entrada do usuário. */
function baseDoApp() {
  return String(process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');
}

/**
 * Cria o token e envia o e-mail, se (e só se) existir uma conta ativa.
 *
 * @returns {Promise<{enviado: false} | {enviado: true, userId: string, envio: object}>}
 *   `enviado: false` cobre e-mail inválido, conta inexistente e conta desativada — e a
 *   rota não pode distinguir os três na resposta.
 */
async function solicitarRedefinicao(emailBruto) {
  const email = String(emailBruto || '').toLowerCase().trim();
  if (!email || !email.includes('@')) return { enviado: false };

  const [[user]] = await pool.query(
    'SELECT id, email, full_name, account_status FROM users WHERE email = ?',
    [email]
  );
  // Conta inexistente ou desativada: nenhum e-mail, nenhuma linha no banco.
  if (!user || user.account_status !== 'ativo') return { enviado: false };

  // Um pedido novo invalida os anteriores: o link que está no e-mail de
  // alguém há uma semana deixa de valer assim que a pessoa pede outro.
  await pool.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [user.id]);

  const raw = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + passwordResetTtlMs());
  await pool.query(
    'INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?,?,?,?)',
    [crypto.randomUUID(), user.id, hashToken(raw), expiresAt]
  );

  // /auth é a rota do front React (o auth.html legado foi aposentado).
  const link = `${baseDoApp()}/auth?tab=reset&token=${raw}`;
  const envio = await mailer.enviar({
    para: user.email,
    assunto: 'Redefinição de senha — Saúde+',
    texto: [
      `Olá, ${user.full_name || ''}`.trim(),
      '',
      'Recebemos um pedido para redefinir sua senha do Saúde+.',
      `O link vale até ${expiresAt.toLocaleString('pt-BR')} e só pode ser usado uma vez.`,
      '',
      link,
      '',
      'Se não foi você, ignore este e-mail: nada muda e ninguém precisa saber que você tem conta.',
    ].join('\n'),
  });
  return { enviado: true, userId: user.id, envio };
}

/**
 * Consome o token e troca a senha.
 *
 * Status: 401 para link ausente/inválido/vencido/já usado (mesma mensagem para
 * todos); 400 para senha curta — e nesse caso o token NÃO é consumido: uma senha
 * recusada por validação não pode queimar o link, senão um erro de digitação
 * obriga a esperar de novo.
 *
 * @returns {Promise<{ok: true, userId: string} | {ok: false, status: number, error: string}>}
 */
async function redefinirSenha({ token, password }) {
  if (!token || !password) return { ok: false, status: 401, error: LINK_INVALIDO };
  if (typeof password !== 'string' || password.length < SENHA_RESET_MIN) {
    return { ok: false, status: 400, error: `A senha precisa ter pelo menos ${SENHA_RESET_MIN} caracteres.` };
  }

  const [[row]] = await pool.query(
    'SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ?',
    [hashToken(String(token))]
  );
  const invalido = !row || row.used_at || new Date(row.expires_at).getTime() < Date.now();
  if (invalido) return { ok: false, status: 401, error: LINK_INVALIDO };

  // UPDATE condicional: `used_at IS NULL` faz o uso único ser atômico.
  // Dois cliques em paralelo no mesmo link não abrem duas redefinições.
  const hash = await bcrypt.hash(password, 10);
  const [consumido] = await pool.query(
    'UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ? AND used_at IS NULL',
    [row.id]
  );
  if (consumido.affectedRows === 0) return { ok: false, status: 401, error: LINK_INVALIDO };

  await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, row.user_id]);

  // Derruba as sessões abertas. Sem isto, um refresh token roubado continua
  // valendo depois da troca de senha.
  await pool.query('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ? AND revoked = 0', [row.user_id]);
  return { ok: true, userId: row.user_id };
}

module.exports = {
  solicitarRedefinicao, redefinirSenha, passwordResetTtlMs, baseDoApp,
  SENHA_RESET_MIN, LINK_INVALIDO, MENSAGEM_PEDIDO,
};
