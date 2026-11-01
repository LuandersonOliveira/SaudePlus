/* ==========================================================================
   Saúde+ — segundo fator (TOTP): regras de negócio (A1 da Fase 6, passo 3).

   As rotas (`/auth/mfa/*` e o login) só validam a entrada, chamam estas funções
   e traduzem o resultado em resposta HTTP e auditoria. Nada aqui toca em
   `req`/`res`: cada função devolve `{ ok: true, ... }` ou `{ ok: false, status, error }`.
   ========================================================================== */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { randomSecret, verifyTotp, matchStep, replayBloqueia, otpauthUrl } = require('../utils/totp');
const {
  mfaAttempts, bloqueioMfa, registrarFalhaMfa, registrarSucessoMfa,
} = require('../utils/mfaAttempts');
const { payloadDoUsuario } = require('./session');

const falha = (status, error) => ({ ok: false, status, error });

/** Ticket de 5 min que o login entrega quando a senha está certa mas falta o segundo fator. */
function criarTicketMfa(userId) {
  return jwt.sign({ id: userId, purpose: 'mfa' }, process.env.JWT_SECRET, { expiresIn: '5m' });
}

function mensagemBloqueio(bloqueio) {
  return `Muitas tentativas de verificação. Tente de novo em ${Math.ceil(bloqueio.segundosRestantes / 60)} min.`;
}

/**
 * Troca ticket MFA + código TOTP pela identidade do usuário (a rota abre a sessão).
 *
 * @returns {Promise<{ok: true, user: object, payload: object} | {ok: false, status: number, error: string}>}
 */
async function verificarSegundoFator({ ticket, code }) {
  let claim;
  try {
    claim = jwt.verify(ticket, process.env.JWT_SECRET);
  } catch {
    return falha(401, 'Sessão MFA expirada. Entre novamente.');
  }
  if (!claim || claim.purpose !== 'mfa' || !claim.id) return falha(401, 'Ticket inválido.');

  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [claim.id]);
  const user = rows[0];
  if (!user || user.account_status !== 'ativo' || !user.totp_enabled || !user.totp_secret) {
    return falha(401, 'Verificação indisponível.');
  }

  // Teto de tentativas no segundo fator. O limite de senha protege o
  // primeiro fator; sem este, a rota virava uma porta sem trinco — 6 dígitos
  // testados indefinidamente, inclusive fora da janela de 30s.
  const bloqueio = bloqueioMfa(mfaAttempts, user.id);
  if (bloqueio) return falha(429, mensagemBloqueio(bloqueio));

  // Replay: o passo precisa ser estritamente maior que o último aceito.
  // Com WINDOW = ±1, o mesmo código vale por 90s; sem isto, um código
  // capturado (foto do app, log, alguém olhando por cima do ombro) abria
  // sessão nova quantas vezes quisesse dentro dessa janela.
  const casou = matchStep(user.totp_secret, code);
  const ultimoPasso = user.totp_last_step === null || user.totp_last_step === undefined
    ? null
    : Number(user.totp_last_step);

  // Código ERRADO é o que a força bruta ataca. Código de REPLAY é outra
  // coisa: o código estava certo, já foi usado, e a única coisa que a pessoa
  // fez foi clicar duas vezes. Contar replay como falha trancava o titular
  // por 5 minutos por um duplo clique — e ainda abria uma brecha contrária:
  // o atacante que captura um código e o reapresenta várias vezes seria
  // "beneficiado" pelo bloqueio, que só protege o titular de si mesmo.
  if (!casou.ok) {
    registrarFalhaMfa(mfaAttempts, user.id);
    // Mesma regra do lockout de senha: o erro que completa a cota responde
    // 429, dizendo já quando pode tentar de novo. Quem descobre o bloqueio
    // só na tentativa seguinte é quem fica cinco minutos apertando F5.
    const travou = bloqueioMfa(mfaAttempts, user.id);
    if (travou) return falha(429, mensagemBloqueio(travou));
    return falha(401, 'Código inválido.');
  }

  // Sem contar como tentativa: foi o mesmo código, duas vezes.
  if (replayBloqueia(ultimoPasso, casou.step)) return falha(401, 'Código já utilizado. Aguarde o próximo.');

  // Consome o passo do código na MESMA instrução que o grava.
  //
  // A versão anterior lia `totp_last_step`, comparava em JS e depois gravava
  // — e essa janela é o defeito: duas requisições simultâneas com o mesmo
  // ticket e o mesmo código liam o mesmo valor, as duas passavam na
  // comparação e as duas emitiam sessão. Bastava F5 duas vezes dentro da
  // janela de 30s. O booking já sabia disso e trava o profissional com
  // SELECT … FOR UPDATE; aqui a defesa é mais barata — o próprio UPDATE só
  // acontece para quem tem o passo estritamente maior.
  //
  // affectedRows === 0 significa que outro request consumiu este passo
  // entre a leitura e agora: é replay, e o login é recusado.
  try {
    const [gravou] = await pool.query(
      `UPDATE users SET totp_last_step = ?, last_login_at = CURRENT_TIMESTAMP
       WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)`,
      [casou.step, user.id, casou.step]
    );
    if (!gravou || gravou.affectedRows !== 1) {
      // Replay, não erro: outra requisição consumiu este passo entre a
      // leitura e agora. Não entra no contador de tentativas.
      return falha(401, 'Código já utilizado. Aguarde o próximo.');
    }
  } catch (updateError) {
    // Banco sem a coluna (migration não rodada): o login funciona, mas o
    // replay volta. Sinalizado no console — não é motivo para negar o
    // segundo fator a quem já tem MFA funcionando.
    if (updateError.code !== 'ER_BAD_FIELD_ERROR') throw updateError;
    console.warn('mfa: coluna users.totp_last_step ausente — rode npm run db:migrate (replay do TOTP fica desprotegido)');
    await pool.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [user.id])
      .catch((e) => { if (e.code !== 'ER_BAD_FIELD_ERROR') throw e; });
  }
  registrarSucessoMfa(mfaAttempts, user.id);
  return { ok: true, user, payload: payloadDoUsuario(user) };
}

/**
 * Gera o segredo (ainda não ativo) e o texto do otpauth://.
 *
 * Exige a SENHA do titular, não só o token. Um Bearer válido já pode ser
 * consequência de XSS, log de JWT ou máquina compartilhada — e quem tivesse
 * um token poderia ler o segredo gerado, ativar o MFA com um código próprio e
 * passar a controlar o segundo fator do usuário. Com a senha, só o titular
 * re-enrola. Quem já tem MFA ativo precisa desativar antes: esta função nunca
 * devolve o segredo vigente.
 */
async function iniciarCadastroMfa({ userId, email, password }) {
  const [[user]] = await pool.query('SELECT password_hash, totp_enabled FROM users WHERE id = ?', [userId]);
  if (!user) return falha(404, 'Usuário não encontrado.');
  if (user.totp_enabled) return falha(400, 'O segundo fator já está ativo. Desative-o antes de gerar um novo.');

  // bcrypt.compare não deve virar 500 se o hash estiver corrompido no banco.
  const senhaConfere = await bcrypt.compare(String(password), user.password_hash || '').catch(() => false);
  if (!senhaConfere) return falha(401, 'Senha incorreta.');

  const secret = randomSecret();
  await pool.query('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?', [secret, userId]);
  return { ok: true, secret, otpauthUrl: otpauthUrl({ secret, email }) };
}

/** Confirma o código do app e liga o segundo fator. */
async function ativarMfa({ userId, code }) {
  const [[user]] = await pool.query('SELECT totp_secret, totp_enabled FROM users WHERE id = ?', [userId]);
  if (!user || !user.totp_secret) return falha(400, 'Gere o segredo primeiro.');
  if (!verifyTotp(user.totp_secret, code)) return falha(401, 'Código inválido.');
  await pool.query('UPDATE users SET totp_enabled = 1 WHERE id = ?', [userId]);
  return { ok: true };
}

/** Desliga o segundo fator (exige a senha). */
async function desativarMfa({ userId, password }) {
  const [[user]] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [userId]);
  if (!user) return falha(404, 'Usuário não encontrado.');
  const ok = await bcrypt.compare(password || '', user.password_hash);
  if (!ok) return falha(401, 'Senha incorreta.');
  await pool.query('UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?', [userId]);
  return { ok: true };
}

module.exports = { criarTicketMfa, verificarSegundoFator, iniciarCadastroMfa, ativarMfa, desativarMfa };
