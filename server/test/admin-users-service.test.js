/**
 * services/adminUsers.js + schemas/adminUsers.js + repositories (A1, passo 8b).
 * O contrato HTTP segue em admin-user-update, admin-user-safety, admin-appointments-* e capabilities.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

const SERVER = path.resolve(__dirname, '..');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const pool = require('../src/db');
const bcrypt = require(require.resolve('bcryptjs', { paths: [SERVER] }));
const svc = require('../src/services/adminUsers');
const S = require('../src/schemas/adminUsers');
const { encryptField, decryptField } = require('../src/utils/crypto');
const { issueRefreshToken } = require('../src/services/session');

const SENHA = 'senha-de-teste-123';
const USUARIOS = [];
const PROFISSIONAIS = [];
let hash;

test.before(async () => {
  hash = await bcrypt.hash(SENHA, 4);
  ATOR_SUPER = await conta({ role: 'admin', nivel: 'superadmin' });
});
test.after(async () => {
  for (const id of PROFISSIONAIS) await pool.query('DELETE FROM professionals WHERE id = ?', [id]).catch(() => {});
  await pool.query('DELETE FROM professionals WHERE user_id IN (?)', [USUARIOS.length ? USUARIOS : ['x']]).catch(() => {});
  for (const id of USUARIOS) await pool.query('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
  await pool.end().catch(() => {});
});

async function conta({ role = 'paciente', nivel = null, status = 'ativo', cargo = null, extra = {} } = {}) {
  const id = crypto.randomUUID();
  const email = `adm-${id}@test.local`;
  await pool.query(
    'INSERT INTO users (id, full_name, email, password_hash, role, admin_level, account_status, job_role, mobile) VALUES (?,?,?,?,?,?,?,?,?)',
    [id, extra.nome || 'Conta Teste', email, hash, role, nivel, status, cargo, extra.mobile || null]
  );
  USUARIOS.push(id);
  return { id, email, role, admin_level: nivel };
}
async function profissional({ ativo = 1, userId = null, nome = 'Prof Teste' } = {}) {
  const id = crypto.randomUUID();
  await pool.query('INSERT INTO professionals (id, name, active, user_id) VALUES (?,?,?,?)', [id, nome, ativo, userId]);
  PROFISSIONAIS.push(id);
  return id;
}
const linha = async (id) => (await pool.query('SELECT * FROM users WHERE id = ?', [id]))[0][0];
const profDe = async (userId) => (await pool.query('SELECT * FROM professionals WHERE user_id = ?', [userId]))[0][0];
const superadmin = () => conta({ role: 'admin', nivel: 'superadmin' });
const gestor = () => conta({ role: 'admin', nivel: 'gestor' });
let ATOR_SUPER;
const emailNovo = () => `novo-${crypto.randomUUID()}@test.local`;

// ---------------------------------------------------------------------------
// schemas/adminUsers
// ---------------------------------------------------------------------------

test('esquema: criarUsuarioBody recusa na ordem obrigatórios → senha → nome → e-mail → telefones', () => {
  const ok = { full_name: 'Maria Silva', email: 'maria@test.local', password: 'segredo1' };
  const msg = (c) => { const r = S.criarUsuarioBody.safeParse(c); return r.success ? null : r.error.issues[0].message; };
  assert.equal(msg(ok), null);
  for (const faltando of ['full_name', 'email', 'password']) {
    const c = { ...ok }; delete c[faltando];
    assert.equal(msg(c), 'Nome, e-mail e senha são obrigatórios.', faltando);
  }
  assert.equal(msg({ ...ok, password: '123', full_name: 'x' }), 'Senha deve ter pelo menos 6 caracteres.', 'senha antes do nome');
  assert.equal(msg({ ...ok, full_name: 'x', email: 'ruim' }), 'Nome deve ter entre 2 e 150 caracteres.', 'nome antes do e-mail');
  assert.equal(msg({ ...ok, full_name: 'a'.repeat(151) }), 'Nome deve ter entre 2 e 150 caracteres.');
  assert.match(msg({ ...ok, email: 'ruim', mobile: 'x'.repeat(40) }), /e-mail/i, 'e-mail antes dos telefones');
  assert.equal(msg({ ...ok, mobile: 'x'.repeat(31) }), 'Telefone excede o tamanho máximo (30 caracteres).');
  assert.equal(msg({ ...ok, phone: ' '.repeat(40) }), null, 'só espaços vira vazio');
});

test('esquema: validadores soltos', () => {
  assert.equal(S.erroDoNome('  Ana  '), null);
  assert.equal(S.erroDoNome(' a '), 'Nome deve ter entre 2 e 150 caracteres.');
  assert.equal(S.erroDoNome(undefined), 'Nome deve ter entre 2 e 150 caracteres.');
  assert.equal(S.erroDaSenha('12345'), 'Senha deve ter pelo menos 6 caracteres.');
  assert.equal(S.erroDaSenha('123456'), null);
  assert.deepEqual(S.validarEmail('  A@B.Co '), { ok: true, email: 'a@b.co' });
  assert.equal(S.validarEmail('sem-arroba').ok, false);
  assert.equal(S.normalizarTelefone('  '), null);
  assert.equal(S.normalizarTelefone(' 8799 '), '8799');
  assert.equal(S.erroDoTelefone('mobile', 'x'.repeat(31)), 'Campo "mobile" excede o tamanho máximo (30 caracteres).');
  assert.equal(S.erroDoTelefone('phone', 'x'.repeat(30)), null);
});

// ---------------------------------------------------------------------------
// leitura
// ---------------------------------------------------------------------------

test('listarUsuarios: paginação com teto, filtros seguros, busca e sem excluídos nem documentos', async () => {
  const marca = crypto.randomUUID().slice(0, 8);
  const a = await conta({ extra: { nome: `Zélia ${marca}` } });
  const b = await conta({ extra: { nome: `Ana ${marca}` }, role: 'atendente' });
  const excluida = await conta({ extra: { nome: `Fantasma ${marca}` } });
  await pool.query('UPDATE users SET deleted_at = NOW() WHERE id = ?', [excluida.id]);

  const r = await svc.listarUsuarios({ q: marca });
  assert.deepEqual(r.data.map((u) => u.id), [b.id, a.id], 'ordenado por nome; excluída fora');
  assert.equal(r.total, 2);
  assert.ok(!('cpf' in r.data[0]) && !('password_hash' in r.data[0]), 'lista sem documentos nem credenciais');

  assert.equal((await svc.listarUsuarios({ q: marca, role: 'atendente' })).total, 1);
  assert.equal((await svc.listarUsuarios({ q: marca, role: 'invalido' })).total, 2, 'filtro desconhecido é ignorado, não vira SQL');
  assert.equal((await svc.listarUsuarios({ q: marca.toUpperCase() })).total, 2, 'busca sem caixa');

  const p1 = await svc.listarUsuarios({ q: marca, pageSize: '1', page: '2' });
  assert.deepEqual([p1.page, p1.pageSize, p1.total, p1.data.length, p1.data[0].id], [2, 1, 2, 1, a.id]);
  assert.equal((await svc.listarUsuarios({ pageSize: '9999' })).pageSize, 100, 'teto de 100');
  assert.equal((await svc.listarUsuarios({ page: '-4', pageSize: 'x' })).page, 1);
});

test('obterUsuario: documentos decifrados; chave ausente vira aviso; excluída ou inexistente é 404', async () => {
  const u = await conta();
  await pool.query('UPDATE users SET cpf = ?, rg = ? WHERE id = ?', [encryptField('52998224725'), encryptField('1234567'), u.id]);
  const r = await svc.obterUsuario(u.id, { decrypt: decryptField });
  assert.equal(r.user.cpf, '52998224725');
  assert.equal(r.user.rg, '1234567');
  assert.ok(!('password_hash' in r.user));

  const sem = await svc.obterUsuario(u.id, { decrypt: () => { throw new Error('sem chave'); } });
  assert.equal(sem.user.cpf, '[ilegível: chave ausente]');

  await pool.query('UPDATE users SET deleted_at = NOW() WHERE id = ?', [u.id]);
  assert.deepEqual(await svc.obterUsuario(u.id, { decrypt: decryptField }), { ok: false, status: 404, error: 'Usuário não encontrado.' });
  assert.equal((await svc.obterUsuario(crypto.randomUUID(), { decrypt: decryptField })).status, 404);
});

// ---------------------------------------------------------------------------
// criação
// ---------------------------------------------------------------------------

test('criarUsuario: paciente por padrão, atendente nasce pendente com profissional criado e vinculado', async () => {
  const p = await svc.criarUsuario({ actor: ATOR_SUPER, body: { full_name: ' Paula Paciente ', email: ` ${emailNovo().toUpperCase()} `, password: 'segredo1' }, podeAdmins: false });
  assert.equal(p.ok, true);
  USUARIOS.push(p.id);
  const up = await linha(p.id);
  assert.deepEqual([up.role, up.account_status, up.admin_level, up.full_name], ['paciente', 'ativo', null, 'Paula Paciente']);
  assert.equal(await bcrypt.compare('segredo1', up.password_hash), true);
  assert.match(p.auditoria, /^criado: role=paciente status=ativo$/);

  const a = await svc.criarUsuario({ actor: ATOR_SUPER, body: { full_name: 'Alice Atendente', email: emailNovo(), password: 'segredo1', role: 'atendente', job_role: 'Recepção' }, podeAdmins: false });
  USUARIOS.push(a.id);
  assert.equal((await linha(a.id)).account_status, 'pendente');
  const pa = await profDe(a.id);
  assert.deepEqual([pa.name, pa.job_title, Number(pa.active)], ['Alice Atendente', 'Recepção', 1]);
});

test('criarUsuario: papel desconhecido vira paciente; admin exige a capability; nível inválido → 400', async () => {
  const x = await svc.criarUsuario({ actor: ATOR_SUPER, body: { full_name: 'Xavier', email: emailNovo(), password: 'segredo1', role: 'rei' }, podeAdmins: false });
  USUARIOS.push(x.id);
  assert.equal((await linha(x.id)).role, 'paciente');

  assert.deepEqual(await svc.criarUsuario({ actor: ATOR_SUPER, body: { full_name: 'Yara', email: emailNovo(), password: 'segredo1', role: 'admin' }, podeAdmins: false }),
    { ok: false, status: 403, error: 'Sem permissão para criar administradores.' });
  const nivelRuim = await svc.criarUsuario({ actor: ATOR_SUPER, body: { full_name: 'Zeca', email: emailNovo(), password: 'segredo1', role: 'admin', admin_level: 'rei' }, podeAdmins: true });
  assert.deepEqual([nivelRuim.status, nivelRuim.error], [400, 'Nível administrativo inválido.']);

  const adm = await svc.criarUsuario({ actor: ATOR_SUPER, body: { full_name: 'Wanda Admin', email: emailNovo(), password: 'segredo1', role: 'admin' }, podeAdmins: true });
  USUARIOS.push(adm.id);
  assert.equal((await linha(adm.id)).admin_level, 'gestor', 'sem nível informado, gestor');
});

test('criarUsuario: e-mail repetido (inclusive de conta EXCLUÍDA) → 409', async () => {
  const existente = await conta();
  const dup = await svc.criarUsuario({ actor: ATOR_SUPER, body: { full_name: 'Dupla', email: existente.email.toUpperCase(), password: 'segredo1' }, podeAdmins: false });
  assert.deepEqual([dup.status, dup.error], [409, 'E-mail já cadastrado.']);
  await pool.query('UPDATE users SET deleted_at = NOW() WHERE id = ?', [existente.id]);
  assert.equal((await svc.criarUsuario({ actor: ATOR_SUPER, body: { full_name: 'Dupla', email: existente.email, password: 'segredo1' }, podeAdmins: false })).status, 409, 'o e-mail excluído segue reservado');
});

test('criarUsuario: vínculo inválido NÃO deixa usuário órfão (inativo, inexistente ou já de outro)', async () => {
  const dono = await conta({ role: 'atendente' });
  const comDono = await profissional({ userId: dono.id });
  const inativo = await profissional({ ativo: 0 });
  for (const [pid, msg] of [[inativo, /não encontrado ou inativo/], [crypto.randomUUID(), /não encontrado ou inativo/], [comDono, /já vinculado/]]) {
    const email = emailNovo();
    const r = await svc.criarUsuario({ actor: ATOR_SUPER, body: { full_name: 'Sem Vaga', email, password: 'segredo1', role: 'atendente', professional_id: pid }, podeAdmins: false });
    assert.equal(r.status, 400);
    assert.match(r.error, msg);
    assert.equal((await pool.query('SELECT 1 FROM users WHERE email = ?', [email]))[0].length, 0, 'a conta não foi criada');
  }
  const livre = await profissional();
  const ok = await svc.criarUsuario({ actor: ATOR_SUPER, body: { full_name: 'Com Vaga', email: emailNovo(), password: 'segredo1', role: 'atendente', professional_id: livre }, podeAdmins: false });
  USUARIOS.push(ok.id);
  assert.equal((await profDe(ok.id)).id, livre, 'vincula o profissional informado em vez de criar outro');
});

// ---------------------------------------------------------------------------
// edição
// ---------------------------------------------------------------------------

test('atualizarUsuario: 404; hierarquia e credenciais de admin antes da validação dos campos', async () => {
  const ator = await gestor();
  assert.equal((await svc.atualizarUsuario({ actor: ator, id: crypto.randomUUID(), body: { job_role: 'x' }, podeAdmins: false })).status, 404);

  const alvoAdmin = await conta({ role: 'admin', nivel: 'gestor' }); // mesmo nível do ator
  const r = await svc.atualizarUsuario({ actor: ator, id: alvoAdmin.id, body: { full_name: 'x' /* inválido */ }, podeAdmins: false });
  assert.equal(r.status, 403, 'a hierarquia vence o 400 do nome');

  const menor = await conta({ role: 'admin', nivel: 'alertas' });
  const cred = await svc.atualizarUsuario({ actor: ator, id: menor.id, body: { password: 'novasenha1' }, podeAdmins: false });
  assert.equal(cred.status, 403);
  assert.match(cred.error, /e-mail ou senha de administradores/);
  const igual = await svc.atualizarUsuario({ actor: ator, id: menor.id, body: { email: menor.email.toUpperCase(), mobile: '8799' }, podeAdmins: false });
  assert.equal(igual.ok, true, 'reenviar o MESMO e-mail não conta como troca');
});

test('atualizarUsuario: campos, auditoria e revogação de acesso', async () => {
  const ator = await superadmin();
  const alvo = await conta({ extra: { nome: 'Nome Velho', mobile: '111' } });
  const sessao = await issueRefreshToken(alvo.id);

  const r1 = await svc.atualizarUsuario({ actor: ator, id: alvo.id, body: { full_name: 'Nome Novo', mobile: '', job_role: 'Cargo X', reason: 'pedido do titular' }, podeAdmins: true });
  assert.equal(r1.ok, true);
  assert.match(r1.auditoria, /^nome alterado; celular alterado; cargo: -+>Cargo X/);
  assert.match(r1.auditoria, /motivo: pedido do titular/);
  const u1 = await linha(alvo.id);
  assert.deepEqual([u1.full_name, u1.mobile, u1.job_role], ['Nome Novo', null, 'Cargo X']);
  const [[rt1]] = await pool.query('SELECT revoked FROM refresh_tokens WHERE token_hash = ?', [require('../src/services/session').hashRefreshToken(sessao.raw)]);
  assert.equal(Number(rt1.revoked), 0, 'editar nome/telefone/cargo não derruba a sessão');

  const r2 = await svc.atualizarUsuario({ actor: ator, id: alvo.id, body: { account_status: 'inativo' }, podeAdmins: true });
  assert.match(r2.auditoria, /status: ativo->inativo/);
  const [[rt2]] = await pool.query('SELECT revoked FROM refresh_tokens WHERE token_hash = ?', [require('../src/services/session').hashRefreshToken(sessao.raw)]);
  assert.equal(Number(rt2.revoked), 1, 'desativar derruba a sessão');

  assert.equal((await svc.atualizarUsuario({ actor: ator, id: alvo.id, body: {}, podeAdmins: true })).auditoria, 'atualização');
});

test('atualizarUsuario: validações por campo e proteções da própria conta', async () => {
  const ator = await superadmin();
  const alvo = await conta();
  const tenta = async (body, id = alvo.id) => svc.atualizarUsuario({ actor: ator, id, body, podeAdmins: true });
  assert.equal((await tenta({ full_name: 'a' })).error, 'Nome deve ter entre 2 e 150 caracteres.');
  assert.match((await tenta({ email: 'ruim' })).error, /e-mail/i);
  assert.equal((await tenta({ mobile: 'x'.repeat(31) })).error, 'Campo "mobile" excede o tamanho máximo (30 caracteres).');
  assert.equal((await tenta({ account_status: 'voando' })).error, 'Status inválido.');
  assert.equal((await tenta({ role: 'rei' })).error, 'Papel inválido.');
  assert.equal((await tenta({ password: '123' })).error, 'Senha deve ter pelo menos 6 caracteres.');
  // Conta própria: mensagem clara (400), checada ANTES da hierarquia de nível igual (que daria 403).
  assert.deepEqual(await tenta({ account_status: 'inativo' }, ator.id), { ok: false, status: 400, error: 'Você não pode alterar o status da própria conta.' });
  assert.deepEqual(await tenta({ role: 'paciente' }, ator.id), { ok: false, status: 400, error: 'Você não pode alterar o próprio papel.' });
  // …e os outros campos da própria conta continuam sob a hierarquia (admin de nível igual a si mesmo: 403).
  assert.equal((await tenta({ job_role: 'x' }, ator.id)).status, 403);
  const outro = await conta();
  const uso = await tenta({ email: outro.email.toUpperCase() });
  assert.deepEqual([uso.status, uso.error], [409, 'Este e-mail já está em uso por outra conta.']);
  assert.equal((await linha(alvo.id)).email, alvo.email, 'nada foi gravado');
});

test('atualizarUsuario: promover/rebaixar e nível seguem a hierarquia, e recusa não deixa meia gravação', async () => {
  const ger = await gestor();
  const alvo = await conta({ extra: { nome: 'Alvo' } });
  const promo = await svc.atualizarUsuario({ actor: ger, id: alvo.id, body: { job_role: 'Novo cargo', role: 'admin' }, podeAdmins: false });
  assert.equal(promo.status, 403);
  assert.equal((await linha(alvo.id)).job_role, null, 'o cargo, validado antes, não foi gravado: a recusa vem antes do UPDATE');

  const sup = await superadmin();
  const ok = await svc.atualizarUsuario({ actor: sup, id: alvo.id, body: { role: 'admin', admin_level: 'superadmin' }, podeAdmins: true });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.deepEqual([(await linha(alvo.id)).role, (await linha(alvo.id)).admin_level], ['admin', 'superadmin']);
  // O superadmin atribui níveis abaixo do próprio (a regra bloqueia só o nível ACIMA do ator).
  const outro = await conta();
  const abaixo = await svc.atualizarUsuario({ actor: sup, id: outro.id, body: { admin_level: 'alertas' }, podeAdmins: true });
  assert.equal(abaixo.ok, true, JSON.stringify(abaixo));
  assert.equal((await linha(outro.id)).admin_level, 'alertas');
  // Nível acima do ator: quem tem 'admins' mas não é o topo (hipótese, hoje só o superadmin tem) é barrado.
  const gerente = await gestor();
  const acima = await svc.atualizarUsuario({ actor: gerente, id: (await conta()).id, body: { admin_level: 'superadmin' }, podeAdmins: true });
  assert.deepEqual([acima.status, acima.error], [403, 'Você não pode definir um nível acima do seu.']);
  const invalido = await svc.atualizarUsuario({ actor: sup, id: (await conta()).id, body: { admin_level: 'rei' }, podeAdmins: true });
  assert.equal(invalido.status, 400);
  // e o alvo já virou superadmin (nível igual ao do ator): daí em diante, é intocável
  assert.equal((await svc.atualizarUsuario({ actor: sup, id: alvo.id, body: { job_role: 'x' }, podeAdmins: true })).status, 403);
});

test('atualizarUsuario: vínculo INVÁLIDO é recusado ANTES de gravar — a conta não muda e a sessão não cai (o defeito corrigido)', async () => {
  const ator = await superadmin();
  const alvo = await conta({ role: 'atendente', extra: { nome: 'Antes' } });
  const sessao = await issueRefreshToken(alvo.id);
  const inativo = await profissional({ ativo: 0 });

  const r = await svc.atualizarUsuario({
    actor: ator, id: alvo.id, podeAdmins: true,
    body: { full_name: 'Depois', account_status: 'inativo', password: 'novasenha1', professional_id: inativo },
  });
  assert.deepEqual([r.ok, r.status, r.error], [false, 400, 'Profissional não encontrado ou inativo.']);
  const u = await linha(alvo.id);
  assert.equal(u.full_name, 'Antes', 'nome não mudou');
  assert.equal(u.account_status, 'ativo', 'status não mudou');
  assert.equal(await bcrypt.compare(SENHA, u.password_hash), true, 'senha não mudou');
  const [[rt]] = await pool.query('SELECT revoked FROM refresh_tokens WHERE token_hash = ?', [require('../src/services/session').hashRefreshToken(sessao.raw)]);
  assert.equal(Number(rt.revoked), 0, 'e a sessão continua de pé');

  const dono = await conta({ role: 'atendente' });
  const comDono = await profissional({ userId: dono.id });
  assert.match((await svc.atualizarUsuario({ actor: ator, id: alvo.id, body: { professional_id: comDono }, podeAdmins: true })).error, /já vinculado/);
});

test('atualizarUsuario: vínculo atendente ↔ profissional segue o papel final', async () => {
  const ator = await superadmin();
  const a = await conta({ role: 'atendente', extra: { nome: 'Atendente A' } });
  // atendente sem profissional ganha um automaticamente
  await svc.atualizarUsuario({ actor: ator, id: a.id, body: { job_role: 'Triagem' }, podeAdmins: true });
  const auto = await profDe(a.id);
  assert.equal(auto.name, 'Atendente A');
  PROFISSIONAIS.push(auto.id);
  // trocar de profissional
  const outro = await profissional({ nome: 'Outro' });
  await svc.atualizarUsuario({ actor: ator, id: a.id, body: { professional_id: outro }, podeAdmins: true });
  assert.equal((await profDe(a.id)).id, outro);
  assert.equal((await pool.query('SELECT user_id FROM professionals WHERE id = ?', [auto.id]))[0][0].user_id, null, 'o anterior foi solto');
  // desvincular explicitamente
  const r = await svc.atualizarUsuario({ actor: ator, id: a.id, body: { unlink_professional: true }, podeAdmins: true });
  assert.match(r.auditoria, /profissional desvinculado/);
  assert.equal(await profDe(a.id), undefined);
  // deixar de ser atendente solta o profissional
  await svc.atualizarUsuario({ actor: ator, id: a.id, body: { professional_id: outro }, podeAdmins: true });
  assert.equal((await profDe(a.id)).id, outro);
  await svc.atualizarUsuario({ actor: ator, id: a.id, body: { role: 'paciente' }, podeAdmins: true });
  assert.equal(await profDe(a.id), undefined);
});

// ---------------------------------------------------------------------------
// exclusão
// ---------------------------------------------------------------------------

test('excluirUsuario: ANONIMIZA (ADR-0009), solta o profissional, derruba o acesso; respeita a hierarquia', async () => {
  const ger = await gestor();
  assert.equal((await svc.excluirUsuario({ actor: ger, id: ger.id })).error, 'Você não pode excluir a própria conta.');
  assert.equal((await svc.excluirUsuario({ actor: ger, id: crypto.randomUUID() })).status, 404);
  const par = await conta({ role: 'admin', nivel: 'gestor' });
  assert.equal((await svc.excluirUsuario({ actor: ger, id: par.id })).status, 403);

  const at = await conta({ role: 'atendente', extra: { nome: 'Sai Fora' } });
  await pool.query(
    "UPDATE users SET govbr_sub = 'sub-teste', consent_ip = '10.0.0.9', totp_secret = 'segredo', totp_enabled = 1, mobile = '81999990000' WHERE id = ?",
    [at.id]
  );
  const prof = await profissional({ userId: at.id });
  const sessao = await issueRefreshToken(at.id);
  const r = await svc.excluirUsuario({ actor: ger, id: at.id });
  assert.equal(r.ok, true);
  assert.match(r.auditoria, /^excluído \(anonimização\): role=atendente$/);
  const depois = await linha(at.id);
  assert.ok(depois.deleted_at);
  assert.equal(depois.full_name, 'Titular removido', 'o nome some');
  assert.equal(depois.email, `removido_${at.id}@removido.local`, 'o e-mail deixa de identificar');
  assert.equal(depois.account_status, 'inativo');
  for (const coluna of ['mobile', 'phone', 'govbr_sub', 'consent_ip', 'totp_secret', 'cpf', 'cpf_hmac', 'job_role']) {
    assert.equal(depois[coluna], null, `${coluna} precisa ser zerado`);
  }
  assert.equal(Number(depois.totp_enabled), 0);
  const [[trilha]] = await pool.query(
    "SELECT actor_id FROM audit_log WHERE action = 'lgpd_delete' AND entity_id = ? ORDER BY seq DESC LIMIT 1",
    [at.id]
  );
  assert.equal(trilha.actor_id, ger.id, 'a eliminação consta em nome de quem a pediu (o admin)');
  assert.equal((await pool.query('SELECT user_id FROM professionals WHERE id = ?', [prof]))[0][0].user_id, null);
  const [[rt]] = await pool.query('SELECT revoked FROM refresh_tokens WHERE token_hash = ?', [require('../src/services/session').hashRefreshToken(sessao.raw)]);
  assert.equal(Number(rt.revoked), 1);
  assert.equal((await svc.excluirUsuario({ actor: ger, id: at.id })).status, 404, 'já excluída');
});
