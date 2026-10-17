/**
 * requireCapability falhava ABERTO: `LEVEL_PERMISSIONS[level || 'gestor']`.
 * Um admin com admin_level NULL — criado na mão, por um seed, ou anterior à
 * migration que criou a coluna — recebia o pacote inteiro do gestor, que tem
 * TODAS as capabilities. Não existe caminho de negação por padrão.
 *
 * E a hierarquia era decorativa: `superadmin` e `gestor` eram idênticos
 * byte a byte, e `admin.users.routes.js` ainda tentava garantir que só o
 * superadmin mexesse em níveis — com um `if` solto no controller, longe do
 * middleware que decide.
 *
 * Aqui: nível ausente ou desconhecido é negado, e existe uma capability que
 * só o superadmin tem.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { requireCapability, LEVEL_PERMISSIONS } = require('../src/middleware/capabilities');

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(b) { this.body = b; return this; },
  };
}

function tentar(usuario, capability) {
  const res = fakeRes();
  let avancou = false;
  requireCapability(capability)(
    { user: usuario },
    res,
    () => { avancou = true; }
  );
  return { avancou, res };
}

test('admin sem admin_level é NEGADO, não cai em gestor', () => {
  const r = tentar({ role: 'admin', admin_level: null }, 'users');
  assert.equal(r.avancou, false, 'admin sem nível não pode ter acesso total');
  assert.equal(r.res.statusCode, 403);
});

test('admin com admin_level undefined também é negado', () => {
  const r = tentar({ role: 'admin' }, 'users');
  assert.equal(r.avancou, false);
  assert.equal(r.res.statusCode, 403);
});

test('nível desconhecido é negado em vez de degradar', () => {
  for (const nivel of ['root', 'dono', 'SUPERADMIN', '']) {
    const r = tentar({ role: 'admin', admin_level: nivel }, 'users');
    assert.equal(r.avancou, false, `admin_level=${JSON.stringify(nivel)} não pode ser aceito`);
  }
});

test('sem sessão é negado', () => {
  for (const user of [undefined, null, {}]) {
    const r = tentar(user, 'users');
    assert.equal(r.avancou, false);
    assert.equal(r.res.statusCode, 403);
  }
});

test('paciente e atendente nunca passam, nem com nível forjado', () => {
  // Um paciente que mande admin_level:'superadmin' no token não pode virar admin.
  for (const role of ['paciente', 'atendente']) {
    const r = tentar({ role, admin_level: 'superadmin' }, 'users');
    assert.equal(r.avancou, false, `${role} não pode acessar /admin`);
    assert.equal(r.res.statusCode, 403);
  }
});

test('cada nível tem exatamente as capabilities declaradas', () => {
  assert.deepEqual(LEVEL_PERMISSIONS.atendimento, ['appointments']);
  assert.deepEqual(LEVEL_PERMISSIONS.alertas, ['diseases']);
});

test('gestor tem tudo menos a capability de administrar admins', () => {
  assert.ok(LEVEL_PERMISSIONS.gestor.includes('users'));
  assert.ok(!LEVEL_PERMISSIONS.gestor.includes('admins'), 'gestor não pode mudar níveis');
});

test('só o superadmin tem a capability admins — a hierarquia precisa existir', () => {
  assert.ok(LEVEL_PERMISSIONS.superadmin.includes('admins'));
  for (const [nivel, caps] of Object.entries(LEVEL_PERMISSIONS)) {
    if (nivel === 'superadmin') continue;
    assert.ok(!caps.includes('admins'), `${nivel} não deveria ter 'admins'`);
  }
  // E ela tem de ser DIFFERENTE do gestor, senão o nível não distingue nada.
  assert.notDeepEqual(
    LEVEL_PERMISSIONS.superadmin,
    LEVEL_PERMISSIONS.gestor,
    'superadmin e gestor idênticos tornam a hierarquia decorativa'
  );
});

test('cada capability só passa para quem a declara', () => {
  for (const [nivel, caps] of Object.entries(LEVEL_PERMISSIONS)) {
    for (const capability of ['users', 'appointments', 'diseases', 'units', 'audit', 'reports', 'admins']) {
      const r = tentar({ role: 'admin', admin_level: nivel }, capability);
      assert.equal(
        r.avancou,
        caps.includes(capability),
        `${nivel} + ${capability}: esperava ${caps.includes(capability)}, veio ${r.avancou}`
      );
    }
  }
});

test('a mensagem de erro é a mesma para todos os casos de negação', () => {
  // Não revelar se o nível existe, se é desconhecido ou se não há sessão
  // evita dar mapa do modelo de permissões para quem está sondando.
  const mensagens = new Set([
    tentar({ role: 'admin', admin_level: null }, 'users').res.body.error,
    tentar({ role: 'admin', admin_level: 'root' }, 'users').res.body.error,
    tentar(undefined, 'users').res.body.error,
    tentar({ role: 'paciente' }, 'users').res.body.error,
  ]);
  assert.equal(mensagens.size, 1, `mensagens divergentes: ${[...mensagens].join(' | ')}`);
});

// ---------------------------------------------------------------------------
// Integração: 'users' e 'admins' são portas diferentes. Se fossem a mesma,
// o gestor perdia o que legitimamente pode fazer (ativar conta, ajustar cargo)
// — ou o superadmin perdia a exclusividade do nível.
// ---------------------------------------------------------------------------

let app;
let server;
let base;
let pool;
let criado;
let atorId;

// Ids FIXOS de propósito. Um ator com linhas em audit_log não pode ser
// apagado: a tabela é append-only (trigger trg_audit_no_delete) e a FK do
// ator é ON DELETE RESTRICT. Com id fixo, rerodar o teste reusa a linha em
// vez de acumular duplicata — e sem ninguém precisar apagar auditoria.
const ATOR_ID = '00000000-0000-4000-8000-00000000cafe';
const ALVO_ID = '00000000-0000-4000-8000-0000000cafe1';

test.before(async () => {
  const path = require('node:path');
  const SERVER = path.resolve(__dirname, '..');
  require(require.resolve('dotenv', { paths: [SERVER] })).config({
    path: path.join(SERVER, '.env'),
  });
  const bcrypt = require(require.resolve('bcryptjs', { paths: [SERVER] }));
  pool = require('../src/db');
  app = require('../src/app');

  const hash = await bcrypt.hash('senha-certa-123', 4);
  criado = ALVO_ID;
  atorId = ATOR_ID;

  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, account_status)
     VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), password_hash = VALUES(password_hash),
                             account_status = VALUES(account_status), admin_level = NULL`,
    [ALVO_ID, 'Gerenciado', 'gerenciado@caps.local', hash, 'paciente', 'pendente']
  );
  // O ator TEM que existir: audit_log.actor_id é FK para users, e um ator
  // fictício faz cada PATCH emitir um erro de auditoria no console.
  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, admin_level, account_status)
     VALUES (?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), password_hash = VALUES(password_hash),
                             admin_level = VALUES(admin_level)`,
    [ATOR_ID, 'Ator', 'ator@caps.local', hash, 'admin', 'superadmin', 'ativo']
  );

  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  if (!pool) return;
  // Deixa os dois usuários: eles têm linhas em audit_log, e audit_log é
  // append-only com FK RESTRICT — apagar é impossível por desenho. São linhas
  // de teste, com e-mail @caps.local, e ficam lá de propósito.
  await pool.end().catch(() => {});
});

function tokenDe(role, adminLevel) {
  const jwt = require(require.resolve('jsonwebtoken', {
    paths: [require('node:path').resolve(__dirname, '..')],
  }));
  return jwt.sign(
    {
      id: atorId,
      email: 'ator@caps.local',
      role,
      admin_level: adminLevel,
      full_name: 'Ator',
    },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );
}

async function patch(adminLevel, body) {
  const res = await fetch(`${base}/admin/users/${criado}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenDe('admin', adminLevel)}`,
    },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* sem corpo */ }
  return { status: res.status, body: json };
}

test('gestor pode ativar uma conta — isso é dele, não do superadmin', async () => {
  const r = await patch('gestor', { account_status: 'ativo', reason: 'documentos conferidos' });
  assert.equal(r.status, 200, `gestor deveria poder ativar: ${JSON.stringify(r.body)}`);
  const [[row]] = await pool.query('SELECT account_status FROM users WHERE id = ?', [criado]);
  assert.equal(row.account_status, 'ativo');
  // devolve ao estado inicial para os próximos testes
  await patch('gestor', { account_status: 'pendente', reason: 'reset do teste' });
});

test('gestor NÃO pode alterar o nível administrativo', async () => {
  const r = await patch('gestor', { admin_level: 'superadmin' });
  assert.equal(r.status, 403, 'gestor mudando nível é a escalada que a capability impede');
  const [[row]] = await pool.query('SELECT admin_level FROM users WHERE id = ?', [criado]);
  assert.equal(row.admin_level, null, 'o nível precisa ter ficado intacto');
});

test('admin sem nível não pode nem ativar nem mudar nível', async () => {
  const semNivel = await patch(null, { account_status: 'ativo', reason: 'teste' });
  assert.equal(semNivel.status, 403, 'admin sem nível não pode gerenciar usuários');
});

test('superadmin pode atribuir nível — e a regra de rank o impede de rebaixar', async () => {
  // Atribuir o MESMO nível passa…
  const mesmo = await patch('superadmin', { admin_level: 'superadmin' });
  assert.equal(mesmo.status, 200, `superadmin deveria poder: ${JSON.stringify(mesmo.body)}`);
  let [[row]] = await pool.query('SELECT admin_level FROM users WHERE id = ?', [criado]);
  assert.equal(row.admin_level, 'superadmin');

  // …e atribuir um nível abaixo do próprio é barrado pela regra de rank.
  // Regra pré-existente, mantida de propósito: só o superadmin cria
  // superadmin, e quem não é superadmin não precisa criar nada abaixo de si.
  const abaixo = await patch('superadmin', { admin_level: 'gestor' });
  assert.equal(abaixo.status, 403);
  assert.match(abaixo.body.error, /abaixo do seu/i);

  [[row]] = await pool.query('SELECT admin_level FROM users WHERE id = ?', [criado]);
  assert.equal(row.admin_level, 'superadmin', 'o nível recusado não pode ter sido gravado');
});

test('a rota de níveis usa a capability, não um if solto no controller', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'routes', 'admin.users.routes.js'),
    'utf8'
  );
  // A checagem fica dentro do handler, não no middleware da rota: o payload
  // decide. 'users' cobre status/cargo (inclusive para gestor) e 'admins'
  // cobre só a mudança de nível.
  assert.match(
    src,
    /if \(admin_level !== undefined\) \{\s*\r?\n\s*if \(!pode\('admins'/,
    "mudar admin_level deveria passar por pode('admins', …)"
  );
  assert.ok(
    !/req\.user\.admin_level !== 'superadmin'/.test(src),
    'o if solto no controller foi substituído pela capability'
  );
  // E LEVEL_RANK não pode degradar para gestor.
  assert.ok(
    !/LEVEL_RANK\[[^\]]+\]\s*\?\?\s*LEVEL_RANK\.gestor/.test(src),
    'o nível ausente não pode virar gestor no cálculo de rank'
  );
  assert.ok(
    !/router\.patch\('\/:id',\s*requireCapability\('admins'\)/.test(src),
    "exigir 'admins' na rota inteira tiraria do gestor o que ele pode fazer"
  );
});