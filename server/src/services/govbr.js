// ==========================================================================
// Saúde+ — Login Único Gov.br / OIDC (Fase 2.3, scaffold)
// Fluxo Authorization Code. Sem credenciais (GOVBR_CLIENT_ID/SECRET/
// REDIRECT_URI), as rotas respondem 501 e o login local segue valendo.
// Produção: base https://sso.acesso.gov.br (authorize|token|userinfo).
// Homologação: configure GOVBR_BASE_URL com o ambiente de testes e o
// client homologado (processo em sso.acesso.gov.br + conta prata/ouro p/
// dados de saúde). Escopos pedidos: openid+email+phone+profile+govbr (cpf,
// nome, níveis). Decisão: NUNCA cria usuário sozinho — vincula por
// govbr_sub/e-mail/CPF a uma conta existente ou devolve o perfil p/
// pré-preencher o cadastro (com mesma validação de documentos).
// ==========================================================================
const crypto = require('crypto');

function govbrConfig() {
  const base = (process.env.GOVBR_BASE_URL || 'https://sso.acesso.gov.br').replace(/\/+$/, '');
  const cfg = {
    base,
    clientId: process.env.GOVBR_CLIENT_ID || null,
    clientSecret: process.env.GOVBR_CLIENT_SECRET || null,
    redirectUri: process.env.GOVBR_REDIRECT_URI || null,
    scope: process.env.GOVBR_SCOPE || 'openid email phone profile govbr',
  };
  cfg.configured = !!(cfg.clientId && cfg.clientSecret && cfg.redirectUri);
  return cfg;
}

function notConfigured() {
  const err = new Error('Login Gov.br não configurado: defina GOVBR_CLIENT_ID/SECRET/REDIRECT_URI.');
  err.code = 'GOVBR_NAO_CONFIGURADO';
  err.status = 501;
  return err;
}

function buildAuthorizeUrl(cfg = govbrConfig(), state = null) {
  if (!cfg.configured) throw notConfigured();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    scope: cfg.scope,
    redirect_uri: cfg.redirectUri,
    nonce: crypto.randomBytes(16).toString('hex'),
    state: state || crypto.randomBytes(16).toString('hex'),
  });
  return `${cfg.base}/authorize?${params.toString()}`;
}

async function exchangeCode(code, cfg = govbrConfig()) {
  if (!cfg.configured) throw notConfigured();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.redirectUri,
  });
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
  const res = await fetch(`${cfg.base}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Gov.br token retornou ${res.status}`);
  return res.json();
}

async function fetchUserInfo(accessToken, cfg = govbrConfig()) {
  const res = await fetch(`${cfg.base}/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Gov.br userinfo retornou ${res.status}`);
  const info = await res.json();
  // Normaliza: sub (vínculo estável), cpf (só dígitos), nome, email, telefone, níveis.
  return {
    sub: info.sub,
    cpf: info.cpf ? String(info.cpf).replace(/\D/g, '') : null,
    nome: info.name || null,
    email: info.email ? String(info.email).toLowerCase().trim() : null,
    telefone: info.phone_number || null,
    niveis: info['urn:govbr:niveis'] || info.niveis || null,
  };
}

module.exports = { govbrConfig, buildAuthorizeUrl, exchangeCode, fetchUserInfo, notConfigured };
