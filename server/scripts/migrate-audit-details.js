/* ==========================================================================
   Saúde+ — Migração 005b (idempotente): audit_log.details VARCHAR(255) → TEXT

   Roda: npm run migrate:audit:details  (ou node scripts/migrate-audit-details.js)

   Por que: sanitizeDetails() (server/src/utils/audit.js) aceita até 1000
   caracteres e admin.users.routes.js / admin.professionals.routes.js
   concatenam `reason` sem teto. Com a coluna em VARCHAR(255), uma
   justificativa longa fazia a ação acontecer SEM gravar a auditoria —
   ER_DATA_TOO_LONG era engolido em utils/audit.js e a cadeia de hash ficava
   incompleta sem nenhum sinal.

   Widening é seguro: audit_log é append-only (triggers bloqueiam UPDATE) e
   TEXT aceita tudo que VARCHAR(255) aceitava.
   ========================================================================== */
require('dotenv').config();
const mysql = require('mysql2/promise');

async function columnType(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT DATA_TYPE AS t FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length ? String(rows[0].t).toLowerCase() : null;
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
    const atual = await columnType(conn, 'audit_log', 'details');
    if (!atual) {
      // audit_log ainda não existe (ou a coluna não está criada): nada a fazer
      // aqui — migrate:audit cria a tabela e esta migration roda depois.
      console.log('  - audit_log.details ainda não existe (rode migrate:audit antes)');
      return;
    }
    if (atual === 'text' || atual === 'mediumtext' || atual === 'longtext') {
      console.log(`  - audit_log.details já é ${atual}`);
      return;
    }
    await conn.query('ALTER TABLE audit_log MODIFY COLUMN details TEXT NULL');
    console.log(`  + audit_log.details ${atual} → text`);
    console.log('Migração 005b concluída.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Falha na migração 005b:', err.message);
  process.exit(1);
});