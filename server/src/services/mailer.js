// ==========================================================================
// Saúde+ — Envio de e-mail (SMTP genérico).
//
// Escolha de canal: SMTP, e não o SDK de um provedor. O sistema precisa
// falar com o servidor de e-mail que a equipe de operação já usa (Gmail
// Workspace, SES, Mailgun, um relay interno), e `nodemailer` fala SMTP com
// qualquer um deles trocando quatro variáveis de ambiente. Um SDK de
// provedor amarraria o projeto a uma conta e a um contrato de cobrança.
//
// Sem SMTP_HOST, o transporte NÃO É MANDADO: `enviar()` devolve
// `{ enviado: false, motivo: 'smtp_nao_configurado' }` e registra o
// conteúdo no console. Isso é deliberado e é a mesma política do resto do
// projeto (govbr, rnds): o sistema funciona sem o serviço externo, mas
// nunca finge que enviou. Um lembrete que "saiu" sem sair é pior que um
// lembrete que o operador sabe que não saiu.
//
// A senha do SMTP nunca é logada nem devolvida: `mailerConfig()` esconde a
// senha atrás de um booleano.
// ==========================================================================
const nodemailer = require('nodemailer');

function mailerConfig() {
  const host = process.env.SMTP_HOST || '';
  const port = Number(process.env.SMTP_PORT) || (host ? 587 : 0);
  const cfg = {
    host,
    port,
    // SMTP_SECURE=true é a porta 465 (TLS implícito). O padrão 587 é STARTTLS.
    secure: process.env.SMTP_SECURE === 'true' || port === 465,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'Saúde+ <nao-responda@saudeplus.local>',
    rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== 'false',
  };
  cfg.configured = !!cfg.host;
  return cfg;
}

/**
 * Retorno seguro para log/diagnóstico: o mesmo formato de `mailerConfig()`,
 * mas com a senha substituída. Nada aqui pode virar vazamento em log.
 */
function mailerStatus() {
  const cfg = mailerConfig();
  return {
    configured: cfg.configured,
    host: cfg.host || null,
    port: cfg.port || null,
    secure: cfg.secure,
    from: cfg.from,
    temCredencial: !!(cfg.user && cfg.pass),
  };
}

let transporte = null;
let transportePara = '';

function pegarTransporte(cfg) {
  const chave = `${cfg.host}|${cfg.port}|${cfg.secure}|${cfg.user}`;
  if (transporte && transportePara === chave) return transporte;
  transporte = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    // Rejeitar certificado self-signed é a norma; desligar via env é para o
    // relay interno de desenvolvimento, e fica explícito na configuração.
    rejectUnauthorized: cfg.rejectUnauthorized,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
  });
  transportePara = chave;
  return transporte;
}

/** Só para os testes: descarta o transporte memoizado. */
function resetTransporte() {
  transporte = null;
  transportePara = '';
}

/**
 * Envia uma mensagem.
 *
 * Nunca lança: quem chama (job de lembretes, recuperação de senha) trata o
 * envio como parte de uma operação maior, e um e-mail que falhou não pode
 * derrubar o lembrete que já está gravado nem a resposta ao usuário.
 *
 * @param {{para: string, assunto: string, texto: string, html?: string}} msg
 * @returns {Promise<{enviado: boolean, motivo?: string, erro?: string}>}
 */
async function enviar({ para, assunto, texto, html }) {
  const destino = String(para || '').trim();
  if (!destino || !destino.includes('@')) {
    return { enviado: false, motivo: 'destinatario_invalido' };
  }

  const cfg = mailerConfig();
  if (!cfg.configured) {
    // Sem SMTP: registra o que teria ido, para o operador conferir. O
    // conteúdo vai para o console porque o objetivo é desenvolvimento e
    // diagnóstico — em produção sem SMTP, `configured` é falso e a rota
    // responde 501 em vez de fingir.
    console.log(`[mailer] SMTP não configurado — não enviado para <${destino}>: ${assunto}`);
    return { enviado: false, motivo: 'smtp_nao_configurado' };
  }

  try {
    await pegarTransporte(cfg).sendMail({ from: cfg.from, to: destino, subject: assunto, text: texto, html });
    return { enviado: true };
  } catch (err) {
    const codigo = err && err.code ? err.code : 'SEM_CODIGO';
    console.error(`[mailer] Falha ao enviar para <${destino}> [${codigo}]: ${err && err.message}`);
    return { enviado: false, motivo: 'erro_transporte', erro: String(codigo) };
  }
}

module.exports = { enviar, mailerConfig, mailerStatus, resetTransporte };