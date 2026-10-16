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

// ---------------------------------------------------------------------------
// Valores válidos das colunas ENUM de `users`. Copiados literalmente dos
// ENUMs do schema — MySQL em modo não-estrito NÃO dá erro ao receber um valor
// fora da lista, ele trunca e avisa (WARN_DATA_TRUNCATED). Sem esta
// checagem, um gender inválido resultava em 500 vindo do driver, não em 400
// com mensagem em português. Mantenha em sincronia com schema.sql.
// ---------------------------------------------------------------------------
const VALID_GENDERS = ['masculino', 'feminino', 'outro', 'prefiro_nao_informar'];
const VALID_PRIORITIES = ['nenhuma', 'idoso', 'gestante', 'pcd', 'lactante'];
const VALID_RACES = ['branca', 'preta', 'parda', 'amarela', 'indigena', 'nao_informar'];
const VALID_BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const VALID_ZONES = ['urbana', 'rural'];

// Rótulos pt-BR para as mensagens de erro da API.
const ENUM_LABELS = {
  gender: 'gênero',
  priority: 'prioridade',
  race: 'raça',
  blood_type: 'grupo sanguíneo',
  zone: 'zona',
};

/**
 * Valida um valor de coluna ENUM. Devolve null se válido (inclusive null/vazio,
 * que significam "limpar") ou a mensagem de erro em português.
 */
function validateEnum(coluna, valor) {
  const lista = {
    gender: VALID_GENDERS,
    priority: VALID_PRIORITIES,
    race: VALID_RACES,
    blood_type: VALID_BLOOD_TYPES,
    zone: VALID_ZONES,
  }[coluna];
  if (!lista) throw new Error(`Coluna sem lista de valores válidos: ${coluna}`);
  if (valor === null || valor === undefined || String(valor).trim() === '') return null;
  if (!lista.includes(String(valor))) {
    return `${ENUM_LABELS[coluna] || coluna} inválido(a). Use um dos valores: ${lista.join(', ')}.`;
  }
  return null;
}

/**
 * Valida uma data YYYY-MM-DD e rejeita as que não existem (2026-02-30).
 * Aceita também 'YYYY-MM-DDTHH:mm' porque o <input type="date"> pode mandar.
 */
function validateDate(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim());
  if (!m) return 'Data inválida. Use o formato AAAA-MM-DD.';
  const [, ano, mes, dia] = m.map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    return 'Data inválida. Essa data não existe no calendário.';
  }
  return null;
}

module.exports = {
  digitsOnly, isValidCPF, isValidCNS, emailSchema, signupSchema, parsePagination,
  VALID_GENDERS, VALID_PRIORITIES, VALID_RACES, VALID_BLOOD_TYPES, VALID_ZONES,
  validateEnum, validateDate,
};
