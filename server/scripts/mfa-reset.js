/* ==========================================================================
   Saúde+ — redefinição do segundo fator POR TERMINAL (ADR-0010).

   Roda: npm --prefix server run mfa:reset -- --email fulano@prefeitura.gov.br            (simulação)
         npm --prefix server run mfa:reset -- --email fulano@prefeitura.gov.br --apply    (grava)

   Para o caso em que NENHUM superadmin consegue redefinir o MFA pelo painel: o único superadmin
   perdeu o aparelho, ou a conta é de outro superadmin. Quem roda precisa ter acesso ao servidor
   (é o controle: ele já alcança o banco e o `.env`). Zera o segundo fator da conta atendente/admin,
   derruba sessões e links de redefinição de senha e grava `mfa_reset_terminal` na trilha. No
   próximo login a conta volta a configurar o MFA.
   ========================================================================== */
require('dotenv').config();
const usuarios = require('../src/repositories/usuarios');
const { exigeMfa } = require('../src/services/session');
const { logAction } = require('../src/utils/audit');

/**
 * @returns {Promise<{ok: true, aplicado: boolean, id: string, role: string} | {ok: false, erro: string}>}
 */
async function redefinirMfaPorEmail(pool, email, { apply = false } = {}) {
  const alvoEmail = String(email || '').trim().toLowerCase();
  if (!alvoEmail) return { ok: false, erro: 'Informe --email.' };

  const [[conta]] = await pool.query(
    'SELECT id, role FROM users WHERE LOWER(email) = ? AND deleted_at IS NULL',
    [alvoEmail]
  );
  if (!conta) return { ok: false, erro: 'Nenhuma conta ativa com este e-mail.' };
  if (!exigeMfa(conta)) return { ok: false, erro: 'Só contas de atendente e admin têm o segundo fator obrigatório.' };
  if (!apply) return { ok: true, aplicado: false, id: conta.id, role: conta.role };

  await usuarios.zerarSegundoFator(pool, conta.id);
  await usuarios.revogarAcesso(pool, conta.id);
  // O ator da trilha é a própria conta: a FK exige um usuário, e quem rodou o terminal não tem conta.
  await logAction(conta.id, 'mfa_reset_terminal', 'user', conta.id, `segundo fator redefinido por terminal (role=${conta.role})`);
  return { ok: true, aplicado: true, id: conta.id, role: conta.role };
}

async function main() {
  const mysql = require('mysql2/promise');
  const i = process.argv.indexOf('--email');
  const email = i >= 0 ? process.argv[i + 1] : '';
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
    const r = await redefinirMfaPorEmail(pool, email, { apply });
    if (!r.ok) {
      console.error(r.erro);
      process.exitCode = 1;
    } else if (!r.aplicado) {
      console.log(`Conta ${r.id} (${r.role}): o segundo fator seria redefinido. Simulação; use --apply para gravar.`);
    } else {
      console.log(`Conta ${r.id} (${r.role}): segundo fator redefinido, sessões derrubadas. No próximo login ela configura o MFA de novo.`);
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

module.exports = { redefinirMfaPorEmail };
