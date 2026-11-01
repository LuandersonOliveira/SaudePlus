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

// Desde o passo 8b do A1, o SQL mora em repositories/usuarios.js e as regras em services/adminUsers.js;
// a rota (USERS) só valida, chama o serviço e responde.
const USERS = ler('server/src/routes/admin.users.routes.js');
const USERS_SVC = ler('server/src/services/adminUsers.js');
const USERS_REPO = ler('server/src/repositories/usuarios.js');
const STAFF = ler('server/src/routes/staff.routes.js');
const ADMIN = ler('server/src/routes/admin.routes.js');
const DOCTOR = ler('scripts/doctor.js');
const LINK_SCRIPT = ler('server/scripts/link-professionals-to-users.js');
const CLEAN_SCRIPT = ler('server/scripts/clean-db-keep-admin.js');

test('soft delete não reaparece na listagem nem na contagem do admin', () => {
  assert.match(
    USERS_REPO,
    /const filters = \['deleted_at IS NULL'\]/,
    'a listagem de /admin/users precisa começar filtrando deleted_at'
  );
  assert.match(
    USERS_REPO,
    /const where = ` WHERE \$\{filters\.join\(' AND '\)\}`/,
    'o WHERE não pode desaparecer quando só existe o filtro de soft delete'
  );
  assert.match(USERS_REPO, /SELECT COUNT\(\*\) AS total FROM users u\$\{where\}/, 'a contagem usa o MESMO where da listagem');
});

test('excluir, desativar, rebaixar ou trocar senha revoga sessão e reset pendente', () => {
  assert.match(USERS_REPO, /async function revogarAcesso\(db, userId\)/);
  assert.match(USERS_REPO, /UPDATE refresh_tokens SET revoked = 1 WHERE user_id = \?/);
  assert.match(USERS_REPO, /UPDATE password_reset_tokens SET used_at = NOW\(\) WHERE user_id = \?/);
  assert.match(USERS_SVC, /const desativa = accountStatus !== undefined && accountStatus !== 'ativo'/);
  assert.match(USERS_SVC, /const mudaPapel = role !== undefined && role !== atual\.role/);
  assert.match(USERS_SVC, /const trocaSenha = password !== undefined && password !== ''/);
  assert.match(USERS_SVC, /if \(desativa \|\| mudaPapel \|\| trocaSenha \|\| mudaEmail\) await usuarios\.revogarAcesso\(conn, id\)/);
  assert.match(
    USERS_SVC,
    /await usuarios\.excluirLogicamente\(conn, id\);\s*\n\s*await usuarios\.revogarAcesso\(conn, id\);/,
    'o soft delete precisa revogar o acesso na mesma transação'
  );
  assert.match(
    USERS,
    /svc\.excluirUsuario[\s\S]*await req\.audit\('admin_delete_user'/,
    'a exclusão só é auditada depois de o serviço concluir'
  );
});

test('promover uma conta a admin exige a capability admins', () => {
  // A regra mora em utils/adminHierarchy.js (bloqueioDePapel, testada em admin-hierarchy.test.js);
  // a rota precisa entregar a capability do ator a ela.
  assert.match(
    USERS_SVC,
    /H\.bloqueioDePapel\(\{ actor, alvo: atual, novoPapel: role, podeAdmins \}\)/,
    'sem este guard um gestor (que tem users) promovia qualquer conta a admin'
  );
  assert.match(
    require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'utils', 'adminHierarchy.js'), 'utf8'),
    /novoPapel === 'admin' && alvo\.role !== 'admin' && !podeAdmins/
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

test('doctor conhece o vínculo profissional↔atendente', () => {
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
