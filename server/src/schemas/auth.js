/* ==========================================================================
   Saúde+ — esquemas de entrada das rotas de /auth (A2 da Fase 6).

   Cada esquema reproduz, com as MESMAS mensagens e a mesma ordem de checagem, o
   que as rotas validavam à mão. Usados com `validate(schema)` (middleware/validate.js).
   ========================================================================== */
const { z } = require('zod');
const {
  signupSchema, ageInYears, digitsOnly, VALID_PRIORITIES, VALID_RACES,
} = require('../utils/validators');

const vazio = (v) => v === undefined || v === null || v === '';

/**
 * Cadastro: campos essenciais (e-mail, senha, nome, nascimento, CPF, CNS) pelo
 * `signupSchema` e, depois deles, as regras de negócio que dependem de mais de um
 * campo. O primeiro erro, nessa ordem, é o que a API devolve.
 */
const signupBody = signupSchema.superRefine((d, ctx) => {
  const erro = (message) => ctx.addIssue({ code: 'custom', message });

  const age = ageInYears(d.birth_date);
  if (age === null || age < 0 || age > 130) return erro('Data de nascimento inválida.');
  // CPF: adulto exige. Menor de 18 pode se cadastrar sem CPF (criança costuma ter só o Cartão SUS),
  // mas então precisa do CNS para continuar identificado. O responsável legal segue obrigatório,
  // registrado só pelo nome (o CPF do responsável não é coletado). CPF ausente vira NULL no banco,
  // e NULL não colide no UNIQUE (cpf_hmac).
  if (digitsOnly(d.cpf) === '') {
    if (age >= 18) return erro('CPF inválido. Confira os números digitados.');
    if (digitsOnly(d.cns) === '') return erro('Menores de 18 anos sem CPF precisam informar o Cartão SUS (CNS).');
  }
  if (!vazio(d.priority) && !VALID_PRIORITIES.includes(d.priority)) erro('Prioridade de atendimento inválida.');
  if (!vazio(d.race) && !VALID_RACES.includes(d.race)) erro('Cor/raça inválida.');
  if (age < 18 && !d.guardian_name) erro('Informe o nome do responsável legal para menores de 18 anos.');
  // Ponto de referência só é obrigatório na zona rural (item 1.7).
  if (d.zone === 'rural' && !d.reference_point) erro('Na zona rural, o ponto de referência é obrigatório.');
});

const MSG_LOGIN = 'Informe e-mail e senha.';
const loginBody = z.object({
  email: z.string({ error: MSG_LOGIN }).min(1, MSG_LOGIN),
  password: z.string({ error: MSG_LOGIN }).min(1, MSG_LOGIN),
});

const MSG_MFA = 'Informe o código do autenticador.';
const mfaVerifyBody = z.object({
  ticket: z.string({ error: MSG_MFA }).min(1, MSG_MFA),
  // O código chega como texto ("123456") ou, de clientes diretos, como número.
  code: z.any().refine((v) => (typeof v === 'string' && v.length > 0) || (typeof v === 'number' && Number.isFinite(v)), MSG_MFA),
});

const confirmacaoDeSenha = (mensagem) => z.object({
  password: z.string({ error: mensagem }).min(1, mensagem),
});
const mfaSetupBody = confirmacaoDeSenha('Confirme sua senha para ativar o segundo fator.');
const excluirContaBody = confirmacaoDeSenha('Confirme sua senha para excluir a conta.');

const MSG_GOVBR = 'Autorização Gov.br ausente.';
// GET /auth/govbr/callback?code=… (validate com { source: 'query' })
const govbrCallbackQuery = z.object({
  code: z.string({ error: MSG_GOVBR }).min(1, MSG_GOVBR),
});

module.exports = {
  signupBody, loginBody, mfaVerifyBody, mfaSetupBody, excluirContaBody, govbrCallbackQuery,
};
