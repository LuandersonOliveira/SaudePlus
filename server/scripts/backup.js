/* ==========================================================================
   Saúde+ — Backup do banco (Aulas 1/6: disponibilidade + controle corretivo)
   Roda: node scripts/backup.js [--dir=./backups] [--keep=7]

   mysqldump --single-transaction (consistente, sem travar) -> .sql ->
   gzip -> SHA-256 no manifesto. Mantém os últimos --keep arquivos.
   Agende no Windows (Agendador de Tarefas) ou cron: 1x ao dia.
   Restauração: mysql < backup-AAAA-MM-DD.sql  (descompacte antes).
   ========================================================================== */
require('dotenv').config();
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : def;
}

async function main() {
  const dir = path.resolve(arg('dir', path.join(__dirname, '..', 'backups')));
  const keep = Math.max(1, Number(arg('keep', '7')) || 7);
  fs.mkdirSync(dir, { recursive: true });

  const stamp = new Date().toISOString().slice(0, 10);
  const sqlPath = path.join(dir, `saude-${stamp}.sql`);
  const gzPath = `${sqlPath}.gz`;

  const dump = spawnSync('mysqldump', [
    `--host=${process.env.DB_HOST || 'localhost'}`,
    `--port=${process.env.DB_PORT || 3306}`,
    `--user=${process.env.DB_USER || 'root'}`,
    `--password=${process.env.DB_PASSWORD || ''}`,
    '--single-transaction', '--routines', '--triggers',
    process.env.DB_NAME || 'saude',
  ], { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 });
  if (dump.status !== 0) {
    throw new Error('mysqldump falhou: ' + (dump.stderr || '').toString().slice(0, 300));
  }
  fs.writeFileSync(sqlPath, dump.stdout);
  fs.writeFileSync(gzPath, zlib.gzipSync(dump.stdout, { level: 9 }));
  fs.unlinkSync(sqlPath);

  const sha = crypto.createHash('sha256').update(fs.readFileSync(gzPath)).digest('hex');
  const manifest = { file: path.basename(gzPath), sha256: sha, bytes: fs.statSync(gzPath).size, at: new Date().toISOString() };
  fs.writeFileSync(`${gzPath}.sha256.json`, JSON.stringify(manifest, null, 2));

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql.gz')).sort();
  while (files.length > keep) {
    const old = files.shift();
    fs.unlinkSync(path.join(dir, old));
    try { fs.unlinkSync(path.join(dir, `${old}.sha256.json`)); } catch { /* sem manifesto */ }
    console.log(`  - removido ${old} (retenção: ${keep})`);
  }
  console.log(`Backup OK: ${manifest.file} (${manifest.bytes} bytes, sha256 ${sha.slice(0, 16)}…)`);
}

main().catch((err) => {
  console.error('Falha no backup:', err.message);
  process.exit(1);
});
