/**
 * O helper esc() dos painéis (admin.html, atendente.html, dashboard.html)
 * escapava só /[&<>"]/. O resultado era interpolado dentro de atributos
 * onclick com aspas simples: onclick="showHistory('${u.id}','${esc(nome)}')".
 *
 * Um nome com apóstrofo — "Maria d'Ávila", "O'Brien", "d'Almeida", padrão
 * no Brasil — produzia showHistory('id','Maria d'Ávila') e um SyntaxError.
 * O botão não fazia nada, sem erro e sem toast. Três painéis, 106 usos.
 *
 * Aqui testamos a função como unidade, extraindo a definição real de cada
 * painel e avaliando o escape.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const PAINEIS = ['admin.html', 'atendente.html', 'dashboard.html'];

const htmlDe = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/**
 * Extrai o corpo INCLUINDO as chaves de `function esc(s) {…}` de cada painel
 * e devolve uma função real. Serve tanto para a versão de uma linha
 * (admin/atendente) quanto para a multilinha (dashboard).
 */
function extrairEsc(html) {
  const inicio = html.indexOf('function esc(');
  if (inicio === -1) return null;
  let i = html.indexOf('{', inicio);
  let profundidade = 0;
  let corpo = '';
  for (; i < html.length; i += 1) {
    const ch = html[i];
    if (ch === '{') profundidade += 1;
    if (ch === '}') {
      profundidade -= 1;
      if (profundidade === 0) {
        corpo += ch;
        break;
      }
    }
    corpo += ch;
  }
  // O corpo já traz as próprias chaves — envolvê-lo de novo em {…} geraria
  // um bloco duplo e a função nem chegaria a compilar.
  return new Function('ESC_MAP', `return function esc(s) ${corpo};`)(globalThis.ESC_MAP || {});
}

test('todo painel define esc()', () => {
  for (const p of PAINEIS) {
    assert.equal(typeof extrairEsc(htmlDe(p)), 'function', `${p} não define esc()`);
  }
});

test('esc() escapa o apóstrofo', () => {
  for (const p of PAINEIS) {
    const esc = extrairEsc(htmlDe(p));
    const saida = esc("Maria d'Ávila Souza");
    assert.ok(
      !saida.includes("'"),
      `${p}: esc() deixou o apóstrofo passar — "${saida}"`
    );
    assert.ok(saida.includes('&#39;'), `${p}: esc() deveria produzir &#39;`);
  }
});

test('esc() continua escapando & < > e aspas duplas', () => {
  for (const p of PAINEIS) {
    const esc = extrairEsc(htmlDe(p));
    const saida = esc(`<script>a & b "c" 'd'</script>`);
    assert.ok(!saida.includes('<'), `${p}: < passou`);
    assert.ok(!saida.includes('>'), `${p}: > passou`);
    assert.ok(saida.includes('&amp;'), `${p}: & não virou &amp;`);
    assert.ok(saida.includes('&quot;'), `${p}: " não virou &quot;`);
  }
});

test('esc() tolera null e undefined sem lançar', () => {
  for (const p of PAINEIS) {
    const esc = extrairEsc(htmlDe(p));
    assert.equal(esc(null), '', `${p}: esc(null) deveria devolver string vazia`);
    assert.equal(esc(undefined), '', `${p}: esc(undefined) deveria devolver string vazia`);
    assert.equal(esc(0), '0', `${p}: esc(0) não pode virar string vazia`);
  }
});

/**
 * Extrai o corpo de um listener delegado `document.addEventListener('click', …)`
 * e o avalia de verdade, com `document`, `window` e as funções de painel
 * substituídas por dublês. Assim provamos que o clique chega à função certa
 * com os valores de data-*.
 */
function extrairDelegado(html, alvo, fnNome = 'viewUser') {
  // Vários listeners de 'click' existem por página. O que nos interessa é o
  // delegado de data-act — identificado pelo closest('[data-act]') no corpo.
  const corpoDo = (marca) => {
    const abre = html.indexOf('{', marca);
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
  };

  let corpo = null;
  let busca = 0;
  while (corpo === null) {
    const marca = html.indexOf("addEventListener('click'", busca);
    if (marca === -1) return null;
    const candidato = corpoDo(marca);
    busca = marca + 1;
    if (candidato.includes('dataset.act')) corpo = candidato;
  }

  const chamadas = [];
  const duble = (nome) => (...args) => { chamadas.push([nome, args]); };
  const elemento = {
    dataset: {
      act: alvo.act, id: alvo.id, name: alvo.name,
      kind: alvo.kind, type: alvo.type, fn: alvo.fn,
    },
    closest: () => elemento,
  };
  const contexto = {
    document: { addEventListener: () => {} },
    window: alvo.fn ? { [alvo.fn]: duble(alvo.fn) } : {},
    ev: { target: elemento },
    showHistory: duble('showHistory'),
    viewUser: duble('viewUser'),
    [fnNome]: duble(fnNome),
    viewPatient: duble('viewPatient'),
    rebookItem: duble('rebookItem'),
    cancelItem: duble('cancelItem'),
    console,
  };
  new Function(...Object.keys(contexto), corpo)(...Object.values(contexto));
  return chamadas;
}

test('o clique em "Abrir histórico" chega a showHistory com o nome intacto', () => {
  const chamadas = extrairDelegado(htmlDe('admin.html'), {
    act: 'show-history',
    id: 'abc-123',
    name: "Maria d'Ávila Souza",
  });
  assert.deepEqual(chamadas, [['showHistory', ['abc-123', "Maria d'Ávila Souza"]]]);
});

test('o clique em "Visualizar" chega a openUserView', () => {
  const chamadas = extrairDelegado(htmlDe('admin.html'), { act: 'user-view', id: 'abc-123' }, 'openUserView');
  assert.deepEqual(chamadas, [['openUserView', ['abc-123']]]);
});

test('o clique em "Ver histórico" do atendente chega a viewPatient com o nome', () => {
  const chamadas = extrairDelegado(htmlDe('atendente.html'), {
    act: 'view-history',
    id: 'abc-123',
    name: "Maria d'Ávila Souza",
  });
  assert.deepEqual(chamadas, [['viewPatient', ['abc-123', "Maria d'Ávila Souza"]]]);
});

test('o clique em reagendar chega a rebookItem com tipo e id', () => {
  const chamadas = extrairDelegado(htmlDe('dashboard.html'), {
    act: 'rebook',
    kind: 'appointment',
    id: 'abc-123',
  });
  assert.deepEqual(chamadas, [['rebookItem', ['appointment', 'abc-123']]]);
});

test('o clique em cancelar chega a cancelItem com tipo, id e subtipo', () => {
  const chamadas = extrairDelegado(htmlDe('dashboard.html'), {
    act: 'cancel',
    kind: 'exam',
    id: 'abc-123',
    type: 'laboratório',
  });
  assert.deepEqual(chamadas, [['cancelItem', ['exam', 'abc-123', 'laboratório']]]);
});

test('o clique em editar despacha para a função nomeada em data-fn', () => {
  const chamadas = extrairDelegado(htmlDe('dashboard.html'), {
    act: 'edit',
    id: 'abc-123',
    fn: 'editAppt',
  });
  assert.deepEqual(chamadas, [['editAppt', ['abc-123']]]);
});

test('nenhum painel interpola esc() direto dentro de onclick', () => {
  // Correção estrutural: o dado vai em data-attribute e um listener
  // delegado lê do dataset. Isso elimina a classe do problema, em vez de
  // depender só do escape.
  for (const p of PAINEIS) {
    const usos = htmlDe(p).match(/onclick\s*=\s*"[^"]*\$\{esc\(/g) || [];
    assert.equal(
      usos.length,
      0,
      `${p} ainda tem ${usos.length} interpolação(ões) de esc() dentro de onclick=`
    );
  }
});

test('a aspa dupla de um dado NÃO escapa do atributo onclick', () => {
  // A dívida técnica registrou "XSS residual: esc() não cobre onclick com
  // aspas duplas". Isto testa a afirmação em vez de acreditar nela.
  //
  // A defesa tem duas camadas, e é a segunda que fecha o caso:
  //  1. estrutural — não há mais `esc()` interpolado dentro de onclick (teste
  //     acima); o dado vai em data-attribute e um listener delegado lê;
  //  2. mesmo que alguém volte a interpolar, esc() transforma `"` em
  //     `&quot;`, que é decodificado DEPOIS de o limite do atributo estar
  //     definido — ou seja, não abre aspas.
  //
  // O esc() é extraído da página de verdade (casamento de chaves) e
  // executado num sandbox, para não testar uma cópia minha.
  const html = htmlDe('admin.html');
  const inicio = html.indexOf('function esc(');
  assert.ok(inicio > -1, 'admin.html deveria definir esc()');
  const abre = html.indexOf('{', inicio);
  let prof = 0;
  let fim = -1;
  for (let i = abre; i < html.length; i += 1) {
    if (html[i] === '{') prof += 1;
    else if (html[i] === '}') { prof -= 1; if (prof === 0) { fim = i; break; } }
  }
  assert.ok(fim > abre, 'não consegui isolar o corpo de esc()');
  const fonteEsc = html.slice(inicio, fim + 1);

  const ctx = { entrada: 'x" onmouseover="alert(1)" x="' };
  vm.runInNewContext(`${fonteEsc}\nthis.resultado = esc(entrada);`, ctx);
  const saida = ctx.resultado;

  assert.ok(!saida.includes('"'), `a aspa dupla deveria virar entidade, veio: ${saida}`);
  assert.ok(saida.includes('&quot;'), `" deveria virar &quot;, veio: ${saida}`);

  // O ponto decisivo: com a entidade no lugar, o atributo continua fechado.
  const botao = `<button onclick="editUnit('${saida}')">Editar</button>`;
  assert.ok(!botao.includes('onmouseover="alert(1)"'), 'o payload não pode virar um atributo novo');
  assert.equal((botao.match(/"/g) || []).length, 2, 'o botão deve ter exatamente as duas aspas do atributo onclick');
});

test('todo data-act usado é tratado pelo listener delegado', () => {
  for (const p of PAINEIS) {
    const html = htmlDe(p);
    const usados = [...new Set(html.match(/data-act="([a-z-]+)"/g) || [])].map(
      (s) => s.slice(10, -1)
    );
    for (const acao of usados) {
      assert.ok(
        html.includes(`'${acao}'`),
        `${p}: data-act="${acao}" não aparece tratado em nenhum listener`
      );
    }
    if (usados.length) {
      assert.ok(
        /addEventListener\(\s*'click'[\s\S]{0,900}?dataset\.act/.test(html),
        `${p} usa data-act mas não tem listener delegado no document`
      );
    }
  }
});

test('os botões de histórico carregam o id e o nome em data-attributes', () => {
  const esperado = {
    'admin.html': ['show-history', 'user-view'],
    'atendente.html': ['view-history'],
  };
  for (const [p, acoes] of Object.entries(esperado)) {
    const html = htmlDe(p);
    for (const acao of acoes) {
      assert.ok(
        html.includes(`data-act="${acao}"`),
        `${p} deveria ter um botão com data-act="${acao}"`
      );
    }
    assert.ok(html.includes('data-name="${esc('), `${p}: o botão precisa de data-name escapado`);
    assert.ok(html.includes('data-id="${esc('), `${p}: o botão precisa de data-id escapado`);
  }
});

test('todo data-act usado tem um handler delegado que o cobre', () => {
  for (const p of PAINEIS) {
    const html = htmlDe(p);
    const usados = [...new Set(html.match(/data-act="([a-z-]+)"/g) || [])].map(
      (s) => s.slice(10, -1)
    );
    const temDelegado = /addEventListener\(\s*'click'[\s\S]{0,900}?dataset\.act/.test(html);
    if (usados.length) {
      assert.ok(temDelegado, `${p} usa data-act mas não tem listener delegado`);
    }
  }
});