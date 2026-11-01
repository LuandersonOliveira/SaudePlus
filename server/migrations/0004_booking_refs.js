/* ==========================================================================
   Saúde+ — Migração (idempotente): integridade de unidade e profissional
   nos agendamentos (RFC-0001 / ADR-0007, achado B1 da Fase 6)

   Roda: npm run db:migrate  (migration 0004; a estrutura equivalente já vem do schema.sql)

   Por que: `appointments` e `exams` guardavam `unit_id` e `professional_id`
   sem chave estrangeira — qualquer texto entrava, e não havia índice em
   `unit_id`. Esta migração:
     1. confere se existem órfãos (id que não aponta para nada);
     2. cria o índice (unit_id, scheduled_at);
     3. cria as FKs com ON DELETE SET NULL (apagar a unidade/profissional
        preserva o atendimento; `location`/`doctor` continuam como "foto").

   Órfãos: por padrão a migração PARA e lista os registros — zerar o vínculo
   é uma alteração de dado e fica a critério de quem opera. Com
   `--fix-orphans` ela os zera (UPDATE … SET col = NULL) e segue.

   Idempotente: índice e FK só são criados se ainda não existirem.
   ========================================================================== */
require('dotenv').config();
const mysql = require('mysql2/promise');

const FIX_ORPHANS = process.argv.includes('--fix-orphans');

const TABELAS = ['appointments', 'exams'];
const REFS = [
  { col: 'unit_id', pai: 'health_units', fk: (t) => `fk_${t}_unit` },
  { col: 'professional_id', pai: 'professionals', fk: (t) => `fk_${t}_professional` },
];

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
    // ---- 1) pré-condições e órfãos (somente leitura até aqui) ----
    const orfaos = [];
    for (const tabela of TABELAS) {
      if (!(await existe(conn, 'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [tabela]))) {
        console.log(`  - ${tabela} ainda não existe (banco fora do baseline: recrie com db:setup --fresh)`);
        return;
      }
      for (const ref of REFS) {
        const [rows] = await conn.query(
          `SELECT a.id, a.${ref.col} AS ref FROM ${tabela} a
             LEFT JOIN ${ref.pai} p ON p.id = a.${ref.col}
            WHERE a.${ref.col} IS NOT NULL AND p.id IS NULL`
        );
        if (rows.length) orfaos.push({ tabela, ...ref, rows });
      }
    }

    if (orfaos.length && !FIX_ORPHANS) {
      console.error('Órfãos encontrados — nada foi alterado:');
      for (const o of orfaos) {
        const amostra = o.rows.slice(0, 5).map((r) => `${r.id} → ${r.ref}`).join(', ');
        console.error(`  ! ${o.tabela}.${o.col}: ${o.rows.length} sem ${o.pai} (ex.: ${amostra})`);
      }
      console.error('Revise os registros e rode de novo com --fix-orphans para zerar o vínculo (location/doctor ficam).');
      process.exitCode = 2;
      return;
    }
    for (const o of orfaos) {
      await conn.query(
        `UPDATE ${o.tabela} a LEFT JOIN ${o.pai} p ON p.id = a.${o.col}
            SET a.${o.col} = NULL WHERE a.${o.col} IS NOT NULL AND p.id IS NULL`
      );
      console.log(`  ~ ${o.tabela}.${o.col}: ${o.rows.length} órfão(s) zerado(s)`);
    }

    // ---- 2) índice e FKs ----
    for (const tabela of TABELAS) {
      const idx = `idx_${tabela}_unit_scheduled`;
      if (await existe(conn, 'SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?', [tabela, idx])) {
        console.log(`  - ${tabela}.${idx} já existe`);
      } else {
        await conn.query(`ALTER TABLE ${tabela} ADD INDEX ${idx} (unit_id, scheduled_at)`);
        console.log(`  + ${tabela}.${idx} criado`);
      }
      for (const ref of REFS) {
        const nome = ref.fk(tabela);
        if (await existe(conn, 'SELECT 1 FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?', [tabela, nome])) {
          console.log(`  - ${tabela}.${nome} já existe`);
          continue;
        }
        await conn.query(
          `ALTER TABLE ${tabela} ADD CONSTRAINT ${nome} FOREIGN KEY (${ref.col}) REFERENCES ${ref.pai} (id) ON DELETE SET NULL`
        );
        console.log(`  + ${tabela}.${nome} criada`);
      }
    }
    console.log('Migração booking:refs concluída.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Falha na migração booking:refs:', err.message);
  if (/3780|incompatible|Referencing column/i.test(err.message)) {
    console.error('Dica: tipo/collation de unit_id/professional_id difere do id da tabela pai (CHAR(36) utf8mb4).');
  }
  process.exit(1);
});
