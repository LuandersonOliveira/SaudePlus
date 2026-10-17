const app = require('./app');
const { startReminderJob } = require('./jobs/reminders');
const { assertCryptoConfigured } = require('./utils/crypto');

const PORT = process.env.PORT || 4000;

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

try {
  validarConfiguracao();
} catch (err) {
  console.error(`Configuração inválida: ${err.message}`);
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`Saúde+ API rodando em http://localhost:${PORT}`);
  startReminderJob();
});