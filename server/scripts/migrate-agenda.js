/* ==========================================================================
   Saúde+ - Migração 011 (idempotente): agenda operacional

   Roda: npm run migrate:agenda  (e entra no migrate:all)

   Adiciona o contrato que a agenda da recepção precisa:
   - `para_remarcar` como status que NÃO ocupa o horário antigo;
   - `outcome` e `reschedule_reason` no próprio registro;
   - `unit_offers.duration_minutes` (NULL = continua usando slot_minutes);
   - índices por utente/profissional/status + data;
   - `booking_events`, histórico operacional append-only.

   Nenhum dado existente é alterado. O MODIFY do ENUM preserva os valores
   antigos e só é executado quando `para_remarcar` ainda não existe.
   ========================================================================== */
require('dotenv').config();
const mysql = require('mysql2/promise');

const BOOKING_TABLES = ['appointments', 'exams'];
const STATUS_ENUM = `ENUM('pendente', 'confirmado', 'cancelado', 'concluido', 'para_remarcar') NOT NULL DEFAULT 'pendente'`;
const CREATE_EVENTS = `CREATE TABLE IF NOT EXISTS booking_events (
  id CHAR(36) NOT NULL PRIMARY KEY,
  kind ENUM('consulta', 'exame') NOT NULL,
  booking_id CHAR(36) NOT NULL,
  event_type ENUM(
    'created',
    'status_changed',
    'rescheduled',
    'professional_deactivated',
    'canceled'
  ) NOT NULL,
  from_scheduled_at DATETIME NULL,
  to_scheduled_at DATETIME NULL,
  from_professional_id CHAR(36) NULL,
  to_professional_id CHAR(36) NULL,
  reason VARCHAR(255) NULL,
  actor_user_id CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_booking_events_booking (kind, booking_id, created_at),
  CONSTRAINT fk_booking_events_actor
    FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB`;

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return Number(rows[0].n) > 0;
}

async function columnInfo(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COLUMN_TYPE AS tipo FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0] || null;
}

async function indexExists(conn, table, index) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, index]
  );
  return Number(rows[0].n) > 0;
}

async function addIndex(conn, table, index, columns) {
  if (await indexExists(conn, table, index)) return;
  await conn.query(`ALTER TABLE ${table} ADD INDEX ${index} (${columns})`);
  console.log(`  + ${table}.${index}`);
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
    if (await tableExists(conn, 'unit_offers')) {
      const duration = await columnInfo(conn, 'unit_offers', 'duration_minutes');
      if (!duration) {
        await conn.query('ALTER TABLE unit_offers ADD COLUMN duration_minutes INT NULL DEFAULT NULL');
        console.log('  + unit_offers.duration_minutes');
      } else {
        console.log('  - unit_offers.duration_minutes já existe');
      }
    } else {
      console.log('  - unit_offers ainda não existe (rode migrate:v3 antes)');
    }

    for (const table of BOOKING_TABLES) {
      if (!(await tableExists(conn, table))) {
        console.log(`  - ${table} ainda não existe (rode migrate:v3 antes)`);
        continue;
      }

      const status = await columnInfo(conn, table, 'status');
      if (status && !String(status.tipo).includes('para_remarcar')) {
        await conn.query(`ALTER TABLE ${table} MODIFY COLUMN status ${STATUS_ENUM}`);
        console.log(`  + ${table}.status aceita para_remarcar`);
      } else {
        console.log(`  - ${table}.status já está atualizado`);
      }

      for (const [column, ddl] of [
        ['outcome', 'VARCHAR(40) NULL DEFAULT NULL'],
        ['reschedule_reason', 'VARCHAR(255) NULL DEFAULT NULL'],
      ]) {
        if (await columnInfo(conn, table, column)) {
          console.log(`  - ${table}.${column} já existe`);
        } else {
          await conn.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
          console.log(`  + ${table}.${column}`);
        }
      }

      await addIndex(conn, table, `idx_${table}_user_scheduled`, 'user_id, scheduled_at');
      await addIndex(conn, table, `idx_${table}_prof_scheduled`, 'professional_id, scheduled_at');
      await addIndex(conn, table, `idx_${table}_status_scheduled`, 'status, scheduled_at');
    }

    if (await tableExists(conn, 'booking_events')) {
      console.log('  - booking_events já existe');
    } else {
      await conn.query(CREATE_EVENTS);
      console.log('  + booking_events criada');
    }

    console.log('Migração 011 concluída.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Falha na migração 011:', err.message);
  process.exit(1);
});
