/**
 * utils/adminHierarchy.js (A1, passo 8a): a hierarquia de privilégio entre administradores,
 * em tabela, sem banco. O contrato HTTP segue em admin-user-update e admin-user-safety.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../src/utils/adminHierarchy');

const NIVEIS = ['superadmin', 'gestor', 'atendimento', 'alertas'];
const admin = (nivel) => ({ role: 'admin', admin_level: nivel });
const paciente = { role: 'paciente', admin_level: null };

test('rankDe: ordem superadmin > gestor > atendimento > alertas; ausente ou desconhecido vale 0', () => {
  assert.deepEqual(NIVEIS.map(H.rankDe), [4, 3, 2, 1]);
  for (const v of [undefined, null, '', 'root', 'GESTOR']) assert.equal(H.rankDe(v), 0, String(v));
  assert.equal(H.actorRank(admin('gestor')), 3);
  assert.equal(H.actorRank(null), 0);
  assert.equal(H.actorRank(undefined), 0);
});

test('alvo admin SEM nível nunca é tratado como gestor (o fail-open que existiu)', () => {
  const semNivel = { role: 'admin', admin_level: null };
  // rank 0: um 'alertas' (1) está acima dele, mas ninguém "herda" gestor por omissão
  assert.equal(H.atorSuperaAlvo(admin('alertas'), semNivel), true);
  assert.equal(H.atorSuperaAlvo({ role: 'admin', admin_level: null }, semNivel), false, 'ator sem nível também vale 0');
});

test('bloqueioPorHierarquia: matriz completa ator × alvo admin (só quem está ESTRITAMENTE acima altera)', () => {
  for (const ator of NIVEIS) {
    for (const alvo of NIVEIS) {
      const esperado = H.rankDe(ator) > H.rankDe(alvo) ? null : 403;
      const r = H.bloqueioPorHierarquia(admin(ator), admin(alvo));
      assert.equal(r ? r.status : null, esperado, `${ator} sobre ${alvo}`);
      if (r) assert.match(r.error, /igual ou superior ao seu/);
    }
  }
});

test('bloqueioPorHierarquia: alvo que não é admin nunca é barrado pela hierarquia', () => {
  for (const ator of NIVEIS) {
    assert.equal(H.bloqueioPorHierarquia(admin(ator), paciente), null);
    assert.equal(H.bloqueioPorHierarquia(admin(ator), { role: 'atendente', admin_level: 'superadmin' }), null, 'nível residual de quem deixou de ser admin não conta');
  }
});

test('bloqueioDeExclusao: mesma matriz, mensagem própria', () => {
  for (const ator of NIVEIS) {
    for (const alvo of NIVEIS) {
      const r = H.bloqueioDeExclusao(admin(ator), admin(alvo));
      assert.equal(Boolean(r), H.rankDe(ator) <= H.rankDe(alvo), `${ator} exclui ${alvo}`);
      if (r) assert.deepEqual(r, { status: 403, error: 'Você não pode excluir um administrador igual ou superior.' });
    }
    assert.equal(H.bloqueioDeExclusao(admin(ator), paciente), null);
  }
});

test('emailMudou: ignora caixa, espaços e e-mail igual reenviado pelo formulário', () => {
  assert.equal(H.emailMudou(undefined, 'a@b.c'), false, 'campo ausente');
  assert.equal(H.emailMudou('A@B.C', 'a@b.c'), false);
  assert.equal(H.emailMudou('  a@b.c ', 'a@b.c'), false);
  assert.equal(H.emailMudou('outro@b.c', 'a@b.c'), true);
  assert.equal(H.emailMudou(null, 'a@b.c'), true, 'null explícito é pedido de limpar: conta como mudança');
  assert.equal(H.emailMudou('x@y.z', null), true);
});

test('bloqueioDeCredenciais: só ADMIN, só se mudou e-mail/senha, e só sem a capability admins', () => {
  const alvo = admin('atendimento');
  const base = { alvo, trocaEmail: false, trocaSenha: false, podeAdmins: false };
  assert.equal(H.bloqueioDeCredenciais(base), null, 'nada de credencial mudou');
  assert.equal(H.bloqueioDeCredenciais({ ...base, trocaEmail: true })?.status, 403);
  assert.equal(H.bloqueioDeCredenciais({ ...base, trocaSenha: true })?.status, 403);
  assert.match(H.bloqueioDeCredenciais({ ...base, trocaSenha: true }).error, /e-mail ou senha de administradores/);
  assert.equal(H.bloqueioDeCredenciais({ ...base, trocaEmail: true, trocaSenha: true, podeAdmins: true }), null, 'superadmin pode');
  assert.equal(H.bloqueioDeCredenciais({ ...base, alvo: paciente, trocaEmail: true, trocaSenha: true }), null, 'conta que não é admin');
});

test('bloqueioDePapel: promover a admin exige admins; rebaixar admin exige estar acima', () => {
  // promoção
  for (const podeAdmins of [true, false]) {
    const r = H.bloqueioDePapel({ actor: admin('gestor'), alvo: paciente, novoPapel: 'admin', podeAdmins });
    assert.equal(Boolean(r), !podeAdmins);
    if (r) assert.match(r.error, /não permite criar administradores/);
  }
  // quem já é admin e continua admin: não é "promoção"
  assert.equal(H.bloqueioDePapel({ actor: admin('gestor'), alvo: admin('alertas'), novoPapel: 'admin', podeAdmins: false }), null);
  // rebaixamento: matriz
  for (const ator of NIVEIS) {
    for (const alvo of NIVEIS) {
      const r = H.bloqueioDePapel({ actor: admin(ator), alvo: admin(alvo), novoPapel: 'paciente', podeAdmins: true });
      assert.equal(Boolean(r), H.rankDe(ator) <= H.rankDe(alvo), `${ator} rebaixa ${alvo}`);
      if (r) assert.match(r.error, /rebaixar um administrador igual ou superior/);
    }
  }
  // trocar papel de quem não é admin entre paciente/atendente não passa por aqui
  assert.equal(H.bloqueioDePapel({ actor: admin('alertas'), alvo: paciente, novoPapel: 'atendente', podeAdmins: false }), null);
});

test('bloqueioDeNivel: ordem das recusas é capability → nível válido → não abaixo do próprio', () => {
  const gestor = admin('gestor');
  assert.deepEqual(H.bloqueioDeNivel({ actor: gestor, novoNivel: 'gestor', podeAdmins: false }),
    { status: 403, error: 'Seu nível administrativo não permite alterar níveis de outros administradores.' });
  assert.deepEqual(H.bloqueioDeNivel({ actor: gestor, novoNivel: 'rei', podeAdmins: false })?.status, 403, 'sem capability vence a validade');
  assert.deepEqual(H.bloqueioDeNivel({ actor: gestor, novoNivel: 'rei', podeAdmins: true }),
    { status: 400, error: 'Nível administrativo inválido.' });
  assert.deepEqual(H.bloqueioDeNivel({ actor: admin('superadmin'), novoNivel: 'rei', podeAdmins: true })?.status, 400);
});

test('bloqueioDeNivel: ninguém define um nível abaixo do próprio (matriz)', () => {
  for (const ator of NIVEIS) {
    for (const nivel of NIVEIS) {
      const r = H.bloqueioDeNivel({ actor: admin(ator), novoNivel: nivel, podeAdmins: true });
      const abaixo = H.rankDe(nivel) < H.rankDe(ator);
      assert.equal(Boolean(r), abaixo, `${ator} define ${nivel}`);
      if (r) assert.deepEqual(r, { status: 403, error: 'Você não pode definir um nível abaixo do seu.' });
    }
  }
});

test('bloqueioDeCriacaoDeAdmin: só admin exige a capability', () => {
  assert.equal(H.bloqueioDeCriacaoDeAdmin('paciente', false), null);
  assert.equal(H.bloqueioDeCriacaoDeAdmin('atendente', false), null);
  assert.equal(H.bloqueioDeCriacaoDeAdmin('admin', true), null);
  assert.deepEqual(H.bloqueioDeCriacaoDeAdmin('admin', false), { status: 403, error: 'Sem permissão para criar administradores.' });
});

test('as listas SAFE_* batem com o schema e com a tabela de níveis', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  const bloco = /CREATE TABLE IF NOT EXISTS\s+users\s*\([\s\S]*?\) ENGINE/i.exec(schema)[0];
  const enumDe = (coluna) => new RegExp(`\\b${coluna}\\s+ENUM\\s*\\(([^)]*)\\)`, 'i').exec(bloco)[1]
    .split(',').map((s) => s.trim().replace(/^'(.*)'$/, '$1')).filter(Boolean);
  assert.deepEqual([...H.SAFE_ROLES].sort(), enumDe('role').sort());
  assert.deepEqual([...H.SAFE_STATUSES].sort(), enumDe('account_status').sort());
  assert.deepEqual([...H.SAFE_ADMIN_LEVELS].sort(), enumDe('admin_level').sort());
  assert.deepEqual(Object.keys(H.LEVEL_RANK).sort(), [...H.SAFE_ADMIN_LEVELS].sort(), 'todo nível tem rank');
});

test('as rotas usam o módulo de hierarquia (a comparação de rank não voltou para dentro delas)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'admin.users.routes.js'), 'utf8');
  assert.match(fonte, /adminHierarchy/);
  assert.doesNotMatch(fonte, /LEVEL_RANK|rankDe\(|actorRank\(/, 'rank só em utils/adminHierarchy.js');
});
