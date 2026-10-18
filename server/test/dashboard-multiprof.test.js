/**
 * Um horário pode ter vários profissionais livres. O catálogo entrega a
 * lista (server/test/catalog-multiprof.test.js) e o painel precisa USAR
 * essa lista — senão o back está corrigido e o usuário continua preso ao
 * primeiro nome.
 *
 * O caminho do defeito antes da correção:
 *   - o catálogo só mandava o primeiro profissional (ordem alfabética);
 *   - o painel desenhava um botão por hora, com aquele nome;
 *   - o POST mandava aquele professional_id;
 *   - se ele fosse ocupado entre listar e enviar → 409, com outro
 *     profissional livre que a tela nunca mostrou.
 *
 * Aqui testamos a função real do painel, extraída do HTML, em dois casos:
 * a hora com dois profissionais (vira dois botões) e a hora com um só
 * (continua um botão — sem regrado visual).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');

/**
 * Extrai o corpo INTERNO de `function NOME(...) {…}` (sem as chaves externa)
 * contando chaves, e devolve como `function NOME { corpo }` pronto para o
 * new Function. O corpo interno já traz as próprias chaves nos níveis
 * aninhados;involver de novo em {…} geraria bloco duplo.
 */
function corpoDaFuncao(nome) {
  const inicio = html.indexOf(`function ${nome}(`);
  assert.notEqual(inicio, -1, `dashboard.html precisa ter ${nome}()`);
  const abre = html.indexOf('{', inicio);
  let profundidade = 0;
  let corpo = '';
  for (let i = abre; i < html.length; i += 1) {
    const ch = html[i];
    if (ch === '{') {
      profundidade += 1;
      if (profundidade === 1) continue;
    }
    if (ch === '}') {
      profundidade -= 1;
      if (profundidade === 0) break;
    }
    corpo += ch;
  }
  return corpo;
}

function carregarSlotEntries() {
  const corpo = corpoDaFuncao('slotEntries');
  // A assinatura precisa vir junto: `function slotEntries {…}` sem os
  // parênteses dos parâmetros não é uma função válida.
  return new Function(`return function slotEntries(day) {${corpo}};`)();
}

// Payload no formato que o /catalog/slots devolve hoje.
const DIA = {
  date: '2030-09-09',
  slots: [
    {
      hora: '09:00',
      // campo legado: primeiro profissional, mantido por compat
      professional_id: 'p-ana',
      professional_name: 'Ana Alfa',
      job_title: 'Clínica Geral',
      professionals: [
        { id: 'p-ana', name: 'Ana Alfa', job_title: 'Clínica Geral' },
        { id: 'p-beto', name: 'Beto Beta', job_title: 'Clínica Geral' },
      ],
    },
    {
      hora: '10:00',
      // só a Beto está livre às 10:00
      professional_id: 'p-beto',
      professional_name: 'Beto Beta',
      job_title: 'Clínica Geral',
      professionals: [{ id: 'p-beto', name: 'Beto Beta', job_title: 'Clínica Geral' }],
    },
  ],
};

test('uma hora com 2 profissionais vira DUAS entradas (um botão cada)', () => {
  const slotEntries = carregarSlotEntries();
  const entries = slotEntries(DIA);

  const as0900 = entries.filter((e) => e.hora === '09:00');
  assert.equal(as0900.length, 2, 'às 09:00 os dois devem aparecer');
  assert.deepEqual(
    as0900.map((e) => e.professional_id).sort(),
    ['p-ana', 'p-beto'],
    'os dois profissionais precisam aparecer, não só o primeiro'
  );
  assert.deepEqual(
    as0900.map((e) => e.professional_name),
    ['Ana Alfa', 'Beto Beta'],
    'cada entrada carrega o nome do SEU profissional'
  );
});

test('uma hora com 1 profissional continua UMA entrada (sem regrado)', () => {
  const slotEntries = carregarSlotEntries();
  const entries = slotEntries(DIA);

  const as1000 = entries.filter((e) => e.hora === '10:00');
  assert.equal(as1000.length, 1, 'às 10:00 só há a Beto');
  assert.equal(as1000[0].professional_id, 'p-beto');
});

test('o total de entradas bate com a soma dos profissionais por hora', () => {
  const slotEntries = carregarSlotEntries();
  const entries = slotEntries(DIA);
  const soma = DIA.slots.reduce((n, s) => n + (s.professionals ? s.professionals.length : 1), 0);
  assert.equal(entries.length, soma);
});

test('legado: um slot sem `professionals` cai no campo antigo, sem quebrar', () => {
  const slotEntries = carregarSlotEntries();
  const antigo = {
    date: '2030-09-09',
    slots: [{ hora: '08:00', professional_id: 'p-x', professional_name: 'Xuxa', job_title: 'Fisio' }],
  };
  const entries = slotEntries(antigo);
  assert.equal(entries.length, 1, 'sem a lista, usa o profissional único do campo legado');
  assert.equal(entries[0].professional_id, 'p-x');
  assert.equal(entries[0].professional_name, 'Xuxa');
});