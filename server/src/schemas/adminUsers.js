/* ==========================================================================
   Saúde+ — validação de entrada da gestão de usuários pelo admin
   (A1 passo 8b / A2 da Fase 6).

   Pequenos esquemas Zod reutilizados por criar (POST) e editar (PATCH), e o corpo do
   POST inteiro. O PATCH NÃO tem um esquema único de propósito: a ordem das recusas
   intercala validação (400) e hierarquia (403) por campo, e essa ordem é contrato —
   quem não pode alterar a conta recebe 403 antes de saber se o nome era válido.
   Por isso o serviço aplica estes validadores campo a campo, na ordem de sempre.
   ========================================================================== */
const { z } = require('zod');
const { emailSchema } = require('../utils/validators');

const MSG_OBRIGATORIOS = 'Nome, e-mail e senha são obrigatórios.';
const MSG_SENHA = 'Senha deve ter pelo menos 6 caracteres.';
const MSG_NOME = 'Nome deve ter entre 2 e 150 caracteres.';
const LIMITE_TELEFONE = 30;

const nomeSchema = z.string().min(2, MSG_NOME).max(150, MSG_NOME);

/** Mensagem de erro ou null. Aceita qualquer valor (coage para texto e apara). */
function erroDoNome(valor) {
  const r = nomeSchema.safeParse(String(valor ?? '').trim());
  return r.success ? null : r.error.issues[0].message;
}

function erroDaSenha(valor) {
  return String(valor).length < 6 ? MSG_SENHA : null;
}

/** Normaliza e-mail com o esquema da API; devolve { ok, email } ou { ok: false, error }. */
function validarEmail(valor) {
  const r = emailSchema.safeParse(valor);
  return r.success ? { ok: true, email: r.data } : { ok: false, error: r.error.issues[0].message };
}

/** Telefone vazio vira null; mais de 30 caracteres é erro. */
function normalizarTelefone(valor) {
  const texto = String(valor ?? '').trim();
  return texto || null;
}
function erroDoTelefone(campo, valor) {
  const t = normalizarTelefone(valor);
  return t && t.length > LIMITE_TELEFONE ? `Campo "${campo}" excede o tamanho máximo (${LIMITE_TELEFONE} caracteres).` : null;
}

/**
 * Corpo do POST /admin/users. As recusas saem na mesma ordem de antes:
 * obrigatórios → senha → nome → e-mail → telefones. (Papel, e-mail já em uso e vínculo
 * dependem de banco e de hierarquia, e ficam no serviço.)
 */
const criarUsuarioBody = z.object({}).passthrough().superRefine((d, ctx) => {
  const erro = (message) => ctx.addIssue({ code: 'custom', message });
  if (!d.full_name || !d.email || !d.password) return erro(MSG_OBRIGATORIOS);
  const senha = erroDaSenha(d.password);
  if (senha) return erro(senha);
  const nome = erroDoNome(d.full_name);
  if (nome) return erro(nome);
  const email = validarEmail(d.email);
  if (!email.ok) return erro(email.error);
  if (normalizarTelefone(d.mobile) && normalizarTelefone(d.mobile).length > LIMITE_TELEFONE
    || normalizarTelefone(d.phone) && normalizarTelefone(d.phone).length > LIMITE_TELEFONE) {
    return erro('Telefone excede o tamanho máximo (30 caracteres).');
  }
  return undefined;
});

const MENSAGEM_SENHA_DO_ATOR = 'Confirme a sua senha para redefinir o segundo fator.';

/** Redefinir o MFA de outra conta exige a senha de QUEM redefine (ADR-0010). */
const redefinirMfaBody = z.object({
  password: z.string({ error: MENSAGEM_SENHA_DO_ATOR }).min(1, MENSAGEM_SENHA_DO_ATOR),
});

module.exports = {
  redefinirMfaBody,
  criarUsuarioBody,
  erroDoNome,
  erroDaSenha,
  validarEmail,
  normalizarTelefone,
  erroDoTelefone,
  LIMITE_TELEFONE,
};
