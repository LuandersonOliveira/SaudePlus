/**
 * Comparação de CPF.
 *
 * O CPF do Gov.br chega como texto cifrado na base (`users.cpf`), então o
 * vínculo precisa decifrar e comparar. A versão anterior comparava com
 * `===` dentro de um `Array.find`, o que tem dois defeitos:
 *
 *   1. `===` sai no primeiro byte diferente — o tempo de resposta diz
 *      quantos caracteres iguais existem, o que reconstrói o CPF byte a
 *      byte. O mesmo problema do TOTP, corrigido em `totp.matchStep`.
 *   2. `Array.find` também para no primeiro casamento, somando o tempo de
 *      varredura ao resto: um login com CPF procura em toda a base.
 *
 * Aqui a comparação é de tempo constante e a busca não depende da posição.
 */
const crypto = require('node:crypto');

// CPF tem 11 dígitos. Fixar o tamanho faz a comparação ser estável mesmo
// quando os lados têm comprimentos diferentes (timingSafeEqual exige
// buffers do mesmo tamanho e lança erro se não forem).
const TAMANHO_CPF = 11;

/** Só dígitos, ou string vazia. */
function digitosCpf(valor) {
  return String(valor == null ? '' : valor).replace(/\D/g, '');
}

/**
 * timingSafeEqual entre dois CPFs, tolerante a pontuação e nulo.
 *
 * @returns {boolean} true quando os dígitos são iguais
 */
function cpfIgual(a, b) {
  const da = digitosCpf(a);
  const db = digitosCpf(b);
  // Um CPF só é comparável com outro se os dois tiverem os 11 dígitos.
  // Sem esta guarda, `cpfIgual(null, null)` casaria: dois vazios são
  // iguais byte a byte.
  if (da.length !== TAMANHO_CPF || db.length !== TAMANHO_CPF) return false;
  const ba = Buffer.from(da);
  const bb = Buffer.from(db);
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Acha o usuário cujo CPF cifrado (via `decrypt`) bate com o CPF do Gov.br.
 * Percorre TODOS os candidatos, sem parar no primeiro, para não vazar a
 * posição do acerto pelo tempo.
 *
 * @param {Array<{id: string, cpf: string}>} linhas candidatos (só id + cpf!)
 * @param {string} cpfInformado CPF puro do Gov.br
 * @param {(cpfCifrado: string) => string} decrypt função de decifragem
 * @returns {object|null} a linha encontrada ou null
 */
function acharPorCpf(linhas, cpfInformado, decrypt) {
  if (!Array.isArray(linhas) || !linhas.length) return null;
  let achado = null;
  for (const linha of linhas) {
    let decifrado;
    try {
      decifrado = decrypt(linha.cpf);
    } catch {
      decifrado = null; // CPF de usuário com chave antiga/corrompida: não casa.
    }
    const bate = decifrado != null && cpfIgual(decifrado, cpfInformado);
    // Não dá `break`: seguir varredura mantém o tempo independente da
    // posição do acerto.
    if (bate && !achado) achado = linha;
  }
  return achado;
}

module.exports = { digitosCpf, cpfIgual, acharPorCpf, TAMANHO_CPF };