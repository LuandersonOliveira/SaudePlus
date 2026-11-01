const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../db');
const { verifyToken } = require('../middleware/auth');
const {
  digitsOnly, isValidCPF, isValidCNS,
  VALID_PRIORITIES, VALID_RACES, validateEnum, validateDate,
} = require('../utils/validators');
const {
  loginKey, loginBlockInfo, registerLoginFailure, registerLoginSuccess,
} = require('../utils/loginThrottle');
const { PRIVACY_VERSION, anonymizeUser } = require('../utils/privacy');
const { govbrConfig, buildAuthorizeUrl, exchangeCode, fetchUserInfo } = require('../services/govbr');
const { cpfIgual, hmacCpf, ehCpfDuplicado, MENSAGEM_CPF_DUPLICADO } = require('../utils/cpf');
const { validate } = require('../middleware/validate');
const { signupBody, loginBody, mfaVerifyBody, mfaSetupBody, excluirContaBody } = require('../schemas/auth');
const {
  readRefreshRaw, setRefreshCookie, clearRefreshCookie,
  iniciarSessao, encerrarSessao, rotacionarSessao, payloadDoUsuario,
} = require('../services/session');
const {
  criarTicketMfa, verificarSegundoFator, iniciarCadastroMfa, ativarMfa, desativarMfa,
} = require('../services/mfa');
const { solicitarRedefinicao, redefinirSenha, MENSAGEM_PEDIDO } = require('../services/passwordReset');

const router = express.Router();

const VALID_ROLES = ['paciente', 'atendente'];
// As listas de ENUM e os validadores vivem em utils/validators.js (fonte
// única, copiadas dos ENUMs do schema) para que signup e PUT /auth/me não
// divirjam entre si.

// --------------------------------------------------------------------------
// Validações de dados essenciais (TAREFAS V3, item 6.2).
// CPF/CNS/e-mail centralizados em utils/validators.js (Fase 0, item 0.4).
// --------------------------------------------------------------------------
// --------------------------------------------------------------------------
// Proteção contra força bruta no login (TAREFAS V3, item 6.3).
// A lógica mora em utils/loginThrottle.js, com o relógio injetado — assim é
// testável sem esperar 5 minutos. Resumo do que mudou: a chave do Map passou
// a ser `ip|e-mail` em vez de só `ip` (ver o arquivo para o porquê) e o Map
// passou a ser varrido e limitado.
// --------------------------------------------------------------------------
const loginAttempts = new Map(); // "ip|email" -> { count, windowEndsAt, blockedUntil }

function clientIp(req) {
  return req.ip || (req.socket && req.socket.remoteAddress) || 'desconhecido';
}

router.post('/signup', validate(signupBody), async (req, res, next) => {
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

    // Validação (e-mail, senha, nome, nascimento, CPF, CNS e regras de idade/prioridade/
    // zona rural) feita por validate(signupBody) — ver schemas/auth.js.

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
         mother_name, father_name, cpf, cpf_hmac, rg,
         cep, street, address_number, neighborhood, city, state, zone, reference_point,
         job_role, privacy_version, consent_at, consent_ip)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?)`,
      [
        id, full_name, socialName || null, normalizedEmail, passwordHash, assignedRole, initialStatus,
        req.encryptDoc(cns ? digitsOnly(cns) : null),
        priority && VALID_PRIORITIES.includes(priority) ? priority : null,
        race && VALID_RACES.includes(race) ? race : null,
        guardianName || null,
        phone || null, mobile || null,
        birthDate, gender || null, blood_type || null,
        mother_name || null, father_name || null,
        req.encryptDoc(digitsOnly(cpf) || null), hmacCpf(cpf), req.encryptDoc(rg ? String(rg).trim() : null),
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
    // A checagem de e-mail acima não é atômica: dois cadastros simultâneos passam por ela.
    // O UNIQUE do banco é quem decide, e a resposta é a mesma do caso sequencial.
    if (ehCpfDuplicado(err)) return res.status(409).json({ error: MENSAGEM_CPF_DUPLICADO });
    if (err && err.code === 'ER_DUP_ENTRY' && /email/i.test(String(err.message))) {
      return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
    }
    next(err);
  }
});

router.post('/login', validate(loginBody), async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const normalizedEmail = String(email).toLowerCase().trim();
    // Chave por conta E por IP: um ataque a uma conta não tranca as demais
    // nem tranca quem está atrás do mesmo proxy.
    const chave = loginKey(clientIp(req), normalizedEmail);

    const blocked = loginBlockInfo(loginAttempts, chave);
    if (blocked) {
      const seconds = Math.ceil((blocked.blockedUntil - Date.now()) / 1000);
      const minutes = Math.max(1, Math.ceil(seconds / 60));
      return res.status(429).json({
        error: `Muitas tentativas de login. Tente novamente em ${minutes} minuto(s).`,
      });
    }

    const [rows] = await pool.query('SELECT * FROM users WHERE email = ? AND (deleted_at IS NULL)', [normalizedEmail]);
    if (!rows.length) {
      registerLoginFailure(loginAttempts, chave);
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
      registerLoginFailure(loginAttempts, chave);
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    registerLoginSuccess(loginAttempts, chave);

    const payload = payloadDoUsuario(user);
    try {
      await pool.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
    } catch (updateError) {
      if (updateError.code !== 'ER_BAD_FIELD_ERROR') throw updateError;
      console.warn('Coluna last_login_at ausente; recrie o banco com `npm run db:setup -- --fresh <banco>` (ou rode o doctor).');
    }
    // MFA ativo: senha OK, mas a sessão só sai após o segundo fator (Aula 1:
    // autenticidade — "algo que você sabe" + "algo que você tem").
    if (user.totp_enabled) {
      return res.json({ mfa_required: true, mfa_ticket: criarTicketMfa(user.id) });
    }

    const { token, refreshToken } = await iniciarSessao(res, payload, user.id);

    res.json({ token, refreshToken, user: payload });
  } catch (err) {
    next(err);
  }
});

// POST /auth/mfa/verify — troca ticket MFA + código TOTP pela sessão completa.
// Regras (ticket, tentativas, replay do passo) em services/mfa.js.
router.post('/mfa/verify', validate(mfaVerifyBody), async (req, res, next) => {
  try {
    const r = await verificarSegundoFator(req.body);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    const { token, refreshToken } = await iniciarSessao(res, r.payload, r.user.id);
    await req.audit('mfa_login', 'user', r.user.id, 'login com segundo fator', r.user.id);
    res.json({ token, refreshToken, user: r.payload });
  } catch (err) {
    next(err);
  }
});

// POST /auth/mfa/setup — gera o segredo (ainda não ativo) e devolve o QR.
// Exige a SENHA do titular (ver services/mfa.js).
router.post('/mfa/setup', verifyToken, validate(mfaSetupBody), async (req, res, next) => {
  try {
    const r = await iniciarCadastroMfa({ userId: req.user.id, email: req.user.email, password: req.body.password });
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    await req.audit('mfa_setup', 'user', req.user.id, 'segredo do segundo fator gerado');
    res.json({ secret: r.secret, otpauth_url: r.otpauthUrl });
  } catch (err) {
    next(err);
  }
});

// POST /auth/mfa/enable — confirma o código e ativa.
router.post('/mfa/enable', verifyToken, async (req, res, next) => {
  try {
    const r = await ativarMfa({ userId: req.user.id, code: (req.body || {}).code });
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    await req.audit('mfa_enable', 'user', req.user.id, 'segundo fator ativado');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /auth/mfa/disable — desativa (exige a senha).
router.post('/mfa/disable', verifyToken, async (req, res, next) => {
  try {
    const r = await desativarMfa({ userId: req.user.id, password: (req.body || {}).password });
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    await req.audit('mfa_disable', 'user', req.user.id, 'segundo fator desativado');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ==========================================================================
// Recuperação de senha (Fase 7). Regras em services/passwordReset.js.
//
// `/forgot` devolve SEMPRE a mesma resposta, exista ou não a conta, esteja ou
// não o SMTP no ar: qualquer variação aqui seria um oráculo de enumeração.
// ==========================================================================

// POST /auth/password/forgot — sempre 200, com a mesma mensagem.
router.post('/password/forgot', async (req, res, next) => {
  try {
    const respostaFixa = { ok: true, message: MENSAGEM_PEDIDO };
    const r = await solicitarRedefinicao((req.body || {}).email);
    if (!r.enviado) return res.status(200).json(respostaFixa);

    // Sem SMTP, a resposta continua a mesma. O e-mail não saiu, e a
    // auditoria registra isso para o operador — mas quem pediu não recebe um
    // "não conseguimos enviar", porque isso confirmaria que a conta existe.
    try {
      await req.audit('password_reset_pedido', 'user', r.userId,
        `pedido de redefinição; envio=${r.envio.enviado ? 'aceito' : (r.envio.motivo || 'recusado')}`,
        r.userId);
    } catch { /* auditoria não bloqueia o pedido */ }
    return res.status(200).json(respostaFixa);
  } catch (err) {
    next(err);
  }
});

// POST /auth/password/reset — consome o token e troca a senha.
router.post('/password/reset', async (req, res, next) => {
  try {
    const r = await redefinirSenha(req.body || {});
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    try {
      await req.audit('password_reset_concluido', 'user', r.userId, 'senha redefinida pelo titular', r.userId);
    } catch { /* auditoria não bloqueia a redefinição */ }
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /auth/refresh — rotaciona o par access/refresh.
// Reuso de refresh já rotacionado = possível roubo => revoga a família inteira.
router.post('/refresh', async (req, res, next) => {
  try {
    const r = await rotacionarSessao(readRefreshRaw(req));
    if (!r.ok) {
      if (r.limparCookie) clearRefreshCookie(res);
      return res.status(r.status).json({ error: r.error });
    }
    setRefreshCookie(res, r.refreshToken, r.cookieTtlMs);
    res.json({ token: r.token, refreshToken: r.refreshToken, user: r.payload });
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
        // CPF está cifrado (IV aleatório), então a busca usa o índice cego `cpf_hmac`
        // — UNIQUE, uma consulta por índice em vez de decifrar a base inteira.
        // Só `id` e `cpf` saem do banco (nada de `SELECT *` com password_hash).
        const h = hmacCpf(profile.cpf);
        if (h) {
          const [[achado]] = await pool.query('SELECT id, cpf FROM users WHERE cpf_hmac = ?', [h]);
          // Confere o CPF de verdade no único candidato (tempo constante): o índice
          // só aponta, quem decide é o dado cifrado — protege de linha com HMAC velho.
          let confere = false;
          if (achado) {
            try { confere = cpfIgual(req.decryptDoc(achado.cpf), profile.cpf); } catch { confere = false; }
          }
          if (confere) user = achado;
        }
      }
    }

    if (!user) {
      return res.status(404).json({
        error: 'Conta Gov.br sem vínculo. Complete o cadastro com estes dados.',
        govbr_profile: { nome: profile.nome, email: profile.email, cpf: profile.cpf, telefone: profile.telefone },
      });
    }
    // O vínculo por CPF devolveu só `id`/`cpf` (o mínimo para comparar sem
    // arrastar a tabela). O resto do login precisa da linha completa — e
    // agora que já temos o id, isso é um índice, não uma varredura.
    if (!user.role) {
      const [[completo]] = await pool.query('SELECT * FROM users WHERE id = ?', [user.id]);
      user = completo || user;
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
    const payload = payloadDoUsuario(user);
    if (user.totp_enabled) {
      const mfaTicket = jwt.sign({ id: user.id, purpose: 'mfa' }, process.env.JWT_SECRET, { expiresIn: '5m' });
      await req.audit('govbr_login', 'user', user.id, 'login via Gov.br (aguardando MFA)', user.id);
      return res.json({ mfa_required: true, mfa_ticket: mfaTicket });
    }
    const { token, refreshToken } = await iniciarSessao(res, payload, user.id);
    await req.audit('govbr_login', 'user', user.id, 'login via Gov.br', user.id);
    res.json({ token, refreshToken, user: payload });
  } catch (err) {
    next(err);
  }
});

// POST /auth/logout — revoga o refresh atual (se houver) e limpa o cookie.
router.post('/logout', async (req, res, next) => {
  try {
    await encerrarSessao(req, res);
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
router.delete('/me', verifyToken, validate(excluirContaBody), async (req, res, next) => {
  try {
    const { password } = req.body;
    const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const ok = await bcrypt.compare(password, rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Senha incorreta.' });

    await anonymizeUser(pool, req.user.id);
    await encerrarSessao(req, res);
    res.json({ ok: true, message: 'Conta excluída e dados pessoais removidos.' });
  } catch (err) {
    next(err);
  }
});

// Comprimento máximo por coluna, copiado de schema.sql.
//
// Sem isto, `state: "São Paulo"` numa coluna CHAR(2) chegava ao MySQL e volta
// como ER_DATA_TOO_LONG — que o handler genérico traduz em 500 "Erro interno do
// servidor". A pior resposta para um erro de digitação: o formulário diz ao
// usuário que o servidor quebrou, e o culpado some. Os ENUM não entram aqui
// (quem valida enum é validateEnum); VARCHAR grande também não precisa, porque
// o front nunca manda mais que isso.
const LIMITES_CAMPO = {
  state: 2,                // CHAR(2) — sigla da UF
  cep: 9,
  phone: 30,
  mobile: 30,
  address_number: 10,
  neighborhood: 100,
  city: 100,
  street: 180,
  social_name: 150,
  guardian_name: 150,
  mother_name: 150,
  father_name: 150,
  job_role: 100,
  reference_point: 255,
};

function erroDeTamanho(coluna) {
  return Object.assign(
    new Error(`Campo "${coluna}" excede o tamanho máximo (${LIMITES_CAMPO[coluna]} caracteres).`),
    { status: 400 }
  );
}

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
      docSets.push('cpf=?', 'cpf_hmac=?');
      docParams.push(blank(cpf) ? null : req.encryptDoc(digitsOnly(cpf)), blank(cpf) ? null : hmacCpf(cpf));
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
      // 400 por tamanho, antes de chegar no MySQL. Vazio continua limpiando.
      if (bruto !== '' && LIMITES_CAMPO[coluna] && bruto.length > LIMITES_CAMPO[coluna]) {
        throw erroDeTamanho(coluna);
      }
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
    if (ehCpfDuplicado(err)) return res.status(409).json({ error: MENSAGEM_CPF_DUPLICADO });
    next(err);
  }
});

module.exports = router;
