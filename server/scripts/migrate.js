/* ==========================================================================
   Saúde+ — runner de migrations numeradas (ADR-0008 / A3).

   Uso:
     npm run db:migrate                aplica as migrations pendentes, em ordem
     npm --prefix server run migrate:status   lista aplicadas e pendentes

   O QUE É MIGRATION AQUI
   O `schema.sql` é o estado atual da ESTRUTURA (instalação limpa). Migration é
   para mudar um banco que já existe: dado a transformar, índice único a criar
   depois de conferir duplicatas, etc. Cada arquivo de `server/migrations/`
   (`NNNN_descricao.js`) é um script independente e idempotente; o runner roda
   um a um, em ordem numérica, e grava o resultado em `schema_migrations`.

   - Só entra em `schema_migrations` o que terminou com exit 0. Um script que
     PARA de propósito (ex.: 0002 com CPF duplicado, exit 2) fica pendente e o
     runner interrompe: as seguintes dependem das anteriores.
   - O checksum guarda o conteúdo aplicado; se um arquivo já aplicado for
     editado, o runner AVISA (não reaplica): mudança nova = migration nova.
   - Mudou a estrutura? Atualize o schema.sql E crie uma migration que leve um
     banco existente até lá (o teste schema-parity cobre o lado do schema).

   BANCOS ANTERIORES AO BASELINE: as migrations assumem o schema.sql atual.
   Um banco criado por versões antigas (antes da Fase 6) deve ser recriado
   (backup → `npm run db:setup -- --fresh <banco>` → restaurar os dados).
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const SERVER_DIR = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(SERVER_DIR, 'migrations');
const NOME_VALIDO = /^(\d{4})_([a-z0-9_]+)\.js$/;

/** Arquivos de migration, em ordem numérica; falha se houver número repetido ou nome fora do padrão. */
function listarMigrations(dir = MIGRATIONS_DIR) {
  const arquivos = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort() : [];
  const vistos = new Map();
  return arquivos.map((file) => {
    const m = NOME_VALIDO.exec(file);
    if (!m) throw new Error(`migrations/${file}: nome fora do padrão NNNN_descricao.js`);
    if (vistos.has(m[1])) throw new Error(`migrations: número ${m[1]} repetido (${vistos.get(m[1])} e ${file})`);
    vistos.set(m[1], file);
    const conteudo = fs.readFileSync(path.join(dir, file));
    return { version: m[1], name: m[2], file, checksum: crypto.createHash('sha256').update(conteudo).digest('hex') };
  });
}

async function conectar() {
  require(require.resolve('dotenv', { paths: [SERVER_DIR] })).config({ path: path.join(SERVER_DIR, '.env') });
  const mysql = require(require.resolve('mysql2/promise', { paths: [SERVER_DIR] }));
  return mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'saude',
    charset: 'utf8mb4',
  });
}

async function garantirTabela(conn) {
  await conn.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version CHAR(4) NOT NULL PRIMARY KEY,
       name VARCHAR(120) NOT NULL,
       checksum CHAR(64) NOT NULL,
       applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     ) ENGINE = InnoDB`
  );
}

/**
 * Aplica as pendentes. Devolve { aplicadas, jaAplicadas, alteradas } e lança se alguma falhar.
 * @param {object} [opts] { dir, silencioso }
 */
async function migrar(conn, { dir = MIGRATIONS_DIR, log = console.log } = {}) {
  await garantirTabela(conn);
  const [feitas] = await conn.query('SELECT version, checksum FROM schema_migrations');
  const mapa = new Map(feitas.map((r) => [r.version, r.checksum]));
  const aplicadas = [];
  const alteradas = [];
  let jaAplicadas = 0;

  for (const m of listarMigrations(dir)) {
    if (mapa.has(m.version)) {
      jaAplicadas += 1;
      if (mapa.get(m.version) !== m.checksum) {
        alteradas.push(m.file);
        log(`  ! ${m.file} foi editada depois de aplicada (não será reaplicada; crie uma migration nova)`);
      }
      continue;
    }
    log(`Aplicando ${m.file}…`);
    const res = spawnSync(process.execPath, [path.join(dir, m.file)], {
      cwd: SERVER_DIR,
      stdio: 'inherit',
      env: process.env,
    });
    if (res.status !== 0) {
      throw new Error(`migration ${m.file} falhou (exit ${res.status}); as seguintes não foram executadas`);
    }
    await conn.query('INSERT INTO schema_migrations (version, name, checksum) VALUES (?,?,?)', [m.version, m.name, m.checksum]);
    aplicadas.push(m.file);
  }
  return { aplicadas, jaAplicadas, alteradas };
}

async function status(conn, { dir = MIGRATIONS_DIR } = {}) {
  await garantirTabela(conn);
  const [feitas] = await conn.query('SELECT version, applied_at FROM schema_migrations');
  const quando = new Map(feitas.map((r) => [r.version, r.applied_at]));
  return listarMigrations(dir).map((m) => ({ ...m, aplicada: quando.has(m.version), applied_at: quando.get(m.version) || null }));
}

async function main() {
  const conn = await conectar();
  try {
    if (process.argv.includes('--status')) {
      for (const s of await status(conn)) console.log(`${s.aplicada ? '[x]' : '[ ]'} ${s.file}${s.aplicada ? `  (${s.applied_at})` : ''}`);
      return;
    }
    const r = await migrar(conn);
    console.log(r.aplicadas.length
      ? `Migrations aplicadas: ${r.aplicadas.length} (${r.jaAplicadas} já estavam em dia).`
      : `Nada a aplicar: ${r.jaAplicadas} migration(s) em dia.`);
  } finally {
    await conn.end();
  }
}

module.exports = { listarMigrations, migrar, status, garantirTabela, MIGRATIONS_DIR };

if (require.main === module) {
  main().catch((err) => {
    console.error('Falha ao migrar:', err.message);
    process.exit(1);
  });
}
