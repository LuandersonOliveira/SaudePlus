const app = require('./app');
const { startReminderJob } = require('./jobs/reminders');
const { assertCryptoConfigured } = require('./utils/crypto');

const PORT = process.env.PORT || 4000;

// Colunas de migration que o código referencia SEM fallback. Se faltarem, o
// app não sobe.
//
// Aqui a escolha é fail-closed, e o motivo é específico: a alternativa
// ( degradar para 30 min quando a coluna não existe) devolveria o
// double-booking em silêncio — dois compromissos sobrepostos no mesmo
// profissional sem nenhum sinal. Um 500 numa rota de agendamento já é ruim,
// mas é VISÍVEL; sobreposição de agenda é o defeito que a coluna veio
// resolver.
//
// `users.totp_last_step` não entra aqui: a rota /auth/mfa/verify tem
// fallback próprio e degrada só o replay, com aviso no console.
const COLUNAS_OBRIGATORIAS = [
  ['appointments', 'duration_minutes'],
  ['exams', 'duration_minutes'],
];

/**
 * Confere se as colunas existem. `pool` é injetável para o teste.
 * @returns {Promise<{ok: boolean, faltando: string[], erro?: string}>}
 */
async function conferirColunas(pool) {
  const [rows] = await pool.query(
    `SELECT table_name AS t, column_name AS c FROM information_schema.COLUMNS
     WHERE table_schema = DATABASE()
       AND (${COLUNAS_OBRIGATORIAS.map(() => '(table_name = ? AND column_name = ?)').join(' OR ')})`,
    COLUNAS_OBRIGATORIAS.flat()
  );
  const existentes = new Set(rows.map((r) => `${r.t}.${r.c}`));
  const faltando = COLUNAS_OBRIGATORIAS.map(([t, c]) => `${t}.${c}`).filter((k) => !existentes.has(k));
  return { ok: faltando.length === 0, faltando };
}

// --------------------------------------------------------------------------
// Validação de configuração ANTES do listen. Um processo que sobe e só depois
// descobre que está gravando CPF em texto puro já aceitou tráfego vulnerável
// antes de qualquer aviso — e em produção ninguém lê console.
// --------------------------------------------------------------------------
function validarConfiguracao() {
  assertCryptoConfigured();

  const jwt = String(process.env.JWT_SECRET || '');
  if (jwt.length < 32) {
    throw new Error(
      `JWT_SECRET ausente ou curto (${jwt.length} caracteres; mínimo 32). ` +
        'Gere com: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"'
    );
  }
}

async function subir() {
  validarConfiguracao();

  const pool = require('./db');
  const colunas = await conferirColunas(pool);
  if (!colunas.ok) {
    console.error(
      `Migração pendente: falta(m) ${colunas.faltando.join(', ')}.\n` +
      'Rode: npm run db:migrate   (ou npm run db:setup para recriar do zero).\n' +
      'Sem essas colunas, todo agendamento devolveria 500 — e degradar para o\n' +
      'padrão de 30 min devolveria o agendamento sobreposto em silêncio.'
    );
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Saúde+ API rodando em http://localhost:${PORT}`);
    startReminderJob();
  });
}

// Só sobe quando executado diretamente (`npm start`). Os testes importam este
// arquivo para exercitar conferirColunas/validarConfiguracao, e sem este
// guard cada require() levantava um servidor na máquina de teste.
if (require.main === module) {
  subir().catch((err) => {
    console.error(`Não foi possível subir: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { conferirColunas, validarConfiguracao, COLUNAS_OBRIGATORIAS };