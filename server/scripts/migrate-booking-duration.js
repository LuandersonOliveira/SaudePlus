/* ==========================================================================
   Saúde+ — Migração 007 (idempotente): duração do agendamento

   Roda: npm run migrate:booking:duration  (ou entra no migrate:all)

   Por que: `validateBooking` derivava a duração do CANDIDATO corretamente, do
   `slot_minutes` da agenda. Mas `fetchBusyIntervals` tratava todo
   agendamento já existente como se durasse 30 minutos — uma constante que
   ninguém podia ver.

   Com uma agenda só, o erro fica mascarado pela grade de slots. Ele aparece
   quando o mesmo profissional tem dois work_schedules sobrepostos no mesmo
   dia com durações diferentes (ex.: 08:00–12:00 de 60 min e 09:00–17:00 de
   30 min). Agendamento das 09:00 ocupa, aos olhos do código, 09:00–09:30 — e
   as 09:30, que é candidato legítimo da grade de 30 min, entravam. Dois
   compromissos sobrepostos no mesmo profissional, com a agenda "correta" na
   tela.

   A duração fica no próprio agendamento, e não é derivada da agenda na hora
   do cálculo: ela é propriedade do que foi marcado. Se o admin mudar o
   `slot_minutes` amanhã, o significado do agendamento de hoje não pode mudar
   retroativamente.

   NULL = agendamento anterior à coluna (ou serviço sem profissional alocado).
   O cálculo usa COALESCE(duration_minutes, 30), que preserva o comportamento
   antigo para o legado — melhor que ignorar a linha e permitir sobreposição.
   ========================================================================== */
require('dotenv').config();
const mysql = require('mysql2/promise');

const TABELAS = ['appointments', 'exams'];

async function colunas(conn, tabela) {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tabela]
  );
  return rows.map((r) => r.n);
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
    for (const tabela of TABELAS) {
      const existentes = await colunas(conn, tabela);
      if (!existentes.includes('id')) {
        console.log(`  - ${tabela} ainda não existe (rode migrate:v3 antes)`);
        continue;
      }
      if (existentes.includes('duration_minutes')) {
        console.log(`  - ${tabela}.duration_minutes já existe`);
        continue;
      }
      await conn.query(`ALTER TABLE ${tabela} ADD COLUMN duration_minutes INT NULL DEFAULT NULL`);
      console.log(`  + ${tabela}.duration_minutes criado`);
    }
    console.log('Migração 007 concluída.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Falha na migração 007:', err.message);
  process.exit(1);
});