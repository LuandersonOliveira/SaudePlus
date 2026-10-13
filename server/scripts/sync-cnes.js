/* ==========================================================================
   Saúde+ — Sync CNES -> health_units (Fase 2.1)
   Roda: node scripts/sync-cnes.js [--apply]
   Sem --apply: dry-run (só relata o que mudaria). Com --apply: grava.
   ========================================================================== */
require('dotenv').config();
const mysql = require('mysql2/promise');
const { sync } = require('../src/services/cnes');

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
    const plan = await sync(pool, { apply: APPLY });
    console.log(`CNES ${plan.municipio}: ${plan.fetched} lidos, ${plan.skipped} fora do escopo (privado/inativo)`);
    console.log(`  inserir: ${plan.insert.length} | atualizar: ${plan.update.length} | iguais: ${plan.unchanged.length}`);
    for (const u of plan.insert) console.log(`  + [${u.type}] ${u.name} (CNES ${u.cnesCode})`);
    for (const { unit } of plan.update) console.log(`  ~ [${unit.type}] ${unit.name} (CNES ${unit.cnesCode})`);
    console.log(APPLY ? 'Sync aplicado.' : 'Dry-run: nada alterado (use --apply).');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Falha no sync CNES:', err.message);
  process.exit(1);
});
