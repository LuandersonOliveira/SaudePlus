/* ==========================================================================
   Saúde+ — Sync InfoDengue -> diseases (Fase 2.2)
   Roda: node scripts/sync-alerts.js [--apply]
   Sem --apply: dry-run. Com --apply: cria/atualiza alertas infodengue
   (nunca toca em alertas source='manual' do admin).
   ========================================================================== */
require('dotenv').config();
const mysql = require('mysql2/promise');
const { sync } = require('../src/services/infodengue');

const APPLY = process.argv.includes('--apply');

async function main() {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'saude',
    charset: 'utf8mb4',
    connectionLimit: 2,
  });
  try {
    const { geocode, weeks, plan } = await sync(pool, { apply: APPLY });
    console.log(`InfoDengue ${geocode} (últimas ${weeks} sem com dados):`);
    for (const p of plan) {
      if (p.status === 'sem-dados') console.log(`  - ${p.disease}: sem dados`);
      else console.log(`  ${p.action === 'igual' ? '=' : p.action === 'criar' ? '+' : '~'} ${p.name} -> ${p.level} (${p.description})`);
    }
    console.log(APPLY ? 'Sync aplicado.' : 'Dry-run: nada alterado (use --apply).');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Falha no sync de alertas:', err.message);
  process.exit(1);
});
