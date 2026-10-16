#!/usr/bin/env node
/* ==========================================================================
   Saúde+ — diagnóstico do ambiente de desenvolvimento.

   Existe porque o setup tem seis lugares onde falhar (.env, segredos
   fracos, MySQL parado, banco ausente, migrations rodadas pela metade,
   porta ocupada) e cada falha aparece como um erro diferente e pouco
   informativo — às vezes só como "Failed to fetch" no console do front.

   Uso:  npm run doctor     (saída 0 = tudo pronto, 1 = há problema)
   ========================================================================== */
const fs = require('fs');
const fsp = require('fs/promises');
const net = require('net');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(ROOT, 'server');

// Painéis que definem o helper esc() e interpolam em onclick.
const ARQUIVOS_ESC = ['admin.html', 'atendente.html', 'dashboard.html'];

// Colunas/tabelas que o código toca mas que dependem de migration.
const COLUNAS_ESPERADAS = [
  ['users', 'govbr_sub'],
  ['users', 'totp_secret'],
  ['users', 'totp_enabled'],
  ['users', 'privacy_version'],
  ['users', 'consent_at'],
  ['users', 'consent_ip'],
  ['users', 'deleted_at'],
  ['users', 'cns'],
  ['users', 'job_role'],
  ['health_units', 'cnes_code'],
  ['diseases', 'source'],
];
const TABELAS_ESPERADAS = [
  'refresh_tokens',
  'audit_log',
  'professionals',
  'professional_offers',
  'work_schedules',
  'schedule_blocks',
];

// --------------------------------------------------------------------------
// Checks puros (testados em server/test/doctor.test.js)
// --------------------------------------------------------------------------

function nodeOk(version) {
  const m = /^v?(\d+)\./.exec(String(version || ''));
  if (!m) return false;
  return Number(m[1]) >= 18;
}

/**
 * Valida os três segredos do .env. Devolve a lista de problemas — nunca
 * o valor: o detalhe só informa comprimento ou formato esperado.
 */
function secretsProblems(env) {
  const problemas = [];
  const jwt = String(env.JWT_SECRET || '');
  if (jwt.length < 32) {
    problemas.push({
      name: 'JWT_SECRET',
      detail: `tem ${jwt.length} caracteres; mínimo 32`,
      fix: 'node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"',
    });
  }
  const key = String(env.DATA_ENCRYPTION_KEY || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    problemas.push({
      name: 'DATA_ENCRYPTION_KEY',
      detail: key ? `formato inválido (${key.length} caracteres); esperado 64 hex` : 'vazia — CPF/RG/CNS serão gravados em texto puro',
      fix: 'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    });
  }
  const pass = String(env.ADMIN_PASSWORD || '');
  if (pass.length < 8) {
    problemas.push({
      name: 'ADMIN_PASSWORD',
      detail: `tem ${pass.length} caracteres; mínimo 8`,
      fix: 'edite ADMIN_PASSWORD no server/.env',
    });
  }
  return problemas;
}

/**
 * Acusa `onclick="…${esc(x)}…"` nos painéis: o esc() do projeto não
 * escapava apóstrofo, e um nome como "Maria d'Ávila" virava SyntaxError
 * dentro do atributo onclick — o botão morria sem erro visível.
 */
function escapingProblems(arquivos) {
  const achados = [];
  for (const file of ARQUIVOS_ESC) {
    const html = arquivos[file];
    if (typeof html !== 'string') continue;

    const usos = html.match(/onclick\s*=\s*"[^"]*\$\{esc\(/g);
    if (!usos || !usos.length) continue; // a página não interpola esc() em onclick

    // O sinal que importa é a classe de caracteres do .replace dentro de esc():
    // é ela que decide se o apóstrofo sobrevive. Procurar pela entidade
    // &#39; em algum lugar do arquivo erra — o mapa pode vir antes ou depois
    // da função, e o mapa sozinho não prova nada.
    const def = /function esc\([\s\S]{0,400}?\.replace\(\s*\/\s*\[([^\]]*)\]\s*\//.exec(html);
    const classe = def ? def[1] : '';
    const cobreApostrofo = /'|\x27|u0027/i.test(classe);
    if (def && cobreApostrofo) continue; // já corrigido

    // Conta todas as interpolações de esc() na página (não só a primeira de
    // cada onclick) — o número é informativo, mas precisa ser exato para
    // dizer quanto trabalho falta.
    const total = (html.match(/\$\{esc\(/g) || []).length;
    const porque = !def
      ? 'não encontrei a definição de esc() com .replace(/[…]/)'
      : 'a classe de caracteres do .replace não inclui o apóstrofo';

    achados.push({
      file,
      count: total,
      detail: `${porque} e há ${total} interpolação(ões) de esc()`,
    });
  }
  return achados;
}

function dpoWarning(env) {
  const name = String(env.DPO_NAME || '').trim();
  const email = String(env.DPO_EMAIL || '').trim();
  if (name && email) return null;
  const faltando = [!name && 'DPO_NAME', !email && 'DPO_EMAIL'].filter(Boolean).join(' e ');
  return `${faltando} vazio(s): privacy.html mostrará o contato do encarregado como "indisponível no momento"`;
}

/** Chave de throttle de login: ip normalizado + e-mail normalizado. */
function parsePairs(ip, email) {
  return `${String(ip || '').trim()}|${String(email || '').trim().toLowerCase()}`;
}

// --------------------------------------------------------------------------
// Checks de ambiente (I/O)
// --------------------------------------------------------------------------

function loadEnv() {
  const envPath = path.join(SERVER_DIR, '.env');
  if (!fs.existsSync(envPath)) return { ok: false, env: {} };
  // dotenv mora em server/node_modules — resolver dali, não da raiz.
  const dotenvPath = require.resolve('dotenv', { paths: [SERVER_DIR] });
  const dotenv = require(dotenvPath);
  const parsed = dotenv.parse(fs.readFileSync(envPath));
  return { ok: true, env: parsed };
}

function loadPool() {
  const dbPath = path.join(SERVER_DIR, 'src', 'db.js');
  // db.js lê process.env no require — então o .env precisa estar aplicado antes.
  return require(dbPath);
}

function checkPort(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(700);
    const done = (ocupada) => {
      socket.destroy();
      resolve(ocupada);
    };
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
  });
}

async function checkMigrations(dbName, pool) {
  const faltando = [];
  // information_schema devolve TABLE_NAME/COLUMN_NAME em maiúsculas; os alias
  // explícitos evitam depender do formato do driver.
  const [cols] = await pool.query(
    `SELECT table_name AS t, column_name AS c FROM information_schema.columns
      WHERE table_schema = ? AND (${COLUNAS_ESPERADAS.map(() => '(table_name = ? AND column_name = ?)').join(' OR ')})`,
    [dbName, ...COLUNAS_ESPERADAS.flat()]
  );
  const achados = new Set(cols.map((r) => `${r.t}.${r.c}`));
  for (const [t, c] of COLUNAS_ESPERADAS) {
    if (!achados.has(`${t}.${c}`)) faltando.push(`${t}.${c}`);
  }
  const [tabs] = await pool.query(
    'SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?',
    [dbName]
  );
  const temTabela = new Set(tabs.map((r) => r.t));
  for (const t of TABELAS_ESPERADAS) {
    if (!temTabela.has(t)) faltando.push(`tabela ${t}`);
  }
  return faltando;
}

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function ok(nome, detalhe) {
  console.log(`${GREEN}[ok]${RESET} ${nome}${detalhe ? ` ${DIM}— ${detalhe}${RESET}` : ''}`);
}
function falha(nome, detalhe) {
  console.log(`${RED}[FALHA]${RESET} ${nome}${detalhe ? ` ${DIM}— ${detalhe}${RESET}` : ''}`);
}
function aviso(nome, detalhe) {
  console.log(`${YELLOW}[AVISO]${RESET} ${nome}${detalhe ? ` ${DIM}— ${detalhe}${RESET}` : ''}`);
}

async function main() {
  console.log(`${BOLD}Saúde+ — diagnóstico do ambiente${RESET}\n`);
  const fixes = [];
  const adicionarFix = (comando) => { if (comando) fixes.push(comando); };

  // 1) Node
  if (nodeOk(process.versions.node)) ok('node', `v${process.versions.node}`);
  else { falha('node', `v${process.versions.node}; mínimo v18`); adicionarFix('nvm install 18'); }

  // 2) Dependências do backend
  try {
    require.resolve('express', { paths: [SERVER_DIR] });
    ok('deps', 'server/node_modules');
  } catch {
    falha('deps', 'server/node_modules ausente ou incompleto');
    adicionarFix('npm --prefix server install');
  }

  // 3) .env
  const { ok: temEnv, env } = loadEnv();
  if (temEnv) ok('.env', 'server/.env');
  else {
    falha('.env', 'server/.env não existe');
    adicionarFix('cd server && cp .env.example .env');
  }

  // 4) Segredos
  if (temEnv) {
    const problemas = secretsProblems(env);
    if (problemas.length === 0) ok('segredos', 'JWT_SECRET, DATA_ENCRYPTION_KEY e ADMIN_PASSWORD ok');
    else {
      for (const p of problemas) { falha(`segredo ${p.name}`, p.detail); adicionarFix(p.fix); }
    }
    const dpo = dpoWarning(env);
    if (dpo) aviso('dpo', dpo);
  }

  // 5/6/7) MySQL, banco e migrations
  let pool = null;
  if (temEnv) {
    // db.js lê process.env no require.
    const dotenv = require(require.resolve('dotenv', { paths: [SERVER_DIR] }));
    dotenv.config({ path: path.join(SERVER_DIR, '.env') });
    try {
      pool = loadPool();
      await pool.query('SELECT 1');
      const dbName = env.DB_NAME || 'saude';
      ok('mysql', `${env.DB_HOST || 'localhost'}:${env.DB_PORT || 3306} (${env.DB_USER || 'root'})`);

      const [[sch]] = await pool.query(
        'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
        [dbName]
      );
      if (sch) {
        ok('banco', dbName);
        const faltando = await checkMigrations(dbName, pool);
        if (faltando.length === 0) ok('migrations', 'todas as colunas e tabelas esperadas existem');
        else {
          falha('migrations', `faltam ${faltando.length}: ${faltando.join(', ')}`);
          console.log(`      ${DIM}Sem migrate:interop o MFA fica silenciosamente desligado.${RESET}`);
          adicionarFix('npm run db:migrate');
        }
      } else {
        falha('banco', `${dbName} não existe`);
        adicionarFix('npm run db:setup');
      }
    } catch (err) {
      falha('mysql', `${err.code || err.message} — confira DB_HOST/DB_USER/DB_PASSWORD (nunca exibida)`);
      adicionarFix('npm run db:setup');
    }
  }

  // 8) Portas
  const apiLivre = !(await checkPort(Number(env.PORT) || 4000));
  const webLivre = !(await checkPort(8080));
  if (apiLivre) ok('porta 4000', 'livre (API pode subir)');
  else aviso('porta 4000', 'ocupada — a API já parece estar rodando');
  if (webLivre) ok('porta 8080', 'livre (front pode subir)');
  else aviso('porta 8080', 'ocupada — o front já parece estar rodando');

  // Frontend: escape de apóstrofo nos onclick dos painéis. É um defeito de
  // código, não de ambiente: não bloqueia `npm run dev`, mas deixa botões
  // ("Abrir histórico") sem ação para quem tem nome com apóstrofo.
  const arquivos = {};
  for (const f of ARQUIVOS_ESC) {
    try { arquivos[f] = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { /* ausente */ }
  }
  const problemasEsc = escapingProblems(arquivos);
  if (problemasEsc.length === 0) {
    ok('frontend-escaping', 'esc() escapa apóstrofo nos três painéis');
  } else {
    for (const p of problemasEsc) {
      aviso(`frontend-escaping ${p.file}`, `${p.detail} — botões com nome acentuado ficam sem ação`);
    }
  }

  console.log('');
  if (fixes.length) {
    console.log(`${BOLD}Para corrigir:${RESET}`);
    for (const f of [...new Set(fixes)]) console.log(`  ${DIM}$ ${f}${RESET}`);
    console.log('');
  }

  // O pool do MySQL mantém o event loop vivo; sem fechar, o processo
  // fica pendurado depois do relatório.
  if (pool) {
    await pool.end().catch(() => {});
  }

  if (fixes.length) {
    console.log(`${RED}${fixes.length} pendência(s).${RESET}`);
    process.exit(1);
  }
  console.log(`${GREEN}Ambiente pronto. Rode: npm run dev${RESET}`);
  process.exit(0);
}

module.exports = {
  nodeOk,
  secretsProblems,
  escapingProblems,
  dpoWarning,
  parsePairs,
  main,
};

if (require.main === module) {
  main().catch((err) => {
    console.error('doctor falhou:', err);
    process.exit(1);
  });
}