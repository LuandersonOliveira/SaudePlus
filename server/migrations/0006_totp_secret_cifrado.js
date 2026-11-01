/* ==========================================================================
   Saúde+ — Migração 0006 (idempotente): segredo do MFA cifrado em repouso

   O segredo TOTP (a "semente" do segundo fator) era gravado em texto puro. Quem lesse um
   dump do banco gerava os códigos de qualquer usuário com MFA — e o segundo fator deixa
   de valer. Agora o segredo é cifrado como CPF/RG/CNS (AES-256-GCM, DATA_ENCRYPTION_KEY).

   - Cifra os segredos existentes que ainda estão em texto puro (roda depois da 0003, que
     recodifica para base32 — a ordem importa: cifrar antes confundiria a conversão).
   - Sem DATA_ENCRYPTION_KEY válida e COM segredo a cifrar, FALHA (exit 1) e não registra:
     "pular com aviso" deixaria a migration marcada como aplicada com os segredos ainda
     em claro. Sem nenhum segredo, não precisa de chave.
   - O servidor lê os dois formatos (cifrado e legado), então a ordem de deploy não derruba
     ninguém. Idempotente: valor já cifrado é pulado. Não imprime segredos.
   ========================================================================== */
require('dotenv').config();
const mysql = require('mysql2/promise');
const { encryptField, isEncrypted } = require('../src/utils/crypto');

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
    const pendentes = rows.filter((u) => !isEncrypted(u.totp_secret));
    console.log(`  ~ totp_secret: ${pendentes.length} em texto puro, ${rows.length - pendentes.length} já cifrado(s)`);

    if (pendentes.length && !/^[0-9a-fA-F]{64}$/.test((process.env.DATA_ENCRYPTION_KEY || '').trim())) {
      console.error('DATA_ENCRYPTION_KEY ausente ou inválida: não dá para cifrar os segredos do MFA.');
      console.error('Configure a chave (64 hex) e rode de novo; nada foi alterado.');
      process.exitCode = 1;
      return;
    }
    let cifrados = 0;
    for (const u of pendentes) {
      // O WHERE com o valor antigo evita atropelar quem regenerou o segredo durante a migração.
      const [r] = await conn.query('UPDATE users SET totp_secret = ? WHERE id = ? AND totp_secret = ?', [encryptField(u.totp_secret), u.id, u.totp_secret]);
      cifrados += r.affectedRows;
    }
    console.log(`  + ${cifrados} segredo(s) cifrado(s)`);
    console.log('Migração 0006 concluída.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Falha na migração 0006:', err.message);
  process.exit(1);
});
