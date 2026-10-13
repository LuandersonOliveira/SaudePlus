/* ==========================================================================
   Saúde+ — Retenção/expurgo LGPD (Fase 1)
   Roda: node scripts/purge-retention.js [--apply]

   Sem --apply: só LISTA candidatos (dry-run). Com --apply: anonimiza.
   - Contas `paciente` ativas sem login há mais de RETENTION_INACTIVE_YEARS
     (default 5) => anonymizeUser (perfil apagado, histórico vira estatística).
   - Refresh tokens expirados/revogados há +90 dias => DELETE físico.
   Ver tabela de temporalidade em docs/ROPA.md.
   ========================================================================== */
require('dotenv').config();
const mysql = require('mysql2/promise');
const { anonymizeUser } = require('../src/utils/privacy');

const APPLY = process.argv.includes('--apply');
const YEARS = Math.max(1, Number(process.env.RETENTION_INACTIVE_YEARS) || 5);

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
    const [candidates] = await pool.query(
      `SELECT id, email, created_at, last_login_at FROM users
       WHERE role = 'paciente' AND account_status = 'ativo' AND deleted_at IS NULL
       AND (last_login_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? YEAR)
            OR (last_login_at IS NULL AND created_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? YEAR)))`,
      [YEARS, YEARS]
    );
    console.log(`Inativas há +${YEARS} anos: ${candidates.length} conta(s)${APPLY ? '' : ' (dry-run — use --apply para executar)'}`);

    if (APPLY) {
      for (const c of candidates) {
        await anonymizeUser(pool, c.id, { reason: `retenção: inativa há +${YEARS} anos` });
        console.log(`  ~ anonimizada ${c.id}`);
      }
      const [tokens] = await pool.query(
        `DELETE FROM refresh_tokens
         WHERE (revoked = 1 OR expires_at < CURRENT_TIMESTAMP)
         AND created_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 90 DAY)`
      );
      console.log(`  ~ ${tokens.affectedRows} refresh token(s) antigo(s) removido(s)`);
    }
    console.log(APPLY ? 'Expurgo concluído.' : 'Nada alterado (dry-run).');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Falha no expurgo:', err.message);
  process.exit(1);
});
