const { z } = require('zod');

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

// CPF: algoritmo dos dígitos verificadores (mantém a regra já usada no signup,
// agora centralizada para reuso em todas as rotas).
function isValidCPF(value) {
  const cpf = digitsOnly(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(cpf[i]) * (10 - i);
  let d1 = (sum * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== Number(cpf[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(cpf[i]) * (11 - i);
  let d2 = (sum * 10) % 11;
  if (d2 === 10) d2 = 0;
  return d2 === Number(cpf[10]);
}

// CNS: 15 dígitos. Regra oficial (DEF-CNS):
// - Início 1/2 (beneficiário): soma ponderada 15..1, resto 0 => válido;
//   resto != 0 exige DV 001 + ajuste (soma + 2 => resto 0).
// - Início 7/8/9 (profissional/gestor): soma ponderada 15..1, resto 0 => válido.
function isValidCNS(value) {
  const cns = digitsOnly(value);
  if (!/^[12789]\d{14}$/.test(cns)) return false;
  const sum = [...cns].reduce((acc, d, i) => acc + Number(d) * (15 - i), 0);
  if (sum % 11 === 0) return true;
  if (cns[0] === '1' || cns[0] === '2') {
    // Regra de exceção do DEF-CNS para resto != 0 (DV 001).
    const somaAjustada = sum + 2;
    return somaAjustada % 11 === 0;
  }
  return false;
}

const emailSchema = z.string().trim().toLowerCase().email('Informe um e-mail válido.');

const signupSchema = z.object({
  email: emailSchema,
  password: z.string().min(6, 'A senha precisa ter ao menos 6 caracteres.'),
  full_name: z.string().trim().min(1, 'Nome, e-mail e senha são obrigatórios.'),
  birth_date: z.string().min(1, 'A data de nascimento é obrigatória.'),
  cpf: z.string().refine(isValidCPF, 'CPF inválido. Confira os números digitados.'),
  cns: z.string().optional().nullable().refine(
    (v) => !v || digitsOnly(v) === '' || isValidCNS(v),
    'Cartão SUS (CNS) inválido. Confira os 15 números.'
  ),
}).passthrough();

// Paginação padrão: ?page=&pageSize= (1-based, teto 100).
// Quando a query pede página, a rota responde envelope {data,page,pageSize,total}.
// Sem query, a rota mantém o array legado (compatibilidade com o front atual).
function parsePagination(query, { defaultPageSize = 20, maxPageSize = 100 } = {}) {
  const rawPage = Number.parseInt(query.page, 10);
  const rawSize = Number.parseInt(query.pageSize, 10);
  const wantsPaged = query.page !== undefined || query.pageSize !== undefined;
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const pageSize = Number.isFinite(rawSize) && rawSize > 0
    ? Math.min(rawSize, maxPageSize)
    : defaultPageSize;
  return { wantsPaged, page, pageSize, offset: (page - 1) * pageSize };
}

module.exports = { digitsOnly, isValidCPF, isValidCNS, emailSchema, signupSchema, parsePagination };
