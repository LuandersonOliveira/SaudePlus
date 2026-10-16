const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../db');
const { verifyToken } = require('../middleware/auth');
const {
  digitsOnly, signupSchema, isValidCPF, isValidCNS,
  VALID_PRIORITIES, VALID_RACES, validateEnum, validateDate,
} = require('../utils/validators');
const { PRIVACY_VERSION, anonymizeUser } = require('../utils/privacy');
const { govbrConfig, buildAuthorizeUrl, exchangeCode, fetchUserInfo } = require('../services/govbr');
const { randomSecret, verifyTotp, otpauthUrl } = require('../utils/totp');

const router = express.Router();

const VALID_ROLES = ['paciente', 'atendente'];
// As listas de ENUM e os validadores vivem em utils/validators.js (fonte
// única, copiadas dos ENUMs do schema) para que signup e PUT /auth/me não
// divirjam entre si.

// --------------------------------------------------------------------------
// Sessão curta + refresh rotativo (Fase 0, item 0.3 — alinhado ao padrão RNDS
// de access de 15 min). Access continua Bearer; refresh via cookie httpOnly
// (+ body p/ clientes sem cookie, ex. fetch sem credentials).
// Guarda-se só o SHA-256 do refresh; roubo detectado por reuso => revoga família.
// --------------------------------------------------------------------------
const ACCESS_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '30d';
const REFRESH_COOKIE = 'saude_refresh';

function refreshTtlMs() {
  const m = String(REFRESH_EXPIRES_IN).trim().match(/^(\d+)\s*([smhd])$/i);
  if (!m) return 30 * 24 * 60 * 60 * 1000;
  const n = Number(m[1]);
  const unit = { s: 1000, m: 60 * 1000, h: 3600 * 1000, d: 24 * 3600 * 1000 }[m[2].toLowerCase()];
  return n * unit;
}

function hashRefreshToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

function signAccessToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: ACCESS_EXPIRES_IN });
}

function setRefreshCookie(res, raw) {
  res.cookie(REFRESH_COOKIE, raw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/auth',
    maxAge: refreshTtlMs(),
  });
}

async function issueRefreshToken(userId, family) {
  const raw = crypto.randomBytes(48).toString('hex');
  const id = crypto.randomUUID();
  const fam = family || crypto.randomUUID();
  const expiresAt = new Date(Date.now() + refreshTtlMs());
  await pool.query(
    'INSERT INTO refresh_tokens (id, user_id, token_hash, family, expires_at) VALUES (?,?,?,?,?)',
    [id, userId, hashRefreshToken(raw), fam, expiresAt]
  );
  return { raw, id, family: fam };
}

function readRefreshRaw(req) {
  return (req.body && req.body.refreshToken) || (req.cookies && req.cookies[REFRESH_COOKIE]) || null;
}

// --------------------------------------------------------------------------
// Validações de dados essenciais (TAREFAS V3, item 6.2).
// CPF/CNS/e-mail centralizados em utils/validators.js (Fase 0, item 0.4).
// --------------------------------------------------------------------------
function ageInYears(birthDateStr) {
  const birth = new Date(birthDateStr + 'T00:00:00');
  if (isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

// --------------------------------------------------------------------------
// Proteção contra força bruta no login (TAREFAS V3, item 6.3):
// 5 tentativas erradas => bloqueio de 5 minutos para aquele IP.
// --------------------------------------------------------------------------
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const loginAttempts = new Map(); // ip -> { count, windowEndsAt, blockedUntil }

function clientIp(req) {
  return req.ip || (req.socket && req.socket.remoteAddress) || 'desconhecido';
}

function loginBlockInfo(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry) return null;
  const now = Date.now();
  if (entry.blockedUntil && entry.blockedUntil > now) return entry;
  if (entry.windowEndsAt && entry.windowEndsAt < now) loginAttempts.delete(ip);
  return null;
}

function registerLoginFailure(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip) || { count: 0, windowEndsAt: now + LOGIN_WINDOW_MS };
  if (entry.blockedUntil && entry.blockedUntil > now) return entry;
  if (entry.windowEndsAt < now) {
    entry.count = 0;
    entry.windowEndsAt = now + LOGIN_WINDOW_MS;
  }
  entry.count += 1;
  if (entry.count >= LOGIN_MAX_ATTEMPTS) {
    entry.blockedUntil = now + LOGIN_WINDOW_MS;
    entry.count = 0;
  }
  loginAttempts.set(ip, entry);
  return entry;
}

router.post('/signup', async (req, res, next) => {
  try {
    const {
      email, password, full_name, role,
      social_name: socialName, cns, priority, race, guardian_name: guardianName,
      phone, mobile, birth_date: birthDate, gender, blood_type,
      mother_name, father_name, cpf, rg,
      cep, street, address_number, neighborhood, city, state,
      zone, reference_point: referencePoint,
      job_role,
    } = req.body || {};

    // Validação padronizada (Fase 0, item 0.4): zod centraliza e-mail,
    // senha, nome, nascimento, CPF (dígito) e CNS (checksum oficial).
    const parsed = signupSchema.safeParse({
      email, password, full_name, birth_date: birthDate, cpf, cns,
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return res.status(400).json({ error: first ? first.message : 'Dados inválidos.' });
    }
    // Dados essenciais de saúde: sem eles o cadastro não serve para o posto.
    const age = ageInYears(birthDate);
    if (age === null || age < 0 || age > 130) {
      return res.status(400).json({ error: 'Data de nascimento inválida.' });
    }
    if (priority !== undefined && priority !== null && priority !== '' && !VALID_PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: 'Prioridade de atendimento inválida.' });
    }
    if (race !== undefined && race !== null && race !== '' && !VALID_RACES.includes(race)) {
      return res.status(400).json({ error: 'Cor/raça inválida.' });
    }
    if (age < 18 && !guardianName) {
      return res.status(400).json({ error: 'Informe o nome do responsável legal para menores de 18 anos.' });
    }
    // Ponto de referência só é obrigatório na zona rural (item 1.7).
    if (zone === 'rural' && !referencePoint) {
      return res.status(400).json({ error: 'Na zona rural, o ponto de referência é obrigatório.' });
    }

    const assignedRole = VALID_ROLES.includes(role) ? role : 'paciente';
    // Atendente nasce pendente — precisa de ativação pelo admin antes de acessar dados de pacientes
    const initialStatus = assignedRole === 'atendente' ? 'pendente' : 'ativo';
    const normalizedEmail = String(email).toLowerCase().trim();

    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
    if (existing.length) {
      return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const id = crypto.randomUUID();

    // Fase 1 (LGPD): documentos cifrados em repouso (AES-256-GCM) + CPF
    // normalizado para só dígitos + registro do consentimento (versão da
    // política, momento e IP — prova da base legal).
    await pool.query(
      `INSERT INTO users
        (id, full_name, social_name, email, password_hash, role, account_status,
         cns, priority, race, guardian_name,
         phone, mobile, birth_date, gender, blood_type,
         mother_name, father_name, cpf, rg,
         cep, street, address_number, neighborhood, city, state, zone, reference_point,
         job_role, privacy_version, consent_at, consent_ip)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?)`,
      [
        id, full_name, socialName || null, normalizedEmail, passwordHash, assignedRole, initialStatus,
        req.encryptDoc(cns ? digitsOnly(cns) : null),
        priority && VALID_PRIORITIES.includes(priority) ? priority : null,
        race && VALID_RACES.includes(race) ? race : null,
        guardianName || null,
        phone || null, mobile || null,
        birthDate, gender || null, blood_type || null,
        mother_name || null, father_name || null,
        req.encryptDoc(digitsOnly(cpf) || null), req.encryptDoc(rg ? String(rg).trim() : null),
        cep || null, street || null, address_number || null,
        neighborhood || null, city || null, state || null,
        zone || null, referencePoint || null,
        assignedRole === 'atendente' ? (job_role || null) : null,
        PRIVACY_VERSION, clientIp(req),
      ]
    );

    const msg = assignedRole === 'atendente'
      ? 'Conta criada! Aguarde a ativação pelo administrador antes de fazer login.'
      : null;
    res.status(201).json({ id, message: msg });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Informe e-mail e senha.' });
    }

    const ip = clientIp(req);
    const blocked = loginBlockInfo(ip);
    if (blocked) {
      const seconds = Math.ceil((blocked.blockedUntil - Date.now()) / 1000);
      const minutes = Math.max(1, Math.ceil(seconds / 60));
      return res.status(429).json({
        error: `Muitas tentativas de login. Tente novamente em ${minutes} minuto(s).`,
      });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
    if (!rows.length) {
      registerLoginFailure(ip);
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    const user = rows[0];

    if (user.account_status !== 'ativo') {
      // Status da conta não é erro de senha — não conta como tentativa de força bruta.
      return res.status(403).json({
        error: user.account_status === 'pendente'
          ? 'Conta aguardando ativação. Entre em contato com a administração.'
          : 'Conta desativada. Entre em contato com a administração.'
      });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      registerLoginFailure(ip);
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    loginAttempts.delete(ip);

    const payload = {
      id: user.id, email: user.email,
      role: user.role, admin_level: user.admin_level || null, full_name: user.full_name,
      job_role: user.job_role || null,
    };
    try {
      await pool.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
    } catch (updateError) {
      if (updateError.code !== 'ER_BAD_FIELD_ERROR') throw updateError;
      console.warn('Coluna last_login_at ausente; execute server/migration_001.sql para habilitar o registro de acesso.');
    }
    // MFA ativo: senha OK, mas a sessão só sai após o segundo fator (Aula 1:
    // autenticidade — "algo que você sabe" + "algo que você tem").
    if (user.totp_enabled) {
      const mfaTicket = jwt.sign({ id: user.id, purpose: 'mfa' }, process.env.JWT_SECRET, { expiresIn: '5m' });
      return res.json({ mfa_required: true, mfa_ticket: mfaTicket });
    }

    const token = signAccessToken(payload);
    const { raw: refreshToken } = await issueRefreshToken(user.id);
    setRefreshCookie(res, refreshToken);

    res.json({ token, refreshToken, user: payload });
  } catch (err) {
    next(err);
  }
});

// POST /auth/mfa/verify — troca ticket MFA + código TOTP pela sessão completa.
router.post('/mfa/verify', async (req, res, next) => {
  try {
    const { ticket, code } = req.body || {};
    if (!ticket || !code) return res.status(400).json({ error: 'Informe o código do autenticador.' });
    let claim;
    try {
      claim = jwt.verify(ticket, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Sessão MFA expirada. Entre novamente.' });
    }
    if (!claim || claim.purpose !== 'mfa' || !claim.id) {
      return res.status(401).json({ error: 'Ticket inválido.' });
    }
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [claim.id]);
    const user = rows[0];
    if (!user || user.account_status !== 'ativo' || !user.totp_enabled || !user.totp_secret) {
      return res.status(401).json({ error: 'Verificação indisponível.' });
    }
    if (!verifyTotp(user.totp_secret, code)) {
      return res.status(401).json({ error: 'Código inválido.' });
    }
    try {
      await pool.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
    } catch (updateError) {
      if (updateError.code !== 'ER_BAD_FIELD_ERROR') throw updateError;
    }
    const payload = {
      id: user.id, email: user.email,
      role: user.role, admin_level: user.admin_level || null, full_name: user.full_name,
      job_role: user.job_role || null,
    };
    const token = signAccessToken(payload);
    const { raw: refreshToken } = await issueRefreshToken(user.id);
    setRefreshCookie(res, refreshToken);
    await req.audit('mfa_login', 'user', user.id, 'login com segundo fator', user.id);
    res.json({ token, refreshToken, user: payload });
  } catch (err) {
    next(err);
  }
});

// POST /auth/mfa/setup — gera o segredo (logado, ainda não ativo).
router.post('/mfa/setup', verifyToken, async (req, res, next) => {
  try {
    const [[user]] = await pool.query('SELECT totp_enabled FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (user.totp_enabled) return res.status(400).json({ error: 'MFA já está ativo.' });
    const secret = randomSecret();
    await pool.query('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?', [secret, req.user.id]);
    res.json({ secret, otpauth_url: otpauthUrl({ secret, email: req.user.email }) });
  } catch (err) {
    next(err);
  }
});

// POST /auth/mfa/enable — confirma o código e ativa.
router.post('/mfa/enable', verifyToken, async (req, res, next) => {
  try {
    const { code } = req.body || {};
    const [[user]] = await pool.query('SELECT totp_secret, totp_enabled FROM users WHERE id = ?', [req.user.id]);
    if (!user || !user.totp_secret) return res.status(400).json({ error: 'Gere o segredo primeiro.' });
    if (!verifyTotp(user.totp_secret, code)) return res.status(401).json({ error: 'Código inválido.' });
    await pool.query('UPDATE users SET totp_enabled = 1 WHERE id = ?', [req.user.id]);
    await req.audit('mfa_enable', 'user', req.user.id, 'segundo fator ativado');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /auth/mfa/disable — desativa (exige a senha).
router.post('/mfa/disable', verifyToken, async (req, res, next) => {
  try {
    const { password } = req.body || {};
    const [[user]] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const ok = await bcrypt.compare(password || '', user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Senha incorreta.' });
    await pool.query('UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?', [req.user.id]);
    await req.audit('mfa_disable', 'user', req.user.id, 'segundo fator desativado');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /auth/refresh — rotaciona o par access/refresh.
// Reuso de refresh já rotacionado = possível roubo => revoga a família inteira.
router.post('/refresh', async (req, res, next) => {
  try {
    const raw = readRefreshRaw(req);
    if (!raw) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });

    const [rows] = await pool.query('SELECT * FROM refresh_tokens WHERE token_hash = ?', [hashRefreshToken(raw)]);
    if (!rows.length) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });

    const stored = rows[0];
    const expired = new Date(stored.expires_at).getTime() < Date.now();
    if (stored.revoked || expired) {
      // Token já usado/trocado e apresentado de novo: trata como comprometido.
      await pool.query('UPDATE refresh_tokens SET revoked = 1 WHERE family = ?', [stored.family]);
      res.clearCookie(REFRESH_COOKIE, { path: '/auth' });
      return res.status(401).json({ error: 'Sessão invalidada por segurança. Entre novamente.' });
    }

    // Emite o substituto ANTES de revogar o atual: se a emissão falhar,
    // a sessão antiga continua válida (sem logout acidental).
    const { raw: nextRaw, id: nextId } = await issueRefreshToken(stored.user_id, stored.family);
    const [upd] = await pool.query(
      'UPDATE refresh_tokens SET revoked = 1, replaced_by = ? WHERE id = ? AND revoked = 0',
      [nextId, stored.id]
    );
    if (upd.affectedRows === 0) {
      // Corrida: o token foi usado em paralelo — trata como reuso.
      await pool.query('UPDATE refresh_tokens SET revoked = 1 WHERE family = ?', [stored.family]);
      res.clearCookie(REFRESH_COOKIE, { path: '/auth' });
      return res.status(401).json({ error: 'Sessão invalidada por segurança. Entre novamente.' });
    }
    setRefreshCookie(res, nextRaw);

    const [users] = await pool.query(
      'SELECT id, email, role, admin_level, full_name, job_role, account_status FROM users WHERE id = ?',
      [stored.user_id]
    );
    if (!users.length) {
      return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
    }
    const user = users[0];
    if (user.account_status !== 'ativo') {
      await pool.query('UPDATE refresh_tokens SET revoked = 1 WHERE family = ?', [stored.family]);
      return res.status(403).json({ error: 'Conta desativada. Entre em contato com a administração.' });
    }
    const payload = {
      id: user.id, email: user.email,
      role: user.role, admin_level: user.admin_level || null, full_name: user.full_name,
      job_role: user.job_role || null,
    };
    res.json({ token: signAccessToken(payload), refreshToken: nextRaw, user: payload });
  } catch (err) {
    next(err);
  }
});

// GET /auth/govbr/login — redireciona ao Login Único (Fase 2.3).
router.get('/govbr/login', (req, res, next) => {
  try {
    const url = buildAuthorizeUrl(govbrConfig(), req.query.state || null);
    res.redirect(url);
  } catch (err) {
    next(err);
  }
});

// GET /auth/govbr/callback — volta do Gov.br com ?code=. Vincula a conta
// existente (por govbr_sub, e-mail ou CPF); NÃO cria usuário sozinho.
// Sem vínculo: 404 + perfil para o front pré-preencher o cadastro normal.
router.get('/govbr/callback', async (req, res, next) => {
  try {
    const { code } = req.query || {};
    if (!code) return res.status(400).json({ error: 'Autorização Gov.br ausente.' });
    const tokens = await exchangeCode(String(code));
    const profile = await fetchUserInfo(tokens.access_token);
    if (!profile.sub) return res.status(502).json({ error: 'Gov.br não retornou identificador.' });

    let user = null;
    const [[bySub]] = await pool.query('SELECT * FROM users WHERE govbr_sub = ?', [profile.sub]);
    if (bySub) {
      user = bySub;
    } else {
      if (profile.email) {
        const [[byEmail]] = await pool.query('SELECT * FROM users WHERE email = ?', [profile.email]);
        if (byEmail) user = byEmail;
      }
      if (!user && profile.cpf) {
        // CPF está cifrado: compara decifrando (troca pontual, só no vínculo).
        const [rows] = await pool.query('SELECT * FROM users WHERE cpf IS NOT NULL');
        user = rows.find((r) => { try { return req.decryptDoc(r.cpf) === profile.cpf; } catch { return false; } }) || null;
      }
    }

    if (!user) {
      return res.status(404).json({
        error: 'Conta Gov.br sem vínculo. Complete o cadastro com estes dados.',
        govbr_profile: { nome: profile.nome, email: profile.email, cpf: profile.cpf, telefone: profile.telefone },
      });
    }
    if (user.account_status !== 'ativo') {
      return res.status(403).json({ error: 'Conta desativada. Entre em contato com a administração.' });
    }
    if (!user.govbr_sub) {
      await pool.query('UPDATE users SET govbr_sub = ? WHERE id = ?', [profile.sub, user.id]);
    }
    try {
      await pool.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
    } catch (updateError) {
      if (updateError.code !== 'ER_BAD_FIELD_ERROR') throw updateError;
    }
    const payload = {
      id: user.id, email: user.email,
      role: user.role, admin_level: user.admin_level || null, full_name: user.full_name,
      job_role: user.job_role || null,
    };
    if (user.totp_enabled) {
      const mfaTicket = jwt.sign({ id: user.id, purpose: 'mfa' }, process.env.JWT_SECRET, { expiresIn: '5m' });
      await req.audit('govbr_login', 'user', user.id, 'login via Gov.br (aguardando MFA)', user.id);
      return res.json({ mfa_required: true, mfa_ticket: mfaTicket });
    }
    const token = signAccessToken(payload);
    const { raw: refreshToken } = await issueRefreshToken(user.id);
    setRefreshCookie(res, refreshToken);
    await req.audit('govbr_login', 'user', user.id, 'login via Gov.br', user.id);
    res.json({ token, refreshToken, user: payload });
  } catch (err) {
    next(err);
  }
});

// POST /auth/logout — revoga o refresh atual (se houver) e limpa o cookie.
router.post('/logout', async (req, res, next) => {
  try {
    const raw = readRefreshRaw(req);
    if (raw) {
      await pool.query('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?', [hashRefreshToken(raw)]);
    }
    res.clearCookie(REFRESH_COOKIE, { path: '/auth' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /auth/me — perfil completo do próprio usuário, incluindo documentos
// decifrados (P4: "complete seu perfil"). É dado do próprio titular, mesma
// regra do export; password_hash/totp_secret nunca saem (fora do SELECT).
router.get('/me', verifyToken, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, full_name, social_name, email, role, account_status,
              phone, mobile, birth_date, gender, priority, race, guardian_name, blood_type,
              mother_name, father_name, cpf, rg, cns,
              cep, street, address_number, neighborhood, city, state, zone, reference_point,
              job_role, totp_enabled, created_at
       FROM users WHERE id = ?`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado.' });
    // P4: documentos do próprio titular decifrados (para "complete seu perfil").
    // Mesma regra do export; nunca saem password_hash/totp_secret (colunas fora do SELECT).
    const user = rows[0];
    for (const col of ['cpf', 'rg', 'cns']) {
      try { user[col] = req.decryptDoc(user[col]); } catch { user[col] = null; }
    }
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

// GET /auth/me/export — portabilidade (LGPD art. 18, V): tudo que o sistema
// guarda sobre o titular, em JSON, incluindo documentos decifrados e
// registro de consentimento.
//
// Segurança (P0.1): credenciais NUNCA saem aqui. `password_hash` e
// `totp_secret` são removidos — exportar o segredo TOTP inverteria o
// controle do segundo fator (com ele + relógio, recria-se o MFA).
router.get('/me/export', verifyToken, async (req, res, next) => {
  try {
    const [[profile]] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!profile) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const [appointments] = await pool.query(
      'SELECT * FROM appointments WHERE user_id = ? ORDER BY scheduled_at DESC', [req.user.id]
    );
    const [exams] = await pool.query(
      'SELECT * FROM exams WHERE user_id = ? ORDER BY scheduled_at DESC', [req.user.id]
    );
    const [reminders] = await pool.query(
      'SELECT * FROM reminders WHERE user_id = ? ORDER BY remind_at DESC', [req.user.id]
    );
    // Segredos removidos antes de qualquer serialização.
    delete profile.password_hash;
    delete profile.totp_secret;
    for (const col of ['cpf', 'rg', 'cns']) {
      try { profile[col] = req.decryptDoc(profile[col]); } catch { profile[col] = '[ilegível: chave ausente]'; }
    }
    res.json({
      exported_at: new Date().toISOString(),
      privacy_version: PRIVACY_VERSION,
      profile, appointments, exams, reminders,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /auth/me — eliminação (LGPD art. 18, VI) via anonimização.
// Exige a senha no corpo (confirmação) e torna a conta inutilizável.
// Histórico clínico vira estatística anônima; auditoria é preservada.
router.delete('/me', verifyToken, async (req, res, next) => {
  try {
    const { password } = req.body || {};
    if (!password) {
      return res.status(400).json({ error: 'Confirme sua senha para excluir a conta.' });
    }
    const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const ok = await bcrypt.compare(password, rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Senha incorreta.' });

    await anonymizeUser(pool, req.user.id);
    const raw = readRefreshRaw(req);
    if (raw) {
      await pool.query('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?', [hashRefreshToken(raw)]);
    }
    res.clearCookie(REFRESH_COOKIE, { path: '/auth' });
    res.json({ ok: true, message: 'Conta excluída e dados pessoais removidos.' });
  } catch (err) {
    next(err);
  }
});

// PUT /auth/me — atualiza o perfil próprio (não pode mudar role nem status).
//
// É uma atualização PARCIAL, e isso é contrato, não detalhe:
//   chave ausente no corpo  -> mantém o valor atual
//   chave presente e vazia  -> limpa (NULL)
//   chave presente e válida -> grava
//
// A versão anterior montava um UPDATE com as 22 colunas e `|| null` em cada
// uma, então toda coluna ausente do corpo era apagada. Os formulários dos três
// painéis mandam só os campos que têm: o atendente perdia job_role ao
// corrigir o telefone, e o admin perdia blood_type/priority/race/zone/
// mother_name ao salvar o perfil.
//
// Documentos (cpf/rg/cns) seguem a mesma regra e são cifrados em repouso.
router.put('/me', verifyToken, async (req, res, next) => {
  try {
    const body = req.body || {};

    // Documentos: cifra e valida. Chave presente e vazia limpa.
    const temChave = (k) => Object.prototype.hasOwnProperty.call(body, k);
    const cpf = body.cpf;
    const cns = body.cns;
    if (cpf !== undefined && cpf !== null && cpf !== '' && !isValidCPF(cpf)) {
      return res.status(400).json({ error: 'CPF inválido. Confira os números digitados.' });
    }
    if (cns !== undefined && cns !== null && cns !== '' && digitsOnly(cns) !== '' && !isValidCNS(cns)) {
      return res.status(400).json({ error: 'Cartão SUS (CNS) inválido. Confira os 15 números.' });
    }

    const docSets = [];
    const docParams = [];
    const blank = (v) => v === null || String(v).trim() === '' || digitsOnly(v) === '';
    if (temChave('cpf')) {
      docSets.push('cpf=?');
      docParams.push(blank(cpf) ? null : req.encryptDoc(digitsOnly(cpf)));
    }
    if (temChave('rg')) {
      docSets.push('rg=?');
      docParams.push(String(body.rg || '').trim() === '' ? null : req.encryptDoc(String(body.rg).trim()));
    }
    if (temChave('cns')) {
      docSets.push('cns=?');
      docParams.push(blank(cns) ? null : req.encryptDoc(digitsOnly(cns)));
    }

    // Monta o SET só com as colunas presentes no corpo.
    const sets = [];
    const params = [];

    const texto = (coluna, valor, transformar) => {
      if (!temChave(coluna)) return;
      const bruto = valor === null || valor === undefined ? '' : String(valor).trim();
      const v = bruto === '' ? null : (transformar ? transformar(bruto) : bruto);
      sets.push(`${coluna}=?`);
      params.push(v);
    };

    const enumColuna = (coluna, valor) => {
      if (!temChave(coluna)) return;
      const erro = validateEnum(coluna, valor);
      if (erro) throw Object.assign(new Error(erro), { status: 400 });
      sets.push(`${coluna}=?`);
      const v = valor === null || valor === undefined ? '' : String(valor).trim();
      params.push(v === '' ? null : v);
    };

    // full_name é NOT NULL no schema e é o que aparece em toda lista.
    if (temChave('full_name')) {
      const nome = String(body.full_name || '').trim();
      if (!nome) {
        return res.status(400).json({ error: 'Informe o nome completo.' });
      }
      sets.push('full_name=?');
      params.push(nome);
    }

    if (temChave('birth_date')) {
      const erro = validateDate(body.birth_date);
      if (erro) return res.status(400).json({ error: erro });
      sets.push('birth_date=?');
      const v = body.birth_date === null ? '' : String(body.birth_date).trim();
      params.push(v === '' ? null : v.slice(0, 10));
    }

    for (const col of [
      'social_name', 'phone', 'mobile', 'guardian_name', 'mother_name', 'father_name',
      'cep', 'street', 'address_number', 'neighborhood', 'city', 'job_role',
      'reference_point',
    ]) {
      texto(col, body[col]);
    }

    // 'state' é CHAR(2) no schema e a sigla da UF é sempre maiúscula.
    texto('state', body.state, (v) => v.toUpperCase());

    for (const col of ['gender', 'priority', 'race', 'blood_type', 'zone']) {
      enumColuna(col, body[col]);
    }

    if (docSets.length) {
      sets.push(...docSets);
      params.push(...docParams);
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar.' });
    }

    await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...params, req.user.id]);
    res.json({ ok: true, atualizados: sets.length });
  } catch (err) {
    if (err && err.status === 400) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

module.exports = router;
