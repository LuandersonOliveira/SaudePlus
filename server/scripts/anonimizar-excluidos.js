/* ==========================================================================
   Saúde+ — correção única do ADR-0009: anonimiza as contas que o admin
   "excluiu" antes de o DELETE /admin/users/:id passar a anonimizar.

   Roda: npm --prefix server run anonimizar:excluidos            (simulação)
         npm --prefix server run anonimizar:excluidos -- --apply (grava)

   Antes do ADR-0009 a exclusão administrativa só preenchia `deleted_at` e deixava
   nome, e-mail, documentos e contato na linha. Esta rotina chama o mesmo
   `anonymizeUser` do titular nessas contas. É IRREVERSÍVEL: rode primeiro sem
   --apply, confira a lista e faça backup (npm --prefix server run backup).

   Candidata = `deleted_at` preenchido e e-mail ainda diferente de
   `removido_<id>@removido.local`. Rodar de novo não acha nada.
   ========================================================================== */
require('dotenv').config();
const { anonymizeUser } = require('../src/utils/privacy');

const MOTIVO = 'correção ADR-0009: exclusão administrativa anterior';

/** Contas excluídas pelo admin que ainda guardam dado pessoal. Só lê. */
async function candidatas(db) {
  const [rows] = await db.query(
    `SELECT id, role, deleted_at
     FROM users
     WHERE deleted_at IS NOT NULL
       AND email NOT LIKE 'removido\\_%@removido.local'
     ORDER BY deleted_at, id`
  );
  return rows;
}

/**
 * Anonimiza as candidatas. Sem `apply` (padrão) só devolve a lista.
 * Cada conta roda na própria transação; uma falha não impede as outras e é devolvida em `falhas`.
 * @returns {Promise<{encontradas: number, anonimizadas: number, falhas: {id: string, erro: string}[]}>}
 */
async function anonimizarExcluidos(pool, { apply = false } = {}) {
  const lista = await candidatas(pool);
  const resultado = { encontradas: lista.length, anonimizadas: 0, falhas: [] };
  if (!apply) return resultado;

  for (const conta of lista) {
    try {
      if (await anonymizeUser(pool, conta.id, { reason: MOTIVO })) resultado.anonimizadas += 1;
    } catch (err) {
      resultado.falhas.push({ id: conta.id, erro: err.message });
    }
  }
  return resultado;
}

async function main() {
  const mysql = require('mysql2/promise');
  const apply = process.argv.includes('--apply');
  const pool = await mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'saude',
    charset: 'utf8mb4',
    connectionLimit: 2,
  });
  try {
    const r = await anonimizarExcluidos(pool, { apply });
    console.log(`Contas excluídas que ainda guardam dado pessoal: ${r.encontradas}${apply ? '' : ' (simulação, use --apply para gravar)'}`);
    if (apply) {
      console.log(`Anonimizadas: ${r.anonimizadas}`);
      for (const f of r.falhas) console.error(`  ! ${f.id}: ${f.erro}`);
      if (r.falhas.length) process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Falha:', err.message);
    process.exit(1);
  });
}

module.exports = { candidatas, anonimizarExcluidos, MOTIVO };
