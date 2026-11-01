/* ==========================================================================
   Saúde+ — Migração 010 (idempotente): lista de espera (NV03)

   Roda: npm run migrate:waitlist  (ou entra no migrate:all)

   A tabela guarda a intenção do paciente ("me avise quando abrir vaga para
   este serviço") sem exigir data. Quando um agendamento é cancelado, o
   serviço de lista de espera tenta converter a primeira pessoa elegível no
   horário liberado — prioridade legal primeiro, depois ordem de chegada.

   `unit_id` e `professional_id` nulos são curinga: a pessoa aceita vaga em
   qualquer unidade/profissional daquele serviço.
   ========================================================================== */
require('dotenv').config();
const mysql = require('mysql2/promise');

const TABELA = 'waitlist';
const CREATE = `CREATE TABLE IF NOT EXISTS ${TABELA} (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  kind ENUM('consulta', 'exame') NOT NULL,
  service_name VARCHAR(120) NOT NULL,
  unit_id CHAR(36) NULL,
  professional_id CHAR(36) NULL,
  status ENUM('aguardando', 'convertido', 'cancelado') NOT NULL DEFAULT 'aguardando',
  record_id CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fulfilled_at DATETIME NULL DEFAULT NULL,
  CONSTRAINT fk_waitlist_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  INDEX idx_waitlist_user (user_id),
  INDEX idx_waitlist_queue (kind, service_name, status, created_at)
) ENGINE = InnoDB`;

async function existe(conn) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [TABELA]
  );
  return Number(rows[0].n) > 0;
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
    if (await existe(conn)) {
      console.log(`  - ${TABELA} já existe`);
    } else {
      await conn.query(CREATE);
      console.log(`  + ${TABELA} criada`);
    }
    console.log('Migração 010 concluída.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Falha na migração 010:', err.message);
  process.exit(1);
});
