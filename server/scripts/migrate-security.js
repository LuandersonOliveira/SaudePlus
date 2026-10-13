/* ==========================================================================
   Saúde+ — Migração 002 (idempotente, Fase 0)
   Roda: npm run migrate:security   (ou node scripts/migrate-security.js)

   1. Tabela refresh_tokens (rotação de refresh, guarda só o hash).
   2. Triggers append-only em audit_log (bloqueiam UPDATE/DELETE).

   Seguro para rodar mais de uma vez.
   ========================================================================== */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return Number(rows[0].c) > 0;
}

async function triggerExists(conn, name) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = ?`,
    [name]
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
    multipleStatements: true,
  });

  try {
    if (!(await tableExists(conn, 'refresh_tokens'))) {
      console.log('Criando tabela refresh_tokens...');
      const sql = fs.readFileSync(
        path.join(__dirname, '..', 'migration_002_security.sql'),
        'utf8'
      );
      // Extrai só o CREATE TABLE (triggers vão por separado p/ checagem fina).
      const createTable = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS refresh_tokens'));
      await conn.query(createTable.slice(0, createTable.indexOf('ENGINE = InnoDB;') + 'ENGINE = InnoDB;'.length));
      console.log('  + refresh_tokens criada');
    } else {
      console.log('  - refresh_tokens já existe');
    }

    for (const [name, timing, event] of [
      ['trg_audit_no_update', 'BEFORE UPDATE', 'UPDATE'],
      ['trg_audit_no_delete', 'BEFORE DELETE', 'DELETE'],
    ]) {
      if (await triggerExists(conn, name)) {
        console.log(`  - ${name} já existe`);
        continue;
      }
      await conn.query(`DROP TRIGGER IF EXISTS ${name}`);
      await conn.query(
        `CREATE TRIGGER ${name} ${timing} ON audit_log FOR EACH ROW ` +
        `SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log é append-only: ${event} bloqueado.'`
      );
      console.log(`  + ${name} criada`);
    }

    console.log('Migração 002 concluída.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Falha na migração 002:', err.message);
  process.exit(1);
});
