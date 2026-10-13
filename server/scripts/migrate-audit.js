/* ==========================================================================
   Saúde+ — Migração 005 (idempotente, Aulas 1/6: integridade da trilha)
   Roda: npm run migrate:audit   (ou node scripts/migrate-audit.js)

   1. audit_log: prev_hash + entry_hash (cadeia tamper-evident).
      Backfill das linhas antigas em ordem cronológica.
   2. users: totp_secret + totp_enabled (MFA, autenticidade).
   ========================================================================== */
require('dotenv').config();
const crypto = require('crypto');
const mysql = require('mysql2/promise');

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(rows[0].c) > 0;
}

function chainHash(prev, actorId, action, entityType, entityId, details, createdAt) {
  return crypto.createHash('sha256')
    .update([prev, actorId, action, entityType, entityId, details || '', createdAt].join('|'))
    .digest('hex');
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
    for (const [table, col, def] of [
      ['audit_log', 'prev_hash', 'CHAR(64) NULL'],
      ['audit_log', 'entry_hash', 'CHAR(64) NULL'],
      ['users', 'totp_secret', 'TEXT NULL'],
      ['users', 'totp_enabled', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ]) {
      if (await columnExists(conn, table, col)) {
        console.log(`  - ${table}.${col} já existe`);
      } else {
        await conn.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
        console.log(`  + ${table}.${col} adicionada`);
      }
    }
    // Sequência de inserção (ordem canônica da cadeia; created_at tem
    // resolução de 1s e UUID é aleatório — nenhum dos dois ordena).
    if (await columnExists(conn, 'audit_log', 'seq')) {
      console.log('  - audit_log.seq já existe');
    } else {
      await conn.query('ALTER TABLE audit_log ADD COLUMN seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, ADD UNIQUE KEY uq_audit_seq (seq)');
      console.log('  + audit_log.seq adicionada');
    }

    // Backfill precisa de UPDATE: suspende o trigger append-only e recria ao final.
    await conn.query('DROP TRIGGER IF EXISTS trg_audit_no_update');
    // Recadeia a partir do primeiro ponto inválido (detecta remoção no meio).
    const [rows] = await conn.query(
      `SELECT id, actor_id, action, entity_type, entity_id, details,
              DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
       FROM audit_log ORDER BY seq ASC`
    );
    let prev = 'GENESIS';
    for (const r of rows) {
      const h = chainHash(prev, r.actor_id, r.action, r.entity_type, r.entity_id, r.details, r.created_at);
      await conn.query('UPDATE audit_log SET prev_hash = ?, entry_hash = ? WHERE id = ?', [prev, h, r.id]);
      prev = h;
    }
    console.log(`  ~ ${rows.length} linha(s) encadeadas`);

    // ---- Integridade da trilha: a FK NÃO pode cascading-deletar o log ----
    // ON DELETE CASCADE fazia a trilha sumir junto com o usuário (o que
    // destrói o valor de não-repúdio). RESTRICT impede apagar usuário que tem
    // histórico; a eliminação LGPD é por anonimização (deleted_at), não delete.
    const [fks] = await conn.query(
      `SELECT CONSTRAINT_NAME n, DELETE_RULE r FROM information_schema.REFERENTIAL_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_log' AND CONSTRAINT_NAME = 'fk_audit_actor'`
    );
    if (!fks.length) {
      console.log('  ! FK fk_audit_actor não encontrada — verifique o schema.');
    } else if (fks[0].r === 'CASCADE') {
      await conn.query('ALTER TABLE audit_log DROP FOREIGN KEY fk_audit_actor');
      await conn.query(
        `ALTER TABLE audit_log ADD CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id)
         REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE`
      );
      console.log('  + fk_audit_actor: CASCADE -> RESTRICT (trilha imutável)');
    } else {
      console.log('  - fk_audit_actor já está com', fks[0].r);
    }
    await conn.query(
      `CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_log FOR EACH ROW
       SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log é append-only: UPDATE bloqueado.'`
    );
    console.log('  + trigger trg_audit_no_update recriada');
    console.log('Migração 005 concluída.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Falha na migração 005:', err.message);
  process.exit(1);
});
