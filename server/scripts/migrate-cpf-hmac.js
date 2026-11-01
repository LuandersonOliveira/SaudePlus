/* ==========================================================================
   Saúde+ — Migração (idempotente): índice cego do CPF (RFC-0001 / ADR-0006,
   achado B3 da Fase 6)

   Roda: npm run migrate:cpf:hmac  (entra no migrate:all, depois de migrate:privacy)

   Por que: `users.cpf` é cifrado com IV aleatório, então o banco não consegue
   garantir "um CPF, uma conta" nem procurar por CPF (o vínculo do Gov.br
   decifrava a tabela inteira). Esta migração:
     1. cria `users.cpf_hmac CHAR(64) NULL`;
     2. preenche (backfill) com HMAC-SHA256(CPF_HMAC_KEY, 11 dígitos);
     3. confere duplicatas — se houver, PARA e lista os ids, sem alterar contas;
     4. cria `UNIQUE KEY uq_users_cpf_hmac (cpf_hmac)`.

   Duplicatas são decisão humana (mesclar contas, corrigir um CPF digitado
   errado…); nada é mesclado nem apagado aqui. Só ids são impressos — nunca o CPF.

   Flags:
     --rehash   recalcula TODOS os cpf_hmac (use após trocar CPF_HMAC_KEY).
                Com o UNIQUE já criado, ele é removido antes e recriado ao fim.

   Idempotente: coluna, preenchimento e índice só agem no que falta.
   ========================================================================== */
require('dotenv').config();
const mysql = require('mysql2/promise');
const { decryptField } = require('../src/utils/crypto');
const { hmacCpf } = require('../src/utils/cpf');

const REHASH = process.argv.includes('--rehash');
const LOTE = 500;
const INDICE = 'uq_users_cpf_hmac';

async function existe(conn, sql, params) {
  const [rows] = await conn.query(sql, params);
  return rows.length > 0;
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
    if (!(await existe(conn, 'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', ['users']))) {
      console.log('  - users ainda não existe (rode migrate:v3 antes)');
      return;
    }

    // ---- 1) coluna ----
    if (await existe(conn, 'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', ['users', 'cpf_hmac'])) {
      console.log('  - users.cpf_hmac já existe');
    } else {
      await conn.query('ALTER TABLE users ADD COLUMN cpf_hmac CHAR(64) NULL AFTER cns');
      console.log('  + users.cpf_hmac criada');
    }

    const temIndice = () =>
      existe(conn, 'SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?', ['users', INDICE]);

    // Recalcular tudo com o UNIQUE de pé falharia na primeira colisão; sai e volta ao fim.
    if (REHASH && (await temIndice())) {
      await conn.query(`ALTER TABLE users DROP INDEX ${INDICE}`);
      console.log(`  ~ ${INDICE} removido para o --rehash (será recriado)`);
    }

    // ---- 2) backfill ----
    const filtro = REHASH ? 'cpf IS NOT NULL' : 'cpf IS NOT NULL AND cpf_hmac IS NULL';
    let ultimo = '';
    let preenchidos = 0;
    const ilegiveis = [];
    const invalidos = [];
    const conflitos = [];
    for (;;) {
      const [lote] = await conn.query(`SELECT id, cpf FROM users WHERE ${filtro} AND id > ? ORDER BY id LIMIT ?`, [ultimo, LOTE]);
      if (!lote.length) break;
      for (const u of lote) {
        ultimo = u.id;
        let claro;
        try {
          claro = decryptField(u.cpf);
        } catch {
          ilegiveis.push(u.id); // chave antiga/corrompida: não dá para indexar
          continue;
        }
        const h = hmacCpf(claro);
        if (!h) {
          invalidos.push(u.id); // não tem 11 dígitos
          continue;
        }
        try {
          await conn.query('UPDATE users SET cpf_hmac = ? WHERE id = ?', [h, u.id]);
          preenchidos += 1;
        } catch (err) {
          if (err.errno === 1062) conflitos.push(u.id);
          else throw err;
        }
      }
    }
    console.log(`  ~ cpf_hmac: ${preenchidos} preenchido(s)`);
    if (ilegiveis.length) console.warn(`  ! ${ilegiveis.length} CPF(s) ilegível(is) (chave de cifra diferente?) ficaram sem índice: ${ilegiveis.slice(0, 10).join(', ')}`);
    if (invalidos.length) console.warn(`  ! ${invalidos.length} CPF(s) sem 11 dígitos ficaram sem índice: ${invalidos.slice(0, 10).join(', ')}`);

    // ---- 3) duplicatas ----
    const [dups] = await conn.query(
      `SELECT GROUP_CONCAT(id ORDER BY created_at SEPARATOR ', ') AS ids, COUNT(*) AS n
         FROM users WHERE cpf_hmac IS NOT NULL GROUP BY cpf_hmac HAVING COUNT(*) > 1`
    );
    if (dups.length || conflitos.length) {
      console.error('CPF duplicado — o UNIQUE NÃO foi criado e nenhuma conta foi alterada:');
      for (const d of dups) console.error(`  ! ${d.n} contas com o mesmo CPF: ${d.ids}`);
      if (conflitos.length) console.error(`  ! sem índice por conflito: ${conflitos.join(', ')}`);
      console.error('Decida caso a caso (mesclar contas, corrigir o CPF digitado errado ou limpar o campo) e rode de novo.');
      process.exitCode = 2;
      return;
    }

    // ---- 4) UNIQUE ----
    if (await temIndice()) {
      console.log(`  - ${INDICE} já existe`);
    } else {
      await conn.query(`ALTER TABLE users ADD UNIQUE KEY ${INDICE} (cpf_hmac)`);
      console.log(`  + ${INDICE} criado`);
    }
    console.log('Migração cpf:hmac concluída.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Falha na migração cpf:hmac:', err.message);
  process.exit(1);
});
