/**
 * Formulário de usuário do admin — F0-01, F0-02, F0-03 e F0-06.
 *
 * Defeitos que este teste trava (todos só apareciam no navegador):
 *  - `apiPut` em rotas que só têm `router.patch` -> 404.
 *  - `admin_level` enviado por gestor -> 403 ao salvar qualquer admin.
 *  - `/admin/units` não existe -> seletor de unidade vazio na agenda.
 *  - select de nível visível para quem não tem a capability 'admins'.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const ADMIN = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');

test('salvar usuário usa PATCH, que é o método exposto pela rota', () => {
  assert.doesNotMatch(ADMIN, /apiPut\('\/admin\/users\//, 'PATCH /admin/users/:id não aceita PUT');
  assert.match(ADMIN, /apiPatch\('\/admin\/users\/' \+ encodeURIComponent\(id\), payload\)/);
});

test('admin_level só vai no corpo de quem tem a capability admins', () => {
  assert.match(ADMIN, /if \(payload\.role === 'admin' && can\('admins'\)\) \{\s*payload\.admin_level/);
});

test('select de nível escondido para gestor, mesmo ao editar um admin', () => {
  assert.match(ADMIN, /adminWrap\.style\.display = \(role === 'admin' && can\('admins'\)\)/);
});

test('agenda do atendente carrega unidades da rota real', () => {
  assert.doesNotMatch(ADMIN, /'\/admin\/units'/);
  assert.match(ADMIN, /'\/health-units\/manage'/);
});

test('formulário tem os campos de identidade que a rota passou a aceitar', () => {
  for (const id of ['userFormMobile', 'userFormPhone']) {
    assert.match(ADMIN, new RegExp(`id="${id}"`), `campo ${id} ausente`);
  }
  assert.match(ADMIN, /mobile: document\.getElementById\('userFormMobile'\)\.value\.trim\(\) \|\| null/);
  assert.match(ADMIN, /phone: document\.getElementById\('userFormPhone'\)\.value\.trim\(\) \|\| null/);
});
