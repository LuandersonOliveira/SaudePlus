/**
 * O vínculo por CPF no callback do Gov.br comparava o CPF decifrado com
 * `===` dentro de um `Array.find` (auth.routes.js). Dois defeitos:
 *
 *   - `===` sai no primeiro byte diferente, então o tempo de resposta
 *     reconstrói o CPF byte a byte;
 *   - o `find` parava no primeiro acerto e o `SELECT *` trazia a tabela
 *     inteira (incluindo `password_hash`) a cada tentativa.
 *
 * Aqui testamos a comparação e a busca como unidade.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { cpfIgual, digitosCpf, acharPorCpf } = require('../src/utils/cpf');

const C1 = '11144477735';
const C2 = '52998224725';

test('cpfIgual aceita o mesmo CPF com e sem pontuação', () => {
  assert.equal(cpfIgual(C1, '111.444.777-35'), true);
  assert.equal(cpfIgual('111.444.777-35', C1), true);
  assert.equal(cpfIgual(C1, C1), true);
});

test('cpfIgual separa CPFs diferentes', () => {
  assert.equal(cpfIgual(C1, C2), false);
  assert.equal(cpfIgual(C1, '111.444.777-36'), false, 'um dígito diferente reprova');
  assert.equal(cpfIgual(C1, '111.444.777'), false, 'tamanho diferente reprova');
});

test('cpfIgual trata nulo e vazio como não-casamento, sem lançar', () => {
  assert.equal(cpfIgual(null, null), false, 'nulo === nulo NÃO é um CPF');
  assert.equal(cpfIgual(undefined, undefined), false);
  assert.equal(cpfIgual('', ''), false);
  assert.equal(cpfIgual(C1, null), false);
  assert.equal(cpfIgual(null, C1), false);
});

test('cpfIgual não lança com entrada não-string', () => {
  assert.doesNotThrow(() => cpfIgual(11144477735, C1));
  assert.equal(cpfIgual(11144477735, C1), true, 'número vira string');
});

test('digitosCpf limpa tudo que não é dígito', () => {
  assert.equal(digitosCpf('111.444.777-35'), C1);
  assert.equal(digitosCpf('  529 982 247 25 '), C2);
  assert.equal(digitosCpf(null), '');
});

test('acharPorCpf acha o certo entre vários', () => {
  const linhas = [
    { id: 'a', cpf: 'cifrado-C1' },
    { id: 'b', cpf: 'cifrado-C2' },
    { id: 'c', cpf: 'cifrado-C3' },
  ];
  const decrypt = (c) => ({ 'cifrado-C1': C1, 'cifrado-C2': C2, 'cifrado-C3': '99999999999' })[c];

  assert.equal(acharPorCpf(linhas, '111.444.777-35', decrypt).id, 'a');
  assert.equal(acharPorCpf(linhas, C2, decrypt).id, 'b');
});

test('acharPorCpf devolve null quando ninguém bate', () => {
  const linhas = [{ id: 'a', cpf: 'x' }, { id: 'b', cpf: 'y' }];
  const decrypt = (c) => ({ x: C1, y: C2 })[c];
  assert.equal(acharPorCpf(linhas, '00000000000', decrypt), null);
});

test('acharPorCpf ignora linha cuja decifragem falha', () => {
  // Um usuário com dado corrompido não pode derrubar o login inteiro.
  const linhas = [
    { id: 'quebrado', cpf: 'lixo' },
    { id: 'bom', cpf: 'ok' },
  ];
  const decrypt = (c) => {
    if (c === 'lixo') throw new Error('chave inválida');
    return C1;
  };
  assert.equal(acharPorCpf(linhas, C1, decrypt).id, 'bom');
});

test('acharPorCpf devolve a PRIMEIRA linha quando há duplicidade', () => {
  // CPF deveria ser único; se o banco violar isso, ficamos com a primeira
  // em vez da última — comportamento estável entre execuções.
  const linhas = [
    { id: 'primeira', cpf: 'x' },
    { id: 'segunda', cpf: 'y' },
  ];
  const decrypt = () => C1;
  assert.equal(acharPorCpf(linhas, C1, decrypt).id, 'primeira');
});

test('acharPorCpf tolera lista vazia ou ausente', () => {
  assert.equal(acharPorCpf([], C1, () => C1), null);
  assert.equal(acharPorCpf(null, C1, () => C1), null);
});