const express = require('express');
const { verifyToken } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { govbrConfig, buildAuthorizeUrl } = require('../services/govbr');
const {
  signupBody, loginBody, mfaVerifyBody, mfaSetupBody, excluirContaBody, govbrCallbackQuery,
} = require('../schemas/auth');
const {
  readRefreshRaw, setRefreshCookie, clearRefreshCookie,
  iniciarSessao, encerrarSessao, rotacionarSessao,
} = require('../services/session');
const {
  verificarSegundoFator, iniciarCadastroMfa, ativarMfa, desativarMfa,
} = require('../services/mfa');
const { solicitarRedefinicao, redefinirSenha, MENSAGEM_PEDIDO } = require('../services/passwordReset');
const { obterPerfil, exportarDados, atualizarPerfil, excluirConta } = require('../services/profile');
const { cadastrar, autenticar, entrarComGovbr } = require('../services/auth');

const router = express.Router();

function clientIp(req) {
  return req.ip || (req.socket && req.socket.remoteAddress) || 'desconhecido';
}

// Regras de cadastro, login e Gov.br em services/auth.js; validação em schemas/auth.js.
// A rota valida, chama o serviço e traduz o resultado em sessão, auditoria e resposta.

// POST /auth/signup
router.post('/signup', validate(signupBody), async (req, res, next) => {
  try {
    const r = await cadastrar(req.body, { encrypt: req.encryptDoc, ip: clientIp(req) });
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.status(201).json({ id: r.id, message: r.message });
  } catch (err) {
    next(err);
  }
});

// POST /auth/login — com MFA ativo devolve um ticket; a sessão só sai após o segundo fator.
router.post('/login', validate(loginBody), async (req, res, next) => {
  try {
    const r = await autenticar({ email: req.body.email, password: req.body.password, ip: clientIp(req) });
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    if (r.mfaRequired) return res.json({ mfa_required: true, mfa_ticket: r.ticket });

    const { token, refreshToken } = await iniciarSessao(res, r.payload, r.userId);
    res.json({ token, refreshToken, user: r.payload });
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

// GET /auth/govbr/callback — volta do Gov.br com ?code=. Vincula a conta existente
// (por govbr_sub, e-mail ou CPF); NÃO cria usuário sozinho. Sem vínculo: 404 + perfil
// para o front pré-preencher o cadastro normal.
router.get('/govbr/callback', validate(govbrCallbackQuery, { source: 'query' }), async (req, res, next) => {
  try {
    const r = await entrarComGovbr({ code: req.query.code, decrypt: req.decryptDoc });
    if (!r.ok) {
      return res.status(r.status).json({ error: r.error, ...(r.govbr_profile ? { govbr_profile: r.govbr_profile } : {}) });
    }
    if (r.mfaRequired) {
      await req.audit('govbr_login', 'user', r.userId, 'login via Gov.br (aguardando MFA)', r.userId);
      return res.json({ mfa_required: true, mfa_ticket: r.ticket });
    }
    const { token, refreshToken } = await iniciarSessao(res, r.payload, r.userId);
    await req.audit('govbr_login', 'user', r.userId, 'login via Gov.br', r.userId);
    res.json({ token, refreshToken, user: r.payload });
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

// Perfil do próprio titular e direitos LGPD: regras em services/profile.js
// (validação do PUT em schemas/profile.js). Os documentos viajam cifrados;
// req.encryptDoc / req.decryptDoc escondem a chave.
const docsDe = (req) => ({ encrypt: req.encryptDoc, decrypt: req.decryptDoc });

// GET /auth/me — perfil completo, incluindo documentos decifrados (P4).
router.get('/me', verifyToken, async (req, res, next) => {
  try {
    const r = await obterPerfil(req.user.id, docsDe(req));
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ user: r.user });
  } catch (err) {
    next(err);
  }
});

// GET /auth/me/export — portabilidade (LGPD art. 18, V). Credenciais nunca saem.
router.get('/me/export', verifyToken, async (req, res, next) => {
  try {
    const r = await exportarDados(req.user.id, docsDe(req));
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json(r.dados);
  } catch (err) {
    next(err);
  }
});

// DELETE /auth/me — eliminação (LGPD art. 18, VI) via anonimização. Exige a senha.
router.delete('/me', verifyToken, validate(excluirContaBody), async (req, res, next) => {
  try {
    const r = await excluirConta(req.user.id, req.body.password);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    await encerrarSessao(req, res);
    res.json({ ok: true, message: 'Conta excluída e dados pessoais removidos.' });
  } catch (err) {
    next(err);
  }
});

// PUT /auth/me — atualização PARCIAL do perfil próprio (não muda role nem status):
// chave ausente mantém, vazia limpa, válida grava. Detalhes em schemas/profile.js.
router.put('/me', verifyToken, async (req, res, next) => {
  try {
    const r = await atualizarPerfil(req.user.id, req.body, docsDe(req));
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ ok: true, atualizados: r.atualizados });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
