/* ==========================================================================
   Saúde+ — Migração 009 (idempotente): recuperação de senha

   Roda: npm run migrate:password:reset  (ou entra no migrate:all)

   Por que: quem esquecia a senha perdia a conta. O caminho seguro não é
   gerar token novo a cada pedido e confiar na memória — é uma tabela.

   Mesmo desenho do `refresh_tokens`: só o SHA-256 do token vai para o banco.
   Um dump da base não permite forjar um link de redefinição.

   `used_at` é o que torna o link de uso único. Sem ele o link continua
   valendo para sempre, e um e-mail interceptado no caminho continua dando
   acesso à conta meses depois.

   ON DELETE CASCADE porque o token pertence à conta: se o titular pedir
   anonimização (LGPD), um token vivo permitiria redefinir a senha de alguém
   que já não existe.
   ========================================================================== */
require('dotenv').config();
const mysql = require('mysql2/promise');

const TABELA = 'password_reset_tokens';
const CREATE = `CREATE TABLE IF NOT EXISTS ${TABELA} (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_password_reset_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  INDEX idx_password_reset_hash (token_hash),
  INDEX idx_password_reset_user (user_id)
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
    console.log('Migração 009 concluída.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Falha na migração 009:', err.message);
  process.exit(1);
});