/* ==========================================================================
   Saúde+ — Migração 008 (idempotente): entrega real dos lembretes

   Roda: npm run migrate:reminder:delivery  (ou entra no migrate:all)

   Por que: o job de lembretes montava e persistia a linha, e era isso. O
   paciente via o lembrete só se abrisse o painel — o que não serve para
   lembrar de uma consulta amanhã.

   Três colunas, porque as perguntas que importam depois são distintas:
   `sent_at` responde "saiu?", `send_channel` "por onde?", `send_error`
   "por que não?". Sem elas, uma falha de envio e um usuário sem e-mail
   ficariam indistinguíveis de um envio bem-sucedido.

   NULL em `sent_at` é o estado normal de quem não tem e-mail cadastrado:
   o lembrete continua na tela do painel, que é o canal que já funcionava.
   Isso é DIFFERENTE de um envio que falhou — e o `send_error` separa os
   dois casos.
   ========================================================================== */
require('dotenv').config();
const mysql = require('mysql2/promise');

const TABELA = 'reminders';
const COLUNAS = [
  ['sent_at', 'DATETIME NULL DEFAULT NULL'],
  ['send_channel', "VARCHAR(20) NULL DEFAULT NULL"],
  ['send_error', 'VARCHAR(255) NULL DEFAULT NULL'],
];

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
    const existentes = await colunas(conn, TABELA);
    if (!existentes.includes('id')) {
      console.log(`  - ${TABELA} ainda não existe (rode migrate:v3 antes)`);
      process.exit(0);
    }
    let criadas = 0;
    for (const [nome, tipo] of COLUNAS) {
      if (existentes.includes(nome)) {
        console.log(`  - ${TABELA}.${nome} já existe`);
        continue;
      }
      await conn.query(`ALTER TABLE ${TABELA} ADD COLUMN ${nome} ${tipo}`);
      console.log(`  + ${TABELA}.${nome} criado`);
      criadas += 1;
    }
    console.log(`Migração 008 concluída (${criadas} coluna(s) nova(s)).`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Falha na migração 008:', err.message);
  process.exit(1);
});