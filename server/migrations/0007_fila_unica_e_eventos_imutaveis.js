/* ==========================================================================
   Saúde+ — Migração 0007 (idempotente): fila de espera única e histórico da agenda imutável
   (Fase 8, item 2.5; achados E-18 e E-20)

   Roda: npm run db:migrate. A estrutura equivalente já vem do schema.sql (instalação limpa); esta
   migração leva um banco existente até lá.

   1) Fila de espera: o banco passa a recusar DUAS entradas ATIVAS iguais do mesmo paciente.
        active_key = IF(status = 'aguardando', SHA2(kind|service|unit|professional), NULL)
        UNIQUE (user_id, active_key)
      Unidade e profissional nulos ("qualquer um") entram como texto vazio, porque NULL no UNIQUE nunca
      conflita. Entrada cancelada ou convertida vira NULL e não conta.

      Duplicatas existentes: a migração PARA e lista só ids; decidir qual manter é humano. Nada é alterado
      (nem os triggers abaixo) enquanto houver duplicata.

   2) booking_events passa a ser append-only no banco, como o audit_log: triggers recusam UPDATE e DELETE.
      Quem precisar apagar evento (teste, correção) não consegue mais pela aplicação: é de propósito.
      A ação referencial da FK (ON DELETE SET NULL no autor) não dispara trigger e continua valendo.

   `ALTER` com coluna STORED reescreve a tabela: em base grande, rode em janela de baixa carga
   (a fila de espera é pequena).
   ========================================================================== */
require('dotenv').config();
const mysql = require('mysql2/promise');

const EXPRESSAO = "IF(status = 'aguardando', SHA2(CONCAT_WS('|', kind, service_name, IFNULL(unit_id, ''), IFNULL(professional_id, '')), 256), NULL)";
const TRIGGERS = [
  { nome: 'trg_booking_events_no_update', evento: 'UPDATE', texto: 'booking_events é append-only: UPDATE bloqueado.' },
  { nome: 'trg_booking_events_no_delete', evento: 'DELETE', texto: 'booking_events é append-only: DELETE bloqueado.' },
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
    for (const tabela of ['waitlist', 'booking_events']) {
      if (!(await existe(conn, 'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [tabela]))) {
        console.log(`  - ${tabela} ainda não existe (banco fora do baseline: recrie com db:setup --fresh)`);
        return;
      }
    }

    // ---- 1) duplicatas ativas na fila (somente leitura) ----
    const [duplicadas] = await conn.query(
      `SELECT user_id, kind, service_name, unit_id, professional_id, COUNT(*) AS n,
              GROUP_CONCAT(id ORDER BY created_at, id SEPARATOR ', ') AS ids
         FROM waitlist
        WHERE status = 'aguardando'
        GROUP BY user_id, kind, service_name, unit_id, professional_id
       HAVING COUNT(*) > 1`
    );
    if (duplicadas.length) {
      console.error('Fila de espera com entradas ATIVAS repetidas (mesmo paciente, tipo, serviço, unidade e profissional) — nada foi alterado:');
      for (const r of duplicadas.slice(0, 20)) {
        console.error(`  ! waitlist: ${r.n} entradas de ${r.user_id} para "${r.service_name}" (${r.kind}): ${r.ids}`);
      }
      if (duplicadas.length > 20) console.error(`  … e mais ${duplicadas.length - 20} grupo(s)`);
      console.error("Cancele todas menos uma de cada grupo (UPDATE waitlist SET status = 'cancelado' WHERE id = …) e rode de novo.");
      process.exitCode = 2;
      return;
    }

    // ---- 2) coluna gerada + UNIQUE da fila ----
    const temColuna = await existe(conn, "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'waitlist' AND COLUMN_NAME = 'active_key'");
    const temIndice = await existe(conn, "SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'waitlist' AND INDEX_NAME = 'uq_waitlist_active'");
    if (temColuna && temIndice) {
      console.log('  - waitlist.active_key e uq_waitlist_active já existem');
    } else {
      const partes = [];
      if (!temColuna) partes.push(`ADD COLUMN active_key CHAR(64) GENERATED ALWAYS AS (${EXPRESSAO}) STORED`);
      if (!temIndice) partes.push('ADD UNIQUE KEY uq_waitlist_active (user_id, active_key)');
      await conn.query(`ALTER TABLE waitlist ${partes.join(', ')}`);
      console.log(`  + waitlist: ${!temColuna ? 'active_key ' : ''}${!temIndice ? 'uq_waitlist_active' : ''}`.trimEnd() + ' criado(s)');
    }

    // ---- 3) booking_events append-only ----
    let criados = 0;
    for (const t of TRIGGERS) {
      if (await existe(conn, 'SELECT 1 FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = ?', [t.nome])) continue;
      await conn.query(
        `CREATE TRIGGER ${t.nome} BEFORE ${t.evento} ON booking_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${t.texto}'`
      );
      console.log(`  + trigger ${t.nome} criado`);
      criados += 1;
    }
    if (!criados) console.log('  - triggers de booking_events já existem');

    console.log('Migração 0007 concluída.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Falha na migração 0007:', err.message);
  process.exit(1);
});