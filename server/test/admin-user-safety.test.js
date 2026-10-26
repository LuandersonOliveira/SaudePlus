/**
 * Regressões de segurança do CRUD de usuários e do escopo do atendente.
 *
 * São checagens de fonte porque o comportamento depende do SQL emitido —
 * um teste de integração cobriria o caminho feliz, mas não impediria alguém
 * de reintroduzir o `profId ? WHERE : ''` (fail-open) ou o soft delete sem
 * filtro numa refatoração. Cada asserção aponta o defeito que ela trava.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..', '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

const USERS = ler('server/src/routes/admin.users.routes.js');
const STAFF = ler('server/src/routes/staff.routes.js');
const ADMIN = ler('server/src/routes/admin.routes.js');
const MIGRATE_ALL = ler('server/package.json');
const DOCTOR = ler('scripts/doctor.js');
const LINK_SCRIPT = ler('server/scripts/link-professionals-to-users.js');
const CLEAN_SCRIPT = ler('server/scripts/clean-db-keep-admin.js');

test('soft delete não reaparece na listagem nem na contagem do admin', () => {
  assert.match(
    USERS,
    /const filters = \['deleted_at IS NULL'\]/,
    'a listagem de /admin/users precisa começar filtrando deleted_at'
  );
  assert.match(
    USERS,
    /const whereClause = ' WHERE ' \+ filters\.join\(' AND '\)/,
    'o WHERE não pode desaparecer quando só existe o filtro de soft delete'
  );
});

test('excluir, desativar, rebaixar ou trocar senha revoga sessão e reset pendente', () => {
  assert.match(USERS, /async function revokeAccess\(userId\)/);
  assert.match(USERS, /UPDATE refresh_tokens SET revoked = 1 WHERE user_id = \?/);
  assert.match(USERS, /UPDATE password_reset_tokens SET used_at = NOW\(\) WHERE user_id = \?/);
  assert.match(USERS, /const desativa = account_status !== undefined && account_status !== 'ativo'/);
  assert.match(USERS, /const mudaPapel = role !== undefined && role !== currentUser\.role/);
  assert.match(USERS, /const mudaSenha = password !== undefined && password !== ''/);
  assert.match(
    USERS,
    /await revokeAccess\(req\.params\.id\);\s*\n\s*await req\.audit\('admin_delete_user'/,
    'o soft delete precisa revogar antes de registrar a exclusão'
  );
});

test('promover uma conta a admin exige a capability admins', () => {
  assert.match(
    USERS,
    /role === 'admin' && currentUser\.role !== 'admin' && !pode\('admins', req\.user\)/,
    'sem este guard um gestor (que tem users) promovia qualquer conta a admin'
  );
});

test('o router de usuários exporta uma única vez', () => {
  const exports = USERS.match(/module\.exports = router;/g) || [];
  assert.equal(exports.length, 1, 'export duplicado esconde erro de cópia/merge');
});

test('atendente sem vínculo não cai no caminho sem filtro da agenda', () => {
  assert.match(
    STAFF,
    /const where = isAdmin \? '' : 'WHERE a\.professional_id = \?'/,
    'agenda: o WHERE precisa existir sempre que não for admin'
  );
  assert.match(
    STAFF,
    /const where = isAdmin \? '' : 'WHERE e\.professional_id = \?'/,
    'exames: o WHERE precisa existir sempre que não for admin'
  );
  assert.doesNotMatch(
    STAFF,
    /profId \? 'WHERE [ae]\.professional_id = \?' : ''/,
    'fail-open: profissional nulo não pode virar "lista tudo"'
  );
});

test('pacientes excluídos não aparecem para o atendente', () => {
  const bloco = STAFF.slice(STAFF.indexOf("router.get('/patients'"), STAFF.indexOf("router.get('/patients/:id/history'"));
  assert.match(bloco, /role = 'paciente' AND deleted_at IS NULL/);
  assert.match(STAFF, /AND account_status = 'ativo'\s*\n\s*AND deleted_at IS NULL/);
});

test('histórico e métricas do admin ignoram contas excluídas', () => {
  assert.match(ADMIN, /FROM users WHERE id = \? AND deleted_at IS NULL/);
  assert.match(ADMIN, /FROM users WHERE deleted_at IS NULL/);
  assert.match(ADMIN, /FROM users WHERE deleted_at IS NULL`\)/, 'o CSV também conta só contas vivas');
});

test('migrate:all e doctor conhecem o vínculo profissional↔atendente', () => {
  assert.match(
    MIGRATE_ALL,
    /migrate:v3 && npm run migrate:professional-user && npm run migrate:security/,
    'a migration do vínculo precisa rodar depois de v3 e antes do resto'
  );
  assert.match(DOCTOR, /\['professionals', 'user_id'\]/);
  assert.match(DOCTOR, /'password_reset_tokens'/);
});

test('o script de vínculo não cria conta com senha padrão', () => {
  assert.doesNotMatch(LINK_SCRIPT, /atendente123|DEFAULT_PASS/);
  assert.match(LINK_SCRIPT, /crypto\.randomBytes\(12\)\.toString\('base64url'\)/);
  assert.match(LINK_SCRIPT, /if \(u\.role === 'admin'\)/, 'não pode rebaixar admin por e-mail homônimo');
});

test('o script de limpeza não desliga FK e se recusa a rodar em produção', () => {
  assert.doesNotMatch(CLEAN_SCRIPT, /SET FOREIGN_KEY_CHECKS\s*=\s*0/i);
  assert.match(CLEAN_SCRIPT, /NODE_ENV === 'production'/);
  assert.doesNotMatch(CLEAN_SCRIPT, /'sessions'|'mfa_recovery_codes'|'mfa_attempts'|'consents'|'audit_logs'/,
    'tabelas que não existem não devem aparecer na lista de limpeza');
});
