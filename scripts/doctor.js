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
const net = require('net');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(ROOT, 'server');

// Colunas/tabelas que o código toca mas que dependem de migration.
//
// A lista precisa acompanhar TODA migration nova. Uma coluna que falta aqui
// é uma coluna que o doctor não acusa: quando a Fase 5 adicionou
// `duration_minutes`, o doctor continuou respondendo "Ambiente pronto" em uma
// base sem ela — e todo agendamento devolvia 500. O teste que exige esta lista
// sincronizada está em server/test/doctor.test.js.
const COLUNAS_ESPERADAS = [
  ['users', 'govbr_sub'],
  ['users', 'totp_secret'],
  ['users', 'totp_enabled'],
  // Fase 5, migration 006: sem esta, o TOTP aceita replay e nada avisa.
  ['users', 'totp_last_step'],
  ['users', 'privacy_version'],
  ['users', 'consent_at'],
  ['users', 'consent_ip'],
  ['users', 'deleted_at'],
  ['users', 'cns'],
  ['users', 'job_role'],
  // Fase 5, migration 007: o INSERT do agendamento e o cálculo de conflito
  // referenciam estas duas; sem elas, agendar dá 500.
  ['appointments', 'duration_minutes'],
  ['exams', 'duration_minutes'],
  ['health_units', 'cnes_code'],
  ['diseases', 'source'],
  // Vínculo profissional ↔ atendente. Sem esta coluna, o atendente nunca é
  // filtrado pela própria agenda e o vínculo some do painel do admin.
  ['professionals', 'user_id'],
  // NV03: sem estas a lista de espera responde 500 na primeira consulta.
  ['waitlist', 'user_id'],
  ['waitlist', 'status'],
  ['waitlist', 'record_id'],
];
const TABELAS_ESPERADAS = [
  'refresh_tokens',
  'password_reset_tokens',
  'audit_log',
  'professionals',
  'professional_offers',
  'work_schedules',
  'schedule_blocks',
  'waitlist',
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
 * O CORS bate com a URL que o front realmente anuncia?
 *
 * Este é o defeito que impediu o login de funcionar e que nenhuma fase
 * anterior pegou: o servidor estático anunciava `http://127.0.0.1:8080`, o `.env`
 * liberava `http://localhost:8080`, e a API vive em `localhost:4000`. Abrir a
 * página pelo host anunciado produzia 403 "Origem não permitida" em todo fetch,
 * que o navegador mostra como "Failed to fetch" — sem mensagem no servidor,
 * sem erro no terminal, com o painel apenas vazio.
 *
 * A origem que o navegador manda é a URL que apareceu na barra de endereço.
 * Por isso a comparação é feita contra ela.
 *
 * @returns {string|null} problema encontrado, ou null se estiver coerente
 */
function corsProblem(env, { webHost = 'localhost', webPort = 8080 } = {}) {
   const raw = String(env.CORS_ORIGIN || '').trim();
   if (!raw) return 'CORS_ORIGIN vazio: a API vai recusar toda origem do navegador.';

   const permitidas = raw.split(',').map((s) => s.trim()).filter(Boolean);
   const esperada = `http://${webHost}:${webPort}`;
   if (!permitidas.includes(esperada)) {
      return `CORS_ORIGIN não inclui a URL do front (${esperada}). `
         + `Está em: ${permitidas.join(', ')}. Sem isso, todo fetch do navegador `
         + `volta 403 e aparece como "Failed to fetch".`;
   }
   // Avisa o caso inverso também: liberar 127.0.0.1 e announce localhost é
   // inofensivo, mas costuma ser sinal de configuração pela metade.
   const extranhos = permitidas.filter((o) => o !== esperada);
   if (extranhos.length) {
      return `CORS_ORIGIN libera ${extranhos.join(', ')} além de ${esperada}. `
         + `Se a intenção é uma origem só, remova as extras.`;
   }
   return null;
}

function dpoWarning(env) {
  const name = String(env.DPO_NAME || '').trim();
  const email = String(env.DPO_EMAIL || '').trim();
  if (name && email) return null;
  const faltando = [!name && 'DPO_NAME', !email && 'DPO_EMAIL'].filter(Boolean).join(' e ');
  return `${faltando} vazio(s): a página de privacidade mostrará o contato do encarregado como "indisponível no momento"`;
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

// O banco que o POOL usou vem de process.env — dotenv.config() NÃO
// sobrescreve variável já existente. Se a checagem usasse env.DB_NAME (o valor
// do ARQUIVO), o doctor conferiria um banco enquanto o pool falaria em outro,
// sem nunca perceber. Mesma precedência do db-setup.js: ambiente vence .env.
function configAlvo(env) {
  const cfg = (nome, padrao) => process.env[nome] || env[nome] || padrao;
  return {
    DB_NAME: cfg('DB_NAME', 'saude'),
    DB_HOST: cfg('DB_HOST', 'localhost'),
    DB_PORT: cfg('DB_PORT', 3306),
    DB_USER: cfg('DB_USER', 'root'),
  };
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

    // CORS × URL do front. É o que impede o login de funcionar sem nenhum
    // sinal no terminal — o navegador só mostra "Failed to fetch".
    const cors = corsProblem(env, {
      webHost: process.env.WEB_HOST || 'localhost',
      webPort: Number(process.env.WEB_PORT) || 8080,
    });
    if (cors) falha('cors', cors);
    else ok('cors', `origem do front permitida (${env.CORS_ORIGIN})`);
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
      const alvo = configAlvo(env);
      const dbName = alvo.DB_NAME;
      ok('mysql', `${alvo.DB_HOST}:${alvo.DB_PORT} (${alvo.DB_USER})`);

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
  dpoWarning,
  parsePairs,
  main,
  configAlvo,
  corsProblem,
  // Exportado para o teste de paridade (server/test/doctor.test.js): a lista
  // de colunas tem que refletir o que o código referencia, senão o doctor
  // fica verde em uma base quebrada — que é o que ele existe para evitar.
  COLUNAS_ESPERADAS,
  TABELAS_ESPERADAS,
};

if (require.main === module) {
  main().catch((err) => {
    console.error('doctor falhou:', err);
    process.exit(1);
  });
}