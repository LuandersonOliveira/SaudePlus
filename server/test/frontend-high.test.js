/**
 * Seis defeitos do front que eram HIGH e compartilham a mesma origem: código
 * duplicado entre as páginas, escrito uma vez e nunca revisitado.
 *
 * Todos aqui são verificáveis sem browser — o que é o ponto: eles sobreviveram
 * a muitos reviews porque "só de olho" não pega.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const ler = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const api = ler('assets/api.js');

// ===========================================================================
// 1. Login com MFA envenena o localStorage
// ===========================================================================

test('authLogin não grava sessão quando a resposta exige MFA', () => {
  // Com MFA ligado, POST /auth/login responde { mfa_required, mfa_token } —
  // sem `token`. A versão anterior chamava setSession(data.token, ...) à toa,
  // guardando a STRING "undefined" em saude_token e saude_user. Depois,
  // getStoredUser() fazia JSON.parse("undefined") e LANÇAVA — deixando
  // admin.html e atendente.html presos em skeleton, sem redirecionar.
  assert.match(
    api,
    /if \(!data \|\| !data\.token\) return data;/,
    'authLogin precisa sair antes do setSession quando não há token'
  );
  assert.ok(
    api.indexOf('!data.token') < api.indexOf('setSession(data.token'),
    'a guarda precisa vir ANTES do setSession'
  );
});

test('getStoredUser se recupera de conteúdo corrompido', () => {
  assert.match(
    api,
    /function getStoredUser\(\)[\s\S]{0,600}?try \{[\s\S]{0,400}?\} catch \(_e\) \{[\s\S]{0,300}?clearSession\(\);[\s\S]{0,200}?return null;/,
    'getStoredUser precisa de try/catch que limpa a sessão e devolve null'
  );
});

test('admin.html e atendente.html tratam falha de sessão sem tela travada', () => {
  // requireAuth()/requireRole() rejeitam quando não há sessão. Sem try/catch, a
  // rejeição vira unhandled rejection e a página fica em skeleton para sempre.
  // admin.html usa requireAuth, atendente.html usa requireRole.
  for (const [p, guarda] of [['admin.html', 'requireAuth'], ['atendente.html', 'requireRole']]) {
    const html = ler(p);
    const i = html.indexOf('addEventListener(\'load\'');
    const janela = html.slice(i, i + 400);
    assert.match(
      janela,
      /try \{[\s\S]{0,200}?await require(Role|Auth)\(/,
      `${p}: ${guarda}() deveria estar dentro de um try`
    );
    assert.match(
      janela,
      /\} catch \(_e\) \{[\s\S]{0,80}?location\.replace\('auth\.html'\)/,
      `${p}: o catch deveria mandar o usuário para auth.html`
    );
  }
});

// ===========================================================================
// 2. /auth/* não renova o token — logout silencioso
// ===========================================================================

test('o refresh alcança /auth/me, que antes era excluído', () => {
  // A guarda era `path.indexOf('/auth/') !== 0`, que excluía /auth/me e
  // /auth/me/export. Com o access token de 15min expirado, abrir "Minha
  // conta" recebia 401, caía no clearSession() e deslogava — mesmo com um
  // refresh token de 30 dias válido na mão.
  const m = api.match(/AUTH_NO_RETRY\s*=\s*(\[[^\]]*\])/);
  assert.ok(m, 'deveria existir uma lista AUTH_NO_RETRY explícita');
  const lista = m[1];
  for (const p of ['/auth/login', '/auth/signup', '/auth/refresh', '/auth/logout']) {
    assert.ok(lista.includes(p), `${p} precisa continuar sem retry`);
  }
  assert.ok(!lista.includes("'/auth/'"), 'o prefixo /auth/ inteiro não pode mais ser excluído');
  assert.ok(!lista.includes('/auth/me'), '/auth/me precisa conseguir renovar');
});

// ===========================================================================
// 3. privacy.html nunca carregava assets/api.js
// ===========================================================================

test('privacy.html carrega api.js e usa window.API_BASE', () => {
  const html = ler('privacy.html');
  assert.match(
    html,
    /<script[^>]*src="assets\/api\.js"[^>]*>/,
    'privacy.html precisa carregar assets/api.js — sem ele window.API_BASE é sempre undefined'
  );
  assert.match(
    html,
    /API_BASE\s*\|\|\s*'http:\/\/localhost:4000'/,
    'o fallback deve continuar existindo'
  );
  // E o script precisa vir antes do script inline que usa API_BASE.
  const iApi = html.indexOf('assets/api.js');
  const iFetch = html.indexOf('/public/dpo');
  assert.ok(iApi > -1 && iFetch > -1 && iApi < iFetch, 'api.js precisa vir antes do fetch do DPO');
});

// ===========================================================================
// 4. .grid-3 e .opt não existiam no design system
// ===========================================================================

test('.grid-3 existe e colapsa junto com as outras', () => {
  const css = ler('assets/styles.css');
  assert.match(css, /\.grid-3\s*\{/, '.grid-3 não existe no design system');
  assert.match(
    css,
    /\.grid-2,\s*\.grid-3,\s*\.grid-4,\s*\.grid-5/,
    '.grid-3 precisa entrar na regra responsiva que colapsa as demais'
  );
});

test('admin.html usa grid-3 no formulário de vínculo e a regra existe', () => {
  assert.match(ler('admin.html'), /class="grid grid-3"/, 'o formulário de vínculo usa grid-3');
  assert.match(ler('assets/styles.css'), /\.grid-3\s*\{/);
});

test('.opt vive no styles.css, não num <style> de uma página só', () => {
  const css = ler('assets/styles.css');
  assert.match(css, /\.opt\s*\{/, '.opt precisa estar no design system compartilhado');
  assert.ok(
    !/\.opt\s*\{/.test(ler('auth.html')),
    'a regra duplicada no <style> do auth.html deve sair'
  );
  // E as três páginas que usam .opt precisam da regra compartilhada.
  for (const p of ['dashboard.html', 'admin.html', 'atendente.html']) {
    assert.ok(ler(p).includes('class="opt"'), `${p} deveria usar .opt`);
  }
});

// ===========================================================================
// 5. "Hoje" calculado em UTC
// ===========================================================================

test('admin.html e atendente.html não calculam a data de hoje em UTC', () => {
  // toISOString() é UTC. Em America/Sao_Paulo (UTC-3) o dia vira às 21h,
  // então "Agenda de hoje" e "Fila do dia" mostravam AMANHÃ das 21h à meia-noite.
  for (const p of ['admin.html', 'atendente.html']) {
    const html = ler(p);
    assert.ok(
      !/const today = new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/.test(html),
      `${p} ainda calcula "hoje" em UTC`
    );
    assert.ok(
      !/toISOString\(\)\.slice\(0,\s*10\)/.test(html),
      `${p} ainda usa toISOString().slice(0,10) para data local`
    );
  }
});

test('a data local é calculada com os getters locais, não toISOString', () => {
  // Não basta sumir com toISOString: o certo é getFullYear/getMonth/getDate,
  // que seguem o fuso do servidor. Procuramos o conjunto completo dos três,
  // já que o objeto Date pode ter outro nome.
  for (const p of ['admin.html', 'atendente.html']) {
    const html = ler(p);
    assert.match(html, /\.getFullYear\(\)/, `${p} deveria usar getFullYear()`);
    assert.match(html, /\.getMonth\(\)/, `${p} deveria usar getMonth()`);
    assert.match(html, /\.getDate\(\)/, `${p} deveria usar getDate()`);
    assert.match(
      html,
      /String\([^)]*\.getMonth\(\) \+ 1\)\.padStart\(2, '0'\)/,
      `${p}: getMonth() é 0-based e precisa do +1 com dois dígitos`
    );
  }
});

// ===========================================================================
// 6. initProfile duplicava listeners a cada salvamento
// ===========================================================================

test('initProfile não registra os mesmos listeners duas vezes', () => {
  const html = ler('dashboard.html');
  assert.match(
    html,
    /profileListenersBound/,
    'dashboard.html precisa de uma guarda de idempotência, como acctLoaded no admin'
  );

  // O submit precisa estar numa função registrada ANTES do try: dentro dele,
  // um 401 no GET inicial deixa o form sem handler e o browser faz um GET
  // nativo, perdredo tudo.
  const iBind = html.indexOf('function bindProfileListeners()');
  const iInit = html.indexOf('async function initProfile()');
  assert.ok(iBind > -1 && iInit > -1 && iBind < iInit);
  const corpo = html.slice(iBind, iBind + 900);
  assert.match(corpo, /if \(profileListenersBound\) return;/, 'a guarda precisa estar no topo');
  assert.match(corpo, /addEventListener\('submit', saveProfile\)/);
  // E initProfile tem de chamar a bind antes do try.
  const ini = html.slice(iInit, iInit + 400);
  assert.match(ini, /bindProfileListeners\(\);[\s\S]{0,40}?try \{/);
  // O registro não pode ter sobrado dentro do try.
  const dentro = html.slice(iInit, iInit + 2500).match(/addEventListener\('submit'/);
  assert.equal(dentro, null, 'o listener de submit ainda está dentro do try');
});

test('o dashboard não usa get() || undefined para campos apagáveis', () => {
  // '' = usuário apagou (limpar); undefined = campo não existe na página
  // (manter). Com `|| undefined`, apagar virava "não enviar" e o dado sumia.
  const html = ler('dashboard.html');
  assert.ok(
    !/birth_date:\s*get\('p_birth_date'\)\s*\|\|\s*undefined/.test(html),
    'birth_date ainda usa `|| undefined`'
  );
  assert.ok(
    !/mobile:\s*get\('p_mobile'\)\s*\|\|\s*undefined/.test(html),
    'mobile ainda usa `|| undefined`'
  );
  assert.match(html, /const campo = \(id\)/, 'dashboard.html deveria ter o helper campo()');
  // cpf/rg/cns são a exceção documentada: input vazio = "não me mexa".
  assert.match(html, /cpf: campo\('p_cpf'\) \|\| undefined/);
});

// ===========================================================================
// Rede de segurança: nenhum script inline pode quebrar a página
// ===========================================================================

test('todo script inline das páginas é JavaScript sintaticamente válido', () => {
  // Os defeitos desta frente foram todos em <script> inline, editados por
  // regex. Um ponto-e-vírgula fora de lugar derruba a página inteira em
  // silêncio — e nenhum teste de comportamento pega isso, porque a falha
  // acontece no parse, antes de qualquer código rodar. Então compilamos.
  const { execFileSync } = require('node:child_process');
  const os = require('node:os');
  const paginas = ['index.html', 'auth.html', 'dashboard.html', 'admin.html', 'atendente.html', 'privacy.html'];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inline-'));
  let blocos = 0;
  try {
    for (const p of paginas) {
      const html = ler(p);
      const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
      let m;
      let i = 0;
      while ((m = re.exec(html)) !== null) {
        i += 1;
        blocos += 1;
        const arq = path.join(tmp, `${p.replace('.html', '')}-${i}.js`);
        fs.writeFileSync(arq, m[1]);
        try {
          execFileSync(process.execPath, ['--check', arq], { stdio: 'pipe' });
        } catch (e) {
          assert.fail(`${p} bloco ${i} tem erro de sintaxe:\n${e.stderr.toString()}`);
        }
      }
      assert.ok(i > 0, `${p} não tem script inline para conferir`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  assert.ok(blocos >= paginas.length);
});

// ===========================================================================
// O dispatch de data-act é testado de verdade (executando, não por regex)
// ===========================================================================

test('o listener delegado do dashboard despacha as três ações', () => {
  const html = ler('dashboard.html');
  // A delegação fica num listener de document que casa com [data-act] — não no
  // primeiro addEventListener('click') da página, que é o das abas. Ancoramos
  // no closest('[data-act]') e voltamos até o addEventListener que o contém.
  const iAlvo = html.indexOf("closest('[data-act]')");
  assert.ok(iAlvo > -1, 'o listener delegado deveria usar closest([data-act])');
  const marca = html.lastIndexOf("addEventListener('click'", iAlvo);
  assert.ok(marca > -1 && marca < iAlvo, 'closest([data-act]) deveria estar dentro de um listener de click');

  // Recorta o corpo da arrow function do listener.
  const abre = html.indexOf('{', marca);
  let prof = 0;
  let corpo = '';
  for (let i = abre; i < html.length; i += 1) {
    if (html[i] === '{') { prof += 1; if (prof === 1) continue; }
    if (html[i] === '}') { prof -= 1; if (prof === 0) break; }
    corpo += html[i];
  }
  assert.match(corpo, /rebook/);
  assert.match(corpo, /cancel/);
  assert.match(corpo, /edit/);

  // Executa de verdade com dublês — regex não prova que o despacho funciona.
  // O corpo usa `return`, então vai embrulhado numa função antes de rodar.
  const chamadas = [];
  const elemento = {
    dataset: { act: 'rebook', kind: 'exam', id: 'x1', type: 't' },
    closest: () => elemento,
  };
  const ctx = {
    document: { addEventListener: () => {} },
    rebookItem: (...a) => { chamadas.push(['rebook', a]); },
    cancelItem: () => {},
    console,
  };
  vm.runInNewContext(`(function (ev) {${corpo}})(this.ev)`, Object.assign(ctx, { ev: { target: elemento } }));
  assert.deepEqual(chamadas, [['rebook', ['exam', 'x1']]], 'rebook deveria chamar rebookItem(kind, id)');
});