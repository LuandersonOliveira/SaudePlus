/**
 * Contratos HTTP e matriz RBAC.
 *
 * O front depende das FORMAS que a API devolve: um `null` onde se espera
 * array é exatamente a classe de bug que a auditoria achou em
 * dashboard.html:964. Por isso os testes de contrato existem — o que pega
 * não é o status 200, é o assert sobre a forma do corpo.
 *
 * A matriz RBAC mora AQUI e não no smoke-test.js: o smoke continua sendo o
 * comando curto do README, e duplicar 14 asserts em dois arquivos é
 * garantir que um deles vai envelhecer sozinho.
 *
 * Os tokens são mintados localmente (jwt.sign) — nenhum usuário real é
 * criado, nenhum dado é gravado. Só a autorização em si é exercitada.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const app = require('../src/app');
const { verificarRbac } = require('../scripts/rbac-matrix');

const { sanitizeDetails } = require('../src/utils/audit');
const { isValidCPF, isValidCNS, parsePagination } = require('../src/utils/validators');

let server;
let base;

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  // O pool do MySQL fica com handles vivos e segura o event loop: sem isto o
  // processo termina os testes e nunca sai — o `npm test` inteiro parece
  // travado, não reprovado.
  const pool = require('../src/db');
  await pool.end().catch(() => {});
});

// ===========================================================================
// Utilitários puros
// ===========================================================================

test('CPF válido passa e CPF repetido falha', () => {
  assert.equal(isValidCPF('529.982.247-25'), true);
  assert.equal(isValidCPF('111.111.111-11'), false);
});

test('CNS válido passa e CNS curto falha', () => {
  assert.equal(isValidCNS('898001234567891'), true);
  assert.equal(isValidCNS('123'), false);
});

test('a auditoria mascara CPF e redige Bearer', () => {
  const masked = sanitizeDetails('agendou cpf 52998224725 e Bearer abc123 token="x"');
  assert.ok(!masked.includes('52998224725'), 'o CPF não pode vazar para a auditoria');
  assert.ok(!masked.includes('Bearer abc123'), 'o token não pode vazar para a auditoria');
  assert.ok(masked.includes('[redigido]'));
});

test('paginação: query presente pede envelope; ausente, não', () => {
  const pg = parsePagination({ page: '2', pageSize: '10' });
  assert.deepEqual(
    { wantsPaged: pg.wantsPaged, page: pg.page, pageSize: pg.pageSize, offset: pg.offset },
    { wantsPaged: true, page: 2, pageSize: 10, offset: 10 }
  );
  assert.equal(parsePagination({}).wantsPaged, false);
});

// ===========================================================================
// Saúde e headers
// ===========================================================================

test('GET /health responde 200 com ok=true', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

test('helmet ativo: nosniff e sem fingerprint de framework', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('origem fora da allowlist recebe 403 e nenhum dado', async () => {
  const res = await fetch(`${base}/health`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
  const corpo = await res.text();
  assert.ok(!corpo.includes('"ok":true'), 'a resposta 403 não pode vazar o corpo da rota');
});

// ===========================================================================
// Contratos de resposta que o front consome
// ===========================================================================

test('rota inexistente devolve 404 em JSON, não HTML', async () => {
  // Um HTML de erro quebra o JSON.parse do api.js e a tela fica em branco
  // sem dizer nada.
  const res = await fetch(`${base}/rota-que-nao-existe`);
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type') || '', /application\/json/);
  const body = await res.json();
  assert.ok(body.error || body.message, 'o 404 precisa ter um campo de erro legível');
});

test('401 sem token vem com mensagem legível, não "Invalid input"', async () => {
  const res = await fetch(`${base}/auth/me`);
  assert.equal(res.status, 401);
  const body = await res.json();
  const msg = body.error || body.message || '';
  assert.ok(msg.length > 0, 'o 401 precisa de mensagem');
  assert.ok(!/Invalid input|undefined|\[object/i.test(msg), `mensagem inadequada: ${msg}`);
});

// ===========================================================================
// Contratos contra o banco: as formas que as páginas realmente renderizam
// ===========================================================================

/**
 * Estos testes precisam de um admin real no banco, porque as rotas checam
 * capabelades que vêm do token E a existence do usuário. Sem admin semeado
 * eles pulam em vez de falhar: uma instalação nova ainda não rodou
 * `npm run db:seed`, e isso não é um defeito do código.
 */
async function adminReal() {
  const pool = require('../src/db');
  const [rows] = await pool.query(
    "SELECT id, email, full_name FROM users WHERE role = 'admin' LIMIT 1"
  );
  return rows[0] || null;
}

test('GET /auth/me devolve { user } para um paciente real', async (t) => {
  const pool = require('../src/db');
  const [[u]] = await pool.query(
    "SELECT id, email, full_name FROM users WHERE role = 'paciente' LIMIT 1"
  );
  if (!u) return t.skip('nenhum paciente no banco — rode npm run db:seed');

  const token = jwt.sign(
    { id: u.id, email: u.email, role: 'paciente', full_name: u.full_name },
    process.env.JWT_SECRET,
    { expiresIn: '5m' }
  );
  const res = await fetch(`${base}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.user, '/auth/me precisa devolver { user }');
  assert.equal(body.user.email, u.email);
  assert.ok(!('token' in body), '/auth/me não deve devolver token novo');
});

test('GET /catalog/services devolve array', async (t) => {
  const admin = await adminReal();
  if (!admin) return t.skip('nenhum admin no banco — rode npm run db:seed');

  const token = jwt.sign(
    { id: admin.id, email: admin.email, role: 'admin', admin_level: 'superadmin', full_name: admin.full_name },
    process.env.JWT_SECRET,
    { expiresIn: '5m' }
  );
  // `tipo` é obrigatório: sem ele a rota responde 400 com
  // { error: 'tipo deve ser consulta ou exame.' }.
  const res = await fetch(`${base}/catalog/services?tipo=consulta`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  const lista = Array.isArray(body) ? body : body.data;
  assert.ok(Array.isArray(lista), `/catalog/services devolveu ${JSON.stringify(body).slice(0, 120)}`);
});

test('GET /catalog/services sem tipo devolve 400 com mensagem utilizável', async (t) => {
  // Contrato inverso: o front sempre manda ?tipo, mas se a query mudar o
  // 400 precisa dizer o que falta em vez de um "Invalid input" genérico.
  const admin = await adminReal();
  if (!admin) return t.skip('nenhum admin no banco — rode npm run db:seed');

  const token = jwt.sign(
    { id: admin.id, email: admin.email, role: 'admin', admin_level: 'superadmin', full_name: admin.full_name },
    process.env.JWT_SECRET,
    { expiresIn: '5m' }
  );
  const res = await fetch(`${base}/catalog/services`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error || '', /consulta|exame/i);
});

test('GET /admin/users devolve { data, total } com total inteiro', async (t) => {
  const admin = await adminReal();
  if (!admin) return t.skip('nenhum admin no banco — rode npm run db:seed');

  const token = jwt.sign(
    { id: admin.id, email: admin.email, role: 'admin', admin_level: 'superadmin', full_name: admin.full_name },
    process.env.JWT_SECRET,
    { expiresIn: '5m' }
  );
  const res = await fetch(`${base}/admin/users`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.data), '/admin/users precisa devolver { data: [...] }');
  assert.equal(Number.isInteger(body.total), true, '/admin/users precisa devolver total inteiro');
  assert.ok(body.total >= body.data.length, 'total não pode ser menor que a página devolvida');
});

test('GET /catalog/slots devolve { unidades, totalVagas }', async (t) => {
  const admin = await adminReal();
  if (!admin) return t.skip('nenhum admin no banco — rode npm run db:seed');

  // O contrato real é por SERVIÇO (tipo + nome), não por profissional/data.
  const pool = require('../src/db');
  const [[oferta]] = await pool.query(
    "SELECT name FROM unit_offers WHERE kind = 'consulta' AND active = 1 LIMIT 1"
  );
  if (!oferta) return t.skip('nenhum serviço de consulta ativo — rode npm run db:seed');

  const [[u]] = await pool.query("SELECT id, email FROM users WHERE role = 'paciente' LIMIT 1");
  if (!u) return t.skip('nenhum paciente no banco — rode npm run db:seed');

  const token = jwt.sign(
    { id: u.id, email: u.email, role: 'paciente', full_name: 'Slots' },
    process.env.JWT_SECRET,
    { expiresIn: '5m' }
  );
  const params = new URLSearchParams({ tipo: 'consulta', name: oferta.name, days: '7' });
  const res = await fetch(`${base}/catalog/slots?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(
    Array.isArray(body.unidades),
    `/catalog/slots precisa devolver unidades[]; veio ${JSON.stringify(body).slice(0, 120)}`
  );
  assert.equal(Number.isInteger(body.totalVagas), true, '/catalog/slots precisa devolver totalVagas inteiro');
});

// ===========================================================================
// Matriz RBAC — o front esconder não basta, o back precisa barrar
// ===========================================================================

test('RBAC: papel sem permissão é barrado com 403, rota protegida sem token com 401', async () => {
  // A matriz vem de server/scripts/rbac-matrix.js, a MESMA que o smoke-test usa.
  // verificarRbac percorre os casos um a um para o relatório apontar qual par
  // quebrou, em vez de somar tudo num único "deveria devolver 403".
  const rbac = await verificarRbac(base);
  assert.equal(rbac.ok, true, `RBAC falhou:\n  - ${rbac.falhas.join('\n  - ')}`);
  assert.ok(rbac.casos >= 17, 'a matriz deveria ter os 13 casos de 403 + 4 rotas protegidas');
});