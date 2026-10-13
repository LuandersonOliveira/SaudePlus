/* ==========================================================================
   Saúde+ — Migração 003 (idempotente, Fase 1 LGPD)
   Roda: npm run migrate:privacy   (ou node scripts/migrate-privacy.js)

   1. Colunas de consentimento em users: privacy_version, consent_at,
      consent_ip + deleted_at (marca anonimização/eliminação LGPD).
   2. cpf/rg/cns: VARCHAR -> TEXT (cabe o payload AES-256-GCM).
   3. Higiene: CPFs com máscara ('529.982.247-25') viram só dígitos.
   4. Cifra documentos legados em texto puro (exige DATA_ENCRYPTION_KEY).

   Seguro para rodar mais de uma vez.
   ========================================================================== */
require('dotenv').config();
const mysql = require('mysql2/promise');
const { encryptField, isEncrypted } = require('../src/utils/crypto');

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(rows[0].c) > 0;
}

async function columnType(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length ? rows[0].t : null;
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
    console.log('1) Colunas de consentimento...');
    const adds = [
      ['privacy_version', 'VARCHAR(20) NULL'],
      ['consent_at', 'DATETIME NULL'],
      ['consent_ip', 'VARCHAR(45) NULL'],
      ['deleted_at', 'DATETIME NULL'],
    ];
    for (const [col, def] of adds) {
      if (await columnExists(conn, 'users', col)) {
        console.log(`  - users.${col} já existe`);
      } else {
        await conn.query(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
        console.log(`  + users.${col} adicionada`);
      }
    }

    console.log('2) cpf/rg/cns -> TEXT...');
    for (const col of ['cpf', 'rg', 'cns']) {
      const type = await columnType(conn, 'users', col);
      if (type && type.toLowerCase() !== 'text') {
        await conn.query(`ALTER TABLE users MODIFY COLUMN ${col} TEXT NULL`);
        console.log(`  + users.${col} convertida (${type} -> TEXT)`);
      } else {
        console.log(`  - users.${col} já é TEXT`);
      }
    }

    console.log('3) Normaliza CPFs com máscara para só dígitos...');
    const [norm] = await conn.query(
      `UPDATE users SET cpf = REPLACE(REPLACE(REPLACE(TRIM(cpf), '.', ''), '-', ''), '/', '')
       WHERE cpf IS NOT NULL AND cpf NOT LIKE 'enc:v1:%'
       AND (cpf LIKE '%.%' OR cpf LIKE '%-%' OR cpf LIKE '% %' OR cpf LIKE '%/%')`
    );
    console.log(`  ~ ${norm.affectedRows} CPF(s) normalizado(s)`);

    console.log('4) Cifra documentos legados...');
    if (!/^[0-9a-fA-F]{64}$/.test((process.env.DATA_ENCRYPTION_KEY || '').trim())) {
      console.log('  ! DATA_ENCRYPTION_KEY ausente — etapa 4 pulada (rode de novo após configurar).');
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

    console.log('Migração 003 concluída.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Falha na migração 003:', err.message);
  process.exit(1);
});
