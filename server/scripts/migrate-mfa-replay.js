/* ==========================================================================
   Saúde+ — Migração 006 (idempotente): users.totp_last_step

   Roda: npm run migrate:mfa:replay  (ou entra no migrate:all)

   Por que: `/auth/mfa/verify` aceitava o MESMO código TOTP quantas vezes
   quisesse dentro da janela de tolerância (±1 passo = 90s). Um código
   capturado — do app autenticador, de uma foto, de um log — abria sessão nova
   enquanto ainda valia, e o segundo fator deixava de proteger exatamente
   aquilo para que existe.

   Guardar o último passo aceito resolve na raiz: o código só é válido se o
   passo for estritamente maior que o anterior (RFC 6238 §5.2). Um BIGINT
   comporta o contador de passos (1 por 30s ≈ 5.800 anos) e sobrevive a
   `dateStrings: true`, que é por isso que a coluna é numérica e não um
   datetime: um passo TOTP não é um instante, é um contador.

   NULL = nunca usou MFA (não bloqueia nada). Idempotente.
   ========================================================================== */
require('dotenv').config();
const mysql = require('mysql2/promise');

async function existeColuna(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
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
    if (!(await existeColuna(conn, 'users', 'id'))) {
      console.log('  - tabela users ainda não existe (rode migrate:v3 antes)');
      return;
    }
    if (await existeColuna(conn, 'users', 'totp_last_step')) {
      console.log('  - users.totp_last_step já existe');
      return;
    }
    await conn.query('ALTER TABLE users ADD COLUMN totp_last_step BIGINT NULL DEFAULT NULL');
    console.log('  + users.totp_last_step criado (proteção contra replay de TOTP)');
    console.log('Migração 006 concluída.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Falha na migração 006:', err.message);
  process.exit(1);
});