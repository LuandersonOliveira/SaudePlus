/* ==========================================================================
   Saúde+ — esquemas de entrada das rotas de /auth (A2 da Fase 6).

   Cada esquema reproduz, com as MESMAS mensagens e a mesma ordem de checagem, o
   que as rotas validavam à mão. Usados com `validate(schema)` (middleware/validate.js).
   ========================================================================== */
const { z } = require('zod');
const {
  signupSchema, ageInYears, VALID_PRIORITIES, VALID_RACES,
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

module.exports = { signupBody, loginBody, mfaVerifyBody, mfaSetupBody, excluirContaBody };
