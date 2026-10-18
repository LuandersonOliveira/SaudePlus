/**
 * Integridade do design system em assets/styles.css.
 *
 * O defeito que motivou este arquivo: o cabeçalho tinha um bloco de
 * comentário fechado na linha 4, depois texto solto ("Identidade: a lagoa...")
 * e um terminador de comentário órfão na linha 14. O parser de CSS, ao
 * encontrar lixo no nível superior, consome os restos até a próxima chave de
 * abertura — o que era exatamente a regra .sr-only da linha 18. Ela nunca
 * entrava na folha, e os 14 rótulos de leitor de tela + 4 skip-links
 * apareciam como texto visível em cinco páginas.
 *
 * Estes testes olham a estrutura, não o visual: é o que dá para provar
 * sem browser.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CSS_PATH = path.resolve(__dirname, '..', '..', 'assets', 'styles.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');

/**
 * Percorre a folha rastreando comentários. Devolve:
 *  - orfaos: posições de terminador de comentário sem abertura correspondente
 *  - textoSolto: posições de texto no nível superior, fora de comentário,
 *    fora de um bloco já aberto e fora de uma at-rule (@font-face, @media…)
 *  - chavesAbertas/chavesFechadas
 */
function inspecionar(hoje) {
  const orfaos = [];
  let i = 0;
  let emComentario = false;

  while (i < hoje.length) {
    const dois = hoje.substr(i, 2);
    if (dois === '/*') { emComentario = true; i += 2; continue; }
    if (dois === '*/') {
      if (!emComentario) orfaos.push(i);
      emComentario = false;
      i += 2;
      continue;
    }
    i += 1;
  }
  return {
    orfaos,
    chavesAbertas: (hoje.match(/\{/g) || []).length,
    chavesFechadas: (hoje.match(/\}/g) || []).length,
  };
}

/**
 * Remove comentários e devolve o texto restante.
 * (Necessário porque o defeito era justamente sobre comentário.)
 */
function semComentarios(hoje) {
  return String(hoje).replace(/\/\*[\s\S]*?\*\//g, '');
}

test('não há terminador de comentário órfão (a raiz do bug que engolia .sr-only)', () => {
  const r = inspecionar(css);
  assert.deepEqual(
    r.orfaos.map((i) => css.slice(Math.max(0, i - 60), i + 3).replace(/\n/g, '\\n')),
    [],
    'um terminador de comentário sem abertura correspondente faz o parser descartar tudo até a próxima chave'
  );
});

test('as chaves estão balanceadas', () => {
  const r = inspecionar(css);
  assert.equal(r.chavesAbertas, r.chavesFechadas, `${r.chavesAbertas} abre vs ${r.chavesFechadas} fecha`);
});

test('sem comentários, nenhum terminador sobrevive na folha', () => {
  // Equivalente textual da checagem estrutural: se sobrar um terminador
  // depois de remover os blocos, é porque um deles estava órfão.
  const limpo = semComentarios(css);
  assert.ok(
    !limpo.includes('*/'),
    `sobrou terminador de comentário fora de bloco: ${JSON.stringify(limpo.slice(limpo.indexOf('*/') - 40, limpo.indexOf('*/') + 3))}`
  );
});

test('entre o início do arquivo e a primeira regra só existe @font-face', () => {
  // Higiene do cabeçalho. Este é um invariante mais estreito que o bug
  // original (que punha lixo depois do @font-face), mas mantê-lo fechado
  // impede a reincidência mais óbvia: alguém escreve texto solto no topo
  // e a primeira regra da folha é engolida pelo parser.
  const limpo = semComentarios(css);
  const i = limpo.indexOf('{');
  assert.ok(i > -1, 'a folha não tem nenhuma regra');
  const preludio = limpo.slice(0, i).trim();
  assert.equal(
    preludio,
    '@font-face',
    `esperava só "@font-face" antes da primeira regra, veio: ${JSON.stringify(preludio.slice(0, 120))}`
  );
});

test('a folha começa com @font-face — a fonte precede qualquer layout', () => {
  // Se a fonte for movida para o fim, o primeiro paint cai no fallback e
  // pisca em 3G instável. O DESIGN.md pede Inter local com display:swap.
  assert.ok(css.trimStart().startsWith('/*'), 'o cabeçalho comentado deve vir primeiro');
  const i = css.indexOf('@font-face');
  const iRoot = css.indexOf(':root');
  assert.ok(i > -1, '@font-face ausente — Inter autohospedada sumiu');
  assert.ok(i < iRoot, 'a fonte precisa vir antes de :root');
  assert.match(css, /font-display\s*:\s*swap/);
  assert.match(css, /fonts\/inter-latin\.woff2/);
});

test('.sr-only está presente e esconde visualmente o texto', () => {
  const regra = /\.sr-only\s*\{([^}]*)\}/.exec(css);
  assert.ok(regra, '.sr-only não está na folha — rótulos de leitor de tela viram texto visível');
  const corpo = regra[1];
  assert.match(corpo, /position\s*:\s*absolute/);
  assert.match(corpo, /width\s*:\s*1px/);
  assert.match(corpo, /height\s*:\s*1px/);
  assert.match(corpo, /clip\s*:/);
  assert.match(corpo, /overflow\s*:\s*hidden/);
});

test('o veredito pega o bug original (auto-teste do próprio teste)', () => {
  // Um teste que nunca falha não prova nada. Este é o stylesheet exatamente
  // como estava antes da correção: cabeçalho fechado na linha 4, texto solto,
  // terminador órfão, e a .sr-only logo depois — a regra que sumia.
  const quebrado = [
    '/* ============================================================',
    '   Saúde+ — Design system',
    '   ... offline. */',
    '',
    '/* latin */',
    '@font-face{ font-family:\'Inter\'; }',
    '   Identidade: a "lagoa" (Lagoa de Itaenga) como fio condutor —',
    '   ========================================================================== */',
    '',
    '/* P1 acessibilidade */',
    '.sr-only{position:absolute;width:1px;height:1px}',
    '',
    '.card{padding:20px}',
  ].join('\n');

  const r = inspecionar(quebrado);
  assert.equal(r.orfaos.length, 1, 'o veredito deveria achar exatamente um terminador órfão');

  // Este é o teste que realmente pegaria a regressão: com comentários
  // removidos, sobra um "*/" no meio da folha.
  const limpo = semComentarios(quebrado);
  assert.ok(limpo.includes('*/'), 'o terminador órfão deveria sobreviver à remoção de comentários');
  assert.match(limpo, /Identidade/, 'o texto solto deveria estar presente');

  // E o prelúdio: o lixo vem DEPOIS do @font-face, então a checagem de
  // cabeçalho não pegaria este caso — o terminador órfão pega.
  const preludio = limpo.slice(0, limpo.indexOf('{')).trim();
  assert.equal(preludio, '@font-face');
});

test('toda página que usa .sr-only tem a regra que a esconde', () => {
  const paginas = ['index.html', 'auth.html', 'dashboard.html', 'admin.html', 'atendente.html'];
  const temRegra = /\.sr-only\s*\{/.test(css);
  assert.ok(temRegra, '.sr-only ausente: todo skip-link apareceria como link visível no topo');
  for (const p of paginas) {
    const html = fs.readFileSync(path.resolve(__dirname, '..', '..', p), 'utf8');
    const usos = (html.match(/class="[^"]*\bsr-only\b/g) || []).length;
    assert.ok(usos > 0, `${p} deveria ter ao menos um rótulo sr-only`);
  }
});