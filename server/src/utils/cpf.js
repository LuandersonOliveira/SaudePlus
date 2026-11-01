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

// --------------------------------------------------------------------------
// Índice cego (RFC-0001 / ADR-0006, B3)
//
// `users.cpf` é cifrado com IV aleatório: o mesmo CPF vira textos diferentes, então
// o banco não consegue procurar nem garantir unicidade por ele. `cpf_hmac` é uma
// impressão determinística (HMAC-SHA256 com chave própria) usada só para isso:
// `UNIQUE (cpf_hmac)` impede dois usuários com o mesmo CPF, e a busca do Gov.br
// vira uma consulta por índice em vez de decifrar a base inteira.
//
// A chave é DIFERENTE da de cifra (CPF_HMAC_KEY): quem vazar uma não ganha a
// outra. Sem a chave, um dump do banco não permite testar CPFs candidatos (o
// espaço de CPFs é pequeno; um hash simples seria revertido por força bruta).
// --------------------------------------------------------------------------
let avisouChaveDev = false;

function chaveHmacConfigurada() {
  const hex = String(process.env.CPF_HMAC_KEY || '').trim();
  return /^[0-9a-fA-F]{64}$/.test(hex) ? Buffer.from(hex, 'hex') : null;
}

/**
 * Chave do HMAC. Falha FECHADA como a de cifra: sem CPF_HMAC_KEY o app não sobe.
 * Só com ALLOW_PLAINTEXT_DEV=1 (npm run dev) ela é derivada, com aviso, para o
 * clone novo funcionar — a unicidade vale, mas o valor não serve em produção.
 */
function chaveHmac() {
  const chave = chaveHmacConfigurada();
  if (chave) return chave;
  if (process.env.ALLOW_PLAINTEXT_DEV === '1') {
    if (!avisouChaveDev) {
      avisouChaveDev = true;
      console.warn('CPF_HMAC_KEY ausente: usando chave derivada, SÓ para desenvolvimento.');
    }
    const base = String(process.env.DATA_ENCRYPTION_KEY || 'saude-dev');
    return crypto.createHash('sha256').update(`cpf-hmac-dev:${base}`).digest();
  }
  throw new Error(
    'CPF_HMAC_KEY ausente ou inválida (64 caracteres hex) — o índice de unicidade do CPF não funciona sem ela.\n' +
    'Gere com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n' +
    'e coloque CPF_HMAC_KEY no server/.env (use um valor DIFERENTE de DATA_ENCRYPTION_KEY).'
  );
}

/** Para o boot: lança se a chave faltar fora do modo dev. */
function assertCpfHmacConfigured() {
  chaveHmac();
  return true;
}

/**
 * HMAC-SHA256 (hex, 64 caracteres) dos 11 dígitos do CPF; `null` para vazio ou
 * com outro tamanho. Pontuação não muda o resultado.
 */
function hmacCpf(cpf) {
  const digitos = digitosCpf(cpf);
  if (digitos.length !== TAMANHO_CPF) return null;
  return crypto.createHmac('sha256', chaveHmac()).update(digitos).digest('hex');
}

/** O erro é a violação do UNIQUE do CPF (e não de outra chave única)? */
function ehCpfDuplicado(err) {
  return Boolean(err) && (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) && /uq_users_cpf_hmac/.test(String(err.message));
}

const MENSAGEM_CPF_DUPLICADO = 'CPF já cadastrado. Entre na conta existente ou recupere a senha.';

module.exports = {
  digitosCpf, cpfIgual, acharPorCpf, TAMANHO_CPF,
  hmacCpf, assertCpfHmacConfigured, chaveHmacConfigurada, ehCpfDuplicado, MENSAGEM_CPF_DUPLICADO,
};