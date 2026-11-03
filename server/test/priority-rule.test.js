/**
 * E-07 (Fase 8, item 2.4): a regra de prioridade legal (Lei 10.048/2000) existe em UM lugar.
 *
 * Os quatro grupos (idoso, gestante, pcd, lactante) estavam escritos em 5 pontos: a origem
 * (`utils/booking-priority.js`), duas ordenações em SQL (`admin.routes.js`, `staff.routes.js`), uma função
 * de ordenação em JavaScript (`staff.routes.js`) e a lista de valores válidos. Quem acrescentasse um grupo
 * teria de lembrar de todos, e o esquecimento mudaria a ordem da fila sem nenhum erro.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  PRIORITY_GROUPS, isPriorityUser, prioridadeRank, ordemPorPrioridadeSql,
} = require('../src/utils/booking-priority');
const { VALID_PRIORITIES } = require('../src/utils/validators');

test('isPriorityUser e prioridadeRank concordam: grupo da lei = 0, o resto = 1', () => {
  for (const g of PRIORITY_GROUPS) {
    assert.equal(isPriorityUser(g), true, g);
    assert.equal(prioridadeRank(g), 0, g);
  }
  for (const v of ['nenhuma', '', null, undefined, 'qualquer']) {
    assert.equal(isPriorityUser(v), false, String(v));
    assert.equal(prioridadeRank(v), 1, String(v));
  }
});

test('a comparação ignora caixa e espaços (a coluna é ENUM minúsculo, mas o dado pode vir de outra fonte)', () => {
  assert.equal(prioridadeRank(' IDOSO '), 0);
  assert.equal(isPriorityUser('Gestante'), true);
});

test('ordemPorPrioridadeSql: um CASE parametrizado, com um "?" por grupo e os grupos como parâmetros', () => {
  const { sql, params } = ordemPorPrioridadeSql('u.priority');
  assert.deepEqual(params, [...PRIORITY_GROUPS]);
  const marcadores = (sql.match(/\?/g) || []).length;
  assert.equal(marcadores, PRIORITY_GROUPS.length, 'um marcador por grupo');
  assert.match(sql, /^CASE WHEN u\.priority IN \(\?(, \?)*\) THEN 0 ELSE 1 END$/);
});

test('ordemPorPrioridadeSql recusa nome de coluna que não seja "tabela.coluna" simples', () => {
  for (const ruim of ['u.priority; DROP TABLE users', "u.priority'", '', 'priority', 'u.priority OR 1=1', null]) {
    assert.throws(() => ordemPorPrioridadeSql(ruim), /coluna/i, String(ruim));
  }
});

test('os valores aceitos no cadastro são "nenhuma" + os grupos da lei', () => {
  assert.deepEqual(VALID_PRIORITIES, ['nenhuma', ...PRIORITY_GROUPS]);
});

test('nenhum outro arquivo de src escreve a lista de grupos à mão', () => {
  const SRC = path.resolve(__dirname, '..', 'src');
  const dono = path.join('utils', 'booking-priority.js');
  const achados = [];
  const visitar = (dir) => {
    for (const nome of fs.readdirSync(dir, { withFileTypes: true })) {
      const caminho = path.join(dir, nome.name);
      if (nome.isDirectory()) { visitar(caminho); continue; }
      if (!nome.name.endsWith('.js') || caminho.endsWith(dono)) continue;
      const codigo = fs.readFileSync(caminho, 'utf8');
      if (/['"]gestante['"]/.test(codigo)) achados.push(path.relative(SRC, caminho));
    }
  };
  visitar(SRC);
  assert.deepEqual(achados, [], 'o grupo "gestante" só pode aparecer em utils/booking-priority.js');
});
