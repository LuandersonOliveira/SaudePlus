/* ==========================================================================
   Saúde+ — cadastro, login e Login Único Gov.br (A1 da Fase 6, passo 6).

   As rotas validam a entrada (middleware/validate + schemas/auth), chamam estas
   funções e traduzem o resultado em sessão/cookie, auditoria e resposta. Nada
   aqui toca em `req`/`res`: cada função devolve `{ ok: true, ... }` ou
   `{ ok: false, status, error, ... }`.
   ========================================================================== */
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../db');
const govbr = require('./govbr');
const { criarTicketMfa } = require('./mfa');
const { payloadDoUsuario } = require('./session');
const { digitsOnly, VALID_PRIORITIES, VALID_RACES } = require('../utils/validators');
const {
  loginKey, loginBlockInfo, registerLoginFailure, registerLoginSuccess,
} = require('../utils/loginThrottle');
const { PRIVACY_VERSION } = require('../utils/privacy');
const { cpfIgual, hmacCpf, ehCpfDuplicado, MENSAGEM_CPF_DUPLICADO } = require('../utils/cpf');

const VALID_ROLES = ['paciente', 'atendente'];
const falha = (status, error, extra = {}) => ({ ok: false, status, error, ...extra });
const EMAIL_JA_CADASTRADO = 'Este e-mail já está cadastrado.';
const CONTA_DESATIVADA = 'Conta desativada. Entre em contato com a administração.';

// --------------------------------------------------------------------------
// Proteção contra força bruta no login (TAREFAS V3, item 6.3).
// A lógica mora em utils/loginThrottle.js, com o relógio injetado — assim é
// testável sem esperar 5 minutos. A chave é `ip|e-mail` (não só o IP): um ataque
// a uma conta não tranca as demais nem quem está atrás do mesmo proxy.
// --------------------------------------------------------------------------
const loginAttempts = new Map(); // "ip|email" -> { count, windowEndsAt, blockedUntil }

// ---------------------------------------------------------------------------
// Cadastro
// ---------------------------------------------------------------------------

/**
 * Cria a conta. O corpo já passou por validate(signupBody).
 *
 * Fase 1 (LGPD): documentos cifrados em repouso (AES-256-GCM) + CPF normalizado
 * para só dígitos + registro do consentimento (versão da política, momento e IP —
 * prova da base legal). Atendente nasce `pendente`: precisa de ativação pelo admin.
 *
 * @param {object} body corpo validado
 * @param {{encrypt: Function, ip: string}} ctx
 * @returns {Promise<{ok: true, id: string, message: string|null} | {ok: false, status: number, error: string}>}
 */
async function cadastrar(body, { encrypt, ip }) {
  const {
    email, password, full_name, role,
    social_name: socialName, cns, priority, race, guardian_name: guardianName,
    phone, mobile, birth_date: birthDate, gender, blood_type,
    mother_name, father_name, cpf, rg,
    cep, street, address_number, neighborhood, city, state,
    zone, reference_point: referencePoint,
    job_role,
  } = body;

  const assignedRole = VALID_ROLES.includes(role) ? role : 'paciente';
  const initialStatus = assignedRole === 'atendente' ? 'pendente' : 'ativo';
  const normalizedEmail = String(email).toLowerCase().trim();

  const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
  if (existing.length) return falha(409, EMAIL_JA_CADASTRADO);

  const passwordHash = await bcrypt.hash(password, 10);
  const id = crypto.randomUUID();

  try {
    await pool.query(
      `INSERT INTO users
        (id, full_name, social_name, email, password_hash, role, account_status,
         cns, priority, race, guardian_name,
         phone, mobile, birth_date, gender, blood_type,
         mother_name, father_name, cpf, cpf_hmac, rg,
         cep, street, address_number, neighborhood, city, state, zone, reference_point,
         job_role, privacy_version, consent_at, consent_ip)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?)`,
      [
        id, full_name, socialName || null, normalizedEmail, passwordHash, assignedRole, initialStatus,
        encrypt(cns ? digitsOnly(cns) : null),
        priority && VALID_PRIORITIES.includes(priority) ? priority : null,
        race && VALID_RACES.includes(race) ? race : null,
        guardianName || null,
        phone || null, mobile || null,
        birthDate, gender || null, blood_type || null,
        mother_name || null, father_name || null,
        encrypt(digitsOnly(cpf) || null), hmacCpf(cpf), encrypt(rg ? String(rg).trim() : null),
        cep || null, street || null, address_number || null,
        neighborhood || null, city || null, state || null,
        zone || null, referencePoint || null,
        assignedRole === 'atendente' ? (job_role || null) : null,
        PRIVACY_VERSION, ip,
      ]
    );
  } catch (err) {
    // A checagem de e-mail acima não é atômica: dois cadastros simultâneos passam por ela.
    // O UNIQUE do banco é quem decide, e a resposta é a mesma do caso sequencial.
    if (ehCpfDuplicado(err)) return falha(409, MENSAGEM_CPF_DUPLICADO);
    if (err && err.code === 'ER_DUP_ENTRY' && /email/i.test(String(err.message))) return falha(409, EMAIL_JA_CADASTRADO);
    throw err;
  }

  return {
    ok: true,
    id,
    message: assignedRole === 'atendente'
      ? 'Conta criada! Aguarde a ativação pelo administrador antes de fazer login.'
      : null,
  };
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

/** Registra o acesso. Banco sem a coluna (fora do baseline) só avisa: o login não pode cair por isso. */
async function registrarAcesso(userId) {
  try {
    await pool.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [userId]);
  } catch (updateError) {
    if (updateError.code !== 'ER_BAD_FIELD_ERROR') throw updateError;
    console.warn('Coluna last_login_at ausente; recrie o banco com `npm run db:setup -- --fresh <banco>` (ou rode o doctor).');
  }
}

/** Com MFA ativo a senha não basta: devolve um ticket e a sessão só sai após o segundo fator. */
function resultadoDeLogin(user) {
  const base = { ok: true, userId: user.id, payload: payloadDoUsuario(user) };
  return user.totp_enabled
    ? { ...base, mfaRequired: true, ticket: criarTicketMfa(user.id) }
    : { ...base, mfaRequired: false };
}

/**
 * Autentica por e-mail e senha (com limite de tentativas por IP+conta).
 *
 * @param {{email: string, password: string, ip: string}} credenciais
 * @returns {Promise<{ok: true, userId: string, payload: object, mfaRequired: boolean, ticket?: string}
 *   | {ok: false, status: number, error: string}>}
 */
async function autenticar({ email, password, ip }) {
  const normalizedEmail = String(email).toLowerCase().trim();
  const chave = loginKey(ip, normalizedEmail);

  const blocked = loginBlockInfo(loginAttempts, chave);
  if (blocked) {
    const seconds = Math.ceil((blocked.blockedUntil - Date.now()) / 1000);
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    return falha(429, `Muitas tentativas de login. Tente novamente em ${minutes} minuto(s).`);
  }

  const [rows] = await pool.query('SELECT * FROM users WHERE email = ? AND (deleted_at IS NULL)', [normalizedEmail]);
  if (!rows.length) {
    registerLoginFailure(loginAttempts, chave);
    return falha(401, 'Credenciais inválidas.');
  }
  const user = rows[0];

  if (user.account_status !== 'ativo') {
    // Status da conta não é erro de senha — não conta como tentativa de força bruta.
    return falha(403, user.account_status === 'pendente'
      ? 'Conta aguardando ativação. Entre em contato com a administração.'
      : CONTA_DESATIVADA);
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    registerLoginFailure(loginAttempts, chave);
    return falha(401, 'Credenciais inválidas.');
  }
  registerLoginSuccess(loginAttempts, chave);

  await registrarAcesso(user.id);
  return resultadoDeLogin(user);
}

// ---------------------------------------------------------------------------
// Login Único Gov.br
// ---------------------------------------------------------------------------

/**
 * Acha a conta do perfil Gov.br: por `govbr_sub`, depois e-mail, depois CPF.
 * Não cria usuário. O CPF está cifrado (IV aleatório), então a busca usa o índice
 * cego `cpf_hmac` e, no único candidato, confere o dado cifrado em tempo constante
 * (o índice só aponta; quem decide é o dado — protege de linha com HMAC defasado).
 */
async function acharContaGovbr(profile, decrypt) {
  const [[bySub]] = await pool.query('SELECT * FROM users WHERE govbr_sub = ?', [profile.sub]);
  if (bySub) return bySub;

  if (profile.email) {
    const [[byEmail]] = await pool.query('SELECT * FROM users WHERE email = ?', [profile.email]);
    if (byEmail) return byEmail;
  }
  if (profile.cpf) {
    const h = hmacCpf(profile.cpf);
    if (h) {
      // Só `id` e `cpf` saem do banco (nada de `SELECT *` com password_hash).
      const [[achado]] = await pool.query('SELECT id, cpf FROM users WHERE cpf_hmac = ?', [h]);
      let confere = false;
      if (achado) {
        try { confere = cpfIgual(decrypt(achado.cpf), profile.cpf); } catch { confere = false; }
      }
      if (confere) {
        const [[completo]] = await pool.query('SELECT * FROM users WHERE id = ?', [achado.id]);
        return completo || null;
      }
    }
  }
  return null;
}

/**
 * Conclui o retorno do Gov.br (`?code=`). Vincula a conta existente; NÃO cria usuário.
 * Sem vínculo: 404 + `govbr_profile` para o front pré-preencher o cadastro normal.
 *
 * @returns {Promise<{ok: true, userId: string, payload: object, mfaRequired: boolean, ticket?: string}
 *   | {ok: false, status: number, error: string, govbr_profile?: object}>}
 */
async function entrarComGovbr({ code, decrypt }) {
  const tokens = await govbr.exchangeCode(String(code));
  const profile = await govbr.fetchUserInfo(tokens.access_token);
  if (!profile.sub) return falha(502, 'Gov.br não retornou identificador.');

  const user = await acharContaGovbr(profile, decrypt);
  if (!user) {
    return falha(404, 'Conta Gov.br sem vínculo. Complete o cadastro com estes dados.', {
      govbr_profile: { nome: profile.nome, email: profile.email, cpf: profile.cpf, telefone: profile.telefone },
    });
  }
  if (user.account_status !== 'ativo') return falha(403, CONTA_DESATIVADA);

  if (!user.govbr_sub) {
    await pool.query('UPDATE users SET govbr_sub = ? WHERE id = ?', [profile.sub, user.id]);
  }
  try {
    await pool.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
  } catch (updateError) {
    if (updateError.code !== 'ER_BAD_FIELD_ERROR') throw updateError;
  }
  return resultadoDeLogin(user);
}

module.exports = { cadastrar, autenticar, entrarComGovbr, loginAttempts };
