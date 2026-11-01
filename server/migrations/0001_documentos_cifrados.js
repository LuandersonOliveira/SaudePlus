/* ==========================================================================
   Saúde+ — Migração 0001 (idempotente): documentos legados → cifrados

   A estrutura (colunas de consentimento, cpf/rg/cns em TEXT) já vem do
   schema.sql. Esta migração cuida só do DADO de bancos antigos:
     1. CPFs com máscara ('529.982.247-25') viram só dígitos;
     2. cpf/rg/cns em texto puro são cifrados com AES-256-GCM
        (exige DATA_ENCRYPTION_KEY; sem ela a etapa é pulada com aviso).

   Em banco novo não há nada a fazer e ela termina em instantes.
   Roda antes da 0002 (cpf_hmac), que precisa do CPF normalizado.
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
    console.log('1) Normaliza CPFs com máscara para só dígitos...');
    const [norm] = await conn.query(
      `UPDATE users SET cpf = REPLACE(REPLACE(REPLACE(TRIM(cpf), '.', ''), '-', ''), '/', '')
       WHERE cpf IS NOT NULL AND cpf NOT LIKE 'enc:v1:%'
       AND (cpf LIKE '%.%' OR cpf LIKE '%-%' OR cpf LIKE '% %' OR cpf LIKE '%/%')`
    );
    console.log(`  ~ ${norm.affectedRows} CPF(s) normalizado(s)`);

    console.log('2) Cifra documentos legados...');
    if (!/^[0-9a-fA-F]{64}$/.test((process.env.DATA_ENCRYPTION_KEY || '').trim())) {
      console.log('  ! DATA_ENCRYPTION_KEY ausente — etapa pulada (rode de novo após configurar).');
    } else {
      const [rows] = await conn.query('SELECT id, cpf, rg, cns FROM users');
      let n = 0;
      for (const row of rows) {
        const updates = [];
        const params = [];
        for (const col of ['cpf', 'rg', 'cns']) {
          const val = row[col];
          if (val !== null && val !== '' && !isEncrypted(String(val))) {
            updates.push(`${col} = ?`);
            params.push(encryptField(String(val).trim()));
          }
        }
        if (updates.length) {
          params.push(row.id);
          await conn.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
          n++;
        }
      }
      console.log(`  + ${n} usuário(s) com documentos cifrados`);
    }

    console.log('Migração 0001 concluída.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Falha na migração 0001:', err.message);
  process.exit(1);
});
