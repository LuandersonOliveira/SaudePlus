/* ==========================================================================
   Saúde+ — Migração (idempotente): segredo do MFA em base32

   Roda: npm run db:migrate  (migration 0003)

   Por que: o segredo TOTP era gravado em base64url, que Google/Microsoft
   Authenticator não aceitam (só base32). Esta migração recodifica os segredos
   já gravados. Os BYTES da chave são os mesmos, então os códigos gerados não
   mudam: quem já tinha o segundo fator ativo segue entrando normalmente, e
   passa a poder cadastrar o segredo em app de verdade.

   O servidor aceita os dois formatos até esta migração rodar, então a ordem
   (código novo antes/depois da migração) não derruba ninguém.

   Idempotente: segredo já em base32 é pulado. Não imprime segredos.
   ========================================================================== */
require('dotenv').config();
const mysql = require('mysql2/promise');
const { ehBase32, legacyToBase32 } = require('../src/utils/totp');

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
    const [[tem]] = await conn.query(
      "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'totp_secret'"
    );
    if (!Number(tem.n)) {
      console.log('  - users.totp_secret ainda não existe (banco fora do baseline: recrie com db:setup --fresh)');
      return;
    }
    const [rows] = await conn.query('SELECT id, totp_secret FROM users WHERE totp_secret IS NOT NULL');
    let convertidos = 0;
    let jaBase32 = 0;
    const invalidos = [];
    for (const u of rows) {
      if (ehBase32(u.totp_secret)) {
        jaBase32 += 1;
        continue;
      }
      let novo;
      try {
        novo = legacyToBase32(u.totp_secret);
      } catch {
        invalidos.push(u.id);
        continue;
      }
      // O WHERE com o valor antigo evita atropelar quem regenerou o segredo durante a migração.
      const [r] = await conn.query('UPDATE users SET totp_secret = ? WHERE id = ? AND totp_secret = ?', [novo, u.id, u.totp_secret]);
      convertidos += r.affectedRows;
    }
    console.log(`  ~ totp_secret: ${convertidos} convertido(s), ${jaBase32} já em base32`);
    if (invalidos.length) console.warn(`  ! ${invalidos.length} segredo(s) ilegível(is) ficaram como estão: ${invalidos.slice(0, 10).join(', ')}`);
    console.log('Migração mfa:base32 concluída.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Falha na migração mfa:base32:', err.message);
  process.exit(1);
});
