/* ==========================================================================
   Saúde+ — Migração 0005 (idempotente): horário único por profissional
   (RFC-0001 / ADR-0007, achado B2 da Fase 6)

   Roda: npm run db:migrate. A estrutura equivalente já vem do schema.sql
   (instalação limpa); esta migração leva um banco existente até lá.

   Por que: a exclusividade de horário dependia só de `SELECT … FOR UPDATE` na
   aplicação. Agora o banco também recusa dois atendimentos ATIVOS do mesmo
   profissional no mesmo instante:
     active_slot = IF(status IN ('pendente','confirmado'), scheduled_at, NULL)
     UNIQUE (professional_id, active_slot)
   Cancelado, concluído e para_remarcar viram NULL e liberam o horário.
   (Sem profissional, professional_id NULL não entra no UNIQUE; a sobreposição por
   duração continua na aplicação.)

   Duplicatas existentes: a migração PARA e lista só ids (appointments/exams com
   o mesmo profissional e horário ativos) — decidir qual manter é humano. Nada é
   alterado enquanto houver duplicata.

   Aplica nas duas tabelas (appointments e exams). `ALTER` com coluna STORED
   reescreve a tabela: em base grande, rode em janela de baixa carga.
   ========================================================================== */
require('dotenv').config();
const mysql = require('mysql2/promise');

const TABELAS = ['appointments', 'exams'];
const EXPRESSAO = "IF(status IN ('pendente', 'confirmado'), scheduled_at, NULL)";

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
    // ---- 1) pré-condições e duplicatas (somente leitura) ----
    const duplicatas = [];
    for (const tabela of TABELAS) {
      if (!(await existe(conn, 'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [tabela]))) {
        console.log(`  - ${tabela} ainda não existe (banco fora do baseline: recrie com db:setup --fresh)`);
        return;
      }
      const [rows] = await conn.query(
        `SELECT professional_id, scheduled_at, COUNT(*) AS n, GROUP_CONCAT(id ORDER BY created_at SEPARATOR ', ') AS ids
           FROM ${tabela}
          WHERE professional_id IS NOT NULL AND status IN ('pendente', 'confirmado')
          GROUP BY professional_id, scheduled_at HAVING COUNT(*) > 1`
      );
      if (rows.length) duplicatas.push({ tabela, rows });
    }
    if (duplicatas.length) {
      console.error('Horário duplicado (mesmo profissional, mesmo instante, ambos ativos) — nada foi alterado:');
      for (const d of duplicatas) {
        for (const r of d.rows.slice(0, 20)) console.error(`  ! ${d.tabela}: ${r.n} registros em ${r.scheduled_at} (profissional ${r.professional_id}): ${r.ids}`);
        if (d.rows.length > 20) console.error(`  … e mais ${d.rows.length - 20} grupo(s) em ${d.tabela}`);
      }
      console.error('Cancele ou remarque um de cada par (o outro fica com o horário) e rode de novo.');
      process.exitCode = 2;
      return;
    }

    // ---- 2) coluna gerada + UNIQUE ----
    for (const tabela of TABELAS) {
      const indice = `uq_${tabela}_prof_active_slot`;
      const temColuna = await existe(conn, 'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [tabela, 'active_slot']);
      const temIndice = await existe(conn, 'SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?', [tabela, indice]);
      if (temColuna && temIndice) {
        console.log(`  - ${tabela}.active_slot e ${indice} já existem`);
        continue;
      }
      const partes = [];
      if (!temColuna) partes.push(`ADD COLUMN active_slot DATETIME GENERATED ALWAYS AS (${EXPRESSAO}) STORED`);
      if (!temIndice) partes.push(`ADD UNIQUE KEY ${indice} (professional_id, active_slot)`);
      await conn.query(`ALTER TABLE ${tabela} ${partes.join(', ')}`);
      console.log(`  + ${tabela}: ${!temColuna ? 'active_slot ' : ''}${!temIndice ? indice : ''}`.trimEnd() + ' criado(s)');
    }
    console.log('Migração 0005 concluída.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Falha na migração 0005:', err.message);
  process.exit(1);
});
