/* ==========================================================================
   Saúde+ — validação da atualização parcial do perfil (PUT /auth/me)
   (A1 passo 5 / A2 da Fase 6).

   É uma atualização PARCIAL, e isso é contrato, não detalhe:
     chave AUSENTE no corpo  -> mantém o valor atual
     chave presente e vazia  -> limpa (NULL)
     chave presente e válida -> grava

   A versão antiga montava um UPDATE com as 22 colunas e `|| null` em cada uma,
   então toda coluna ausente era apagada: o atendente perdia job_role ao corrigir
   o telefone, e o admin perdia blood_type/priority/race/zone/mother_name ao salvar
   o perfil. Por isso a validação depende de QUAIS chaves vieram, e não cabe num
   esquema Zod por campo: esta função devolve só o que veio, já validado.

   Função pura: não cifra, não toca no banco. A ordem das checagens (e portanto a
   primeira mensagem de erro) é a mesma de sempre.
   ========================================================================== */
const {
  digitsOnly, isValidCPF, isValidCNS, validateEnum, validateDate,
} = require('../utils/validators');

// Comprimento máximo por coluna, copiado de schema.sql.
//
// Sem isto, `state: "São Paulo"` numa coluna CHAR(2) chegava ao MySQL e volta
// como ER_DATA_TOO_LONG — que o handler genérico traduz em 500 "Erro interno do
// servidor". A pior resposta para um erro de digitação: o formulário diz ao
// usuário que o servidor quebrou, e o culpado some. Os ENUM não entram aqui
// (quem valida enum é validateEnum); VARCHAR grande também não precisa, porque
// o front nunca manda mais que isso.
const LIMITES_CAMPO = {
  state: 2, // CHAR(2) — sigla da UF
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

const COLUNAS_TEXTO = [
  'social_name', 'phone', 'mobile', 'guardian_name', 'mother_name', 'father_name',
  'cep', 'street', 'address_number', 'neighborhood', 'city', 'job_role', 'reference_point',
];
const COLUNAS_ENUM = ['gender', 'priority', 'race', 'blood_type', 'zone'];

const temChave = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);
const vazioDoc = (v) => v === null || String(v).trim() === '' || digitsOnly(v) === '';

/**
 * @param {object} body corpo da requisição
 * @returns {{ok: false, error: string}
 *   | {ok: true, campos: Array<[string, any]>, documentos: {cpf?: string|null, rg?: string|null, cns?: string|null}}}
 *   `campos`: colunas simples (já aparadas/normalizadas). `documentos`: valores EM CLARO
 *   das chaves presentes (null = limpar); quem grava cifra e calcula o índice do CPF.
 */
function normalizarAtualizacaoPerfil(body) {
  const b = body && typeof body === 'object' ? body : {};
  const falha = (error) => ({ ok: false, error });

  const { cpf, cns } = b;
  if (cpf !== undefined && cpf !== null && cpf !== '' && !isValidCPF(cpf)) {
    return falha('CPF inválido. Confira os números digitados.');
  }
  if (cns !== undefined && cns !== null && cns !== '' && digitsOnly(cns) !== '' && !isValidCNS(cns)) {
    return falha('Cartão SUS (CNS) inválido. Confira os 15 números.');
  }

  const documentos = {};
  if (temChave(b, 'cpf')) documentos.cpf = vazioDoc(cpf) ? null : digitsOnly(cpf);
  if (temChave(b, 'rg')) documentos.rg = String(b.rg || '').trim() === '' ? null : String(b.rg).trim();
  if (temChave(b, 'cns')) documentos.cns = vazioDoc(cns) ? null : digitsOnly(cns);

  const campos = [];

  // full_name é NOT NULL no schema e é o que aparece em toda lista.
  if (temChave(b, 'full_name')) {
    const nome = String(b.full_name || '').trim();
    if (!nome) return falha('Informe o nome completo.');
    campos.push(['full_name', nome]);
  }

  if (temChave(b, 'birth_date')) {
    const erro = validateDate(b.birth_date);
    if (erro) return falha(erro);
    const v = b.birth_date === null ? '' : String(b.birth_date).trim();
    campos.push(['birth_date', v === '' ? null : v.slice(0, 10)]);
  }

  const texto = (coluna, transformar) => {
    if (!temChave(b, coluna)) return null;
    const valor = b[coluna];
    const bruto = valor === null || valor === undefined ? '' : String(valor).trim();
    // Erro por tamanho antes de chegar no MySQL. Vazio continua limpando.
    if (bruto !== '' && LIMITES_CAMPO[coluna] && bruto.length > LIMITES_CAMPO[coluna]) {
      return `Campo "${coluna}" excede o tamanho máximo (${LIMITES_CAMPO[coluna]} caracteres).`;
    }
    campos.push([coluna, bruto === '' ? null : (transformar ? transformar(bruto) : bruto)]);
    return null;
  };

  for (const coluna of COLUNAS_TEXTO) {
    const erro = texto(coluna);
    if (erro) return falha(erro);
  }
  // 'state' é CHAR(2) no schema e a sigla da UF é sempre maiúscula.
  const erroUf = texto('state', (v) => v.toUpperCase());
  if (erroUf) return falha(erroUf);

  for (const coluna of COLUNAS_ENUM) {
    if (!temChave(b, coluna)) continue;
    const erro = validateEnum(coluna, b[coluna]);
    if (erro) return falha(erro);
    const v = b[coluna] === null || b[coluna] === undefined ? '' : String(b[coluna]).trim();
    campos.push([coluna, v === '' ? null : v]);
  }

  if (campos.length === 0 && Object.keys(documentos).length === 0) return falha('Nenhum campo para atualizar.');
  return { ok: true, campos, documentos };
}

module.exports = { normalizarAtualizacaoPerfil, LIMITES_CAMPO };
