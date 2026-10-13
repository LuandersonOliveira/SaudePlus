/* ==========================================================================
   Saúde+ — Migração 004 (idempotente, Fase 2 interop)
   Roda: npm run migrate:interop   (ou node scripts/migrate-interop.js)

   1. health_units: cnes_code (id do CNES p/ sync), phone, address.
   2. users: govbr_sub (vínculo Login Único, Fase 2.3).
   3. diseases: source (manual | infodengue | sinan) + external_ref.
   ========================================================================== */
require('dotenv').config();
const mysql = require('mysql2/promise');

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(rows[0].c) > 0;
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'saude',
    charset: 'utf8mb4',
  });
  try {
    const adds = [
      ['health_units', 'cnes_code', 'VARCHAR(10) NULL'],
      ['health_units', 'phone', 'VARCHAR(30) NULL'],
      ['health_units', 'address', 'VARCHAR(255) NULL'],
      ['users', 'govbr_sub', 'VARCHAR(64) NULL'],
      ['diseases', 'source', "VARCHAR(20) NOT NULL DEFAULT 'manual'"],
      ['diseases', 'external_ref', 'VARCHAR(120) NULL'],
    ];
    for (const [table, col, def] of adds) {
      if (await columnExists(conn, table, col)) {
        console.log(`  - ${table}.${col} já existe`);
      } else {
        await conn.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
        console.log(`  + ${table}.${col} adicionada`);
      }
    }
    const [idx] = await conn.query(
      `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'health_units' AND INDEX_NAME = 'uq_health_units_cnes'`
    );
    if (Number(idx[0].c) === 0) {
      await conn.query('CREATE UNIQUE INDEX uq_health_units_cnes ON health_units (cnes_code)');
      console.log('  + índice uq_health_units_cnes');
    } else {
      console.log('  - índice uq_health_units_cnes já existe');
    }
    console.log('Migração 004 concluída.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Falha na migração 004:', err.message);
  process.exit(1);
});
