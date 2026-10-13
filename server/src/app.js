const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { globalLimiter, authLimiter } = require('./middleware/rateLimit');
const { attachAudit } = require('./middleware/audit');
const { attachDocs } = require('./middleware/crypto');

const authRoutes = require('./routes/auth.routes');
const appointmentsRoutes = require('./routes/appointments.routes');
const remindersRoutes = require('./routes/reminders.routes');
const diseasesRoutes = require('./routes/diseases.routes');
const adminRoutes = require('./routes/admin.routes');
const adminUsersRoutes = require('./routes/admin.users.routes');
const examsRoutes = require('./routes/exams.routes');
const unitsRoutes = require('./routes/units.routes');
const staffRoutes = require('./routes/staff.routes');
const catalogRoutes = require('./routes/catalog.routes');
const adminProfessionalsRoutes = require('./routes/admin.professionals.routes');
const publicRoutes = require('./routes/public.routes');
const interopRoutes = require('./routes/interop.routes');

const app = express();

// Segurança HTTP básica (Fase 0): headers via helmet + JSON com limite.
app.use(helmet());
app.use(cookieParser());

// CORS fechado: lista explícita em CORS_ORIGIN (vírgula = múltiplas origens).
// Sem '*' como fallback — em produção, origem desconhecida é bloqueada.
// Em dev sem .env, libera apenas o front local padrão.
function buildCorsOrigin() {
  const raw = (process.env.CORS_ORIGIN || 'http://localhost:8080').trim();
  const allowed = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return (origin, callback) => {
    if (!origin) return callback(null, true); // curl/smoke-test/health-check
    if (allowed.includes(origin)) return callback(null, true);
    return callback(new Error('Origem não permitida pelo CORS.'));
  };
}

app.use(cors({ origin: buildCorsOrigin() }));
app.use(express.json({ limit: '100kb' }));
app.use(globalLimiter);
// Fase 3: segurança isolada — req.audit() e req.encryptDoc/decryptDoc
// disponíveis em todas as rotas; o ator é lido de req.user na hora do uso.
app.use(attachAudit);
app.use(attachDocs);

app.get('/health', (req, res) => res.json({ ok: true }));

// GET /ready — sonda de prontidão p/ monitoramento (Aula 1: disponibilidade).
// Pública de propósito, sem PII: diz apenas se a API alcança o banco.
app.get('/ready', async (req, res) => {
  try {
    const pool = require('./db');
    await pool.query('SELECT 1');
    res.json({ ok: true, db: true, uptime: Math.floor(process.uptime()) });
  } catch {
    res.status(503).json({ ok: false, db: false });
  }
});

app.use('/auth', authLimiter, authRoutes);
app.use('/me/appointments', appointmentsRoutes);
app.use('/me/exams', examsRoutes);
app.use('/me/reminders', remindersRoutes);
app.use('/diseases', diseasesRoutes);
app.use('/health-units', unitsRoutes);
app.use('/staff', staffRoutes);
app.use('/catalog', catalogRoutes);
app.use('/admin/users', adminUsersRoutes);
// Antes de /admin: o router genérico tem PATCH /:kind/:id que casaria com
// /admin/professionals/:id e devolveria 404.
app.use('/admin/professionals', adminProfessionalsRoutes);
app.use('/admin', adminRoutes);
app.use('/public', publicRoutes);
app.use('/interop', interopRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.message === 'Origem não permitida pelo CORS.') {
    return res.status(403).json({ error: 'Origem não permitida.' });
  }
  // Integrações opcionais (Gov.br, RNDS) usam err.status/code próprios.
  if (err && err.status && err.status >= 400 && err.status < 600) {
    return res.status(err.status).json({ error: err.message, code: err.code || undefined });
  }
  console.error(err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

module.exports = app;
