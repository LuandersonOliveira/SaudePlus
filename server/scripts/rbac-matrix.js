/**
 * Matriz RBAC cross-role — fonte ÚNICA.
 *
 * Ela é consumida por dois lugares: `npm run smoke-test` (comando curto do
 * README) e `server/test/api.test.js` (suíte completa). Duplicar estes casos
 * em dois arquivos é garantir que um deles envelhece sozinho e passa a
 * mentir: o smoke-test verde não diria nada sobre a suíte, nem o contrário.
 *
 * Os tokens são mintados localmente com jwt.sign. Nenhum usuário real é
 * criado e nenhum dado é gravado — o que está sendo exercitado é a
 * autorização, não a autenticação.
 */
const jwt = require('jsonwebtoken');

function tokenFor(role, adminLevel) {
  return jwt.sign(
    {
      id: '00000000-0000-0000-0000-000000000000',
      email: 't@t.local',
      role,
      admin_level: adminLevel || null,
      full_name: 'Teste',
    },
    process.env.JWT_SECRET,
    { expiresIn: '5m' }
  );
}

function headersFor(role, adminLevel) {
  return { Authorization: `Bearer ${tokenFor(role, adminLevel)}` };
}

// [rótulo, rota, papel, nível de admin, método, status esperado]
const MATRIZ = [
  // P0.3: atendente não pode decifrar/exfiltrar CPF/CNS via RNDS
  ['atendente -> /interop/rnds/send', '/interop/rnds/send', 'atendente', null, 'POST', 403],
  // P0: papel de paciente não chega em rota de staff nem de admin
  ['paciente -> /admin/stats', '/admin/stats', 'paciente', null, 'GET', 403],
  ['paciente -> /admin/users', '/admin/users', 'paciente', null, 'GET', 403],
  ['paciente -> /staff/appointments', '/staff/appointments', 'paciente', null, 'GET', 403],
  ['atendente -> /admin/stats', '/admin/stats', 'atendente', null, 'GET', 403],
  // P0.4: admin sem a permissão 'users' não gerencia usuários
  ['admin(atendimento) -> /admin/users', '/admin/users', 'admin', 'atendimento', 'GET', 403],
  // P0.4: nível 'atendimento' não tem 'audit' nem 'diseases'
  ['admin(atendimento) -> /admin/audit-log', '/admin/audit-log', 'admin', 'atendimento', 'GET', 403],
  ['admin(atendimento) -> /admin/audit-log/verify', '/admin/audit-log/verify', 'admin', 'atendimento', 'GET', 403],
  ['admin(atendimento) -> /admin/diseases', '/admin/diseases', 'admin', 'atendimento', 'GET', 403],
  // P3: 'units' só para gestor/superadmin
  ['admin(atendimento) -> /health-units/manage', '/health-units/manage', 'admin', 'atendimento', 'GET', 403],
  ['admin(atendimento) -> /admin/professionals', '/admin/professionals', 'admin', 'atendimento', 'GET', 403],
  ['admin(alertas) -> /admin/appointments', '/admin/appointments', 'admin', 'alertas', 'GET', 403],
  ['admin(alertas) -> /health-units (POST)', '/health-units', 'admin', 'alertas', 'POST', 403],
];

const ROTAS_PROTEGIDAS = [
  '/admin/stats',
  '/admin/export/summary.csv',
  '/health-units/manage',
  '/me/reminders',
];

/**
 * Roda a matriz contra uma base já no ar.
 * @param {string} base  ex.: http://127.0.0.1:4100
 * @returns {Promise<{ok: boolean, falhas: string[]}>}
 */
async function verificarRbac(base) {
  const falhas = [];

  for (const rota of ROTAS_PROTEGIDAS) {
    const res = await fetch(base + rota);
    if (res.status !== 401) {
      falhas.push(`${rota} sem token deveria devolver 401, devolveu ${res.status}`);
    }
  }

  for (const [rotulo, rota, papel, nivel, metodo, esperado] of MATRIZ) {
    const res = await fetch(base + rota, {
      method: metodo,
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        headersFor(papel, nivel)
      ),
      body: metodo === 'POST' ? JSON.stringify({ kind: 'appointment', id: 'x' }) : undefined,
    });
    if (res.status !== esperado) {
      falhas.push(`${rotulo} deveria devolver ${esperado}, devolveu ${res.status}`);
    }
  }

  return { ok: falhas.length === 0, falhas, casos: MATRIZ.length + ROTAS_PROTEGIDAS.length };
}

module.exports = { MATRIZ, ROTAS_PROTEGIDAS, verificarRbac, tokenFor, headersFor };