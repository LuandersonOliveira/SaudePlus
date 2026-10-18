import { test, expect } from '@playwright/test';

/**
 * Login, sessão e a regra da URL única — com navegador de verdade.
 *
 * O contrato no servidor já garante que `POST /auth/login` devolve 200 e o
 * envelope certo. Ele não garante que a página pegue esse envelope, grave a
 * sessão e redirecione para o painel do papel certo. Um erro de sintaxe no
 * script de um painel derrubaria a tela do usuário sem que nenhum teste de
 * servidor falhasse — que é a lacuna que estes testes fecham.
 *
 * As contas vêm do `.env` e do seed (`npm run db:seed`). Só o admin tem
 * credencial garantida pelo ambiente; os demais papéis dependem do seed demo,
 * e por isso os testes que dependem deles são pulados em vez de falharem.
 */
const ADMIN = {
  email: process.env.ADMIN_EMAIL || 'admin@saude.app',
  password: process.env.ADMIN_PASSWORD || '',
};
const semAdmin = !ADMIN.password;

const PAINEIS = [
  { url: 'admin.html', marcador: '#railUserHead' },
  { url: 'atendente.html', marcador: '#userName' },
];

/**
 * Faz login e só retorna quando o POST respondeu.
 *
 * A espera não é vaidade: sem ela o próximo `page.goto()` aborta o fetch em
 * voo, o painel abre antes de a sessão ser gravada no localStorage, e
 * `requireAuth()` joga a página para o login. O teste falhava por corrida,
 * não por defeito — e foi exatamente assim que a primeira versão deste
 * arquivo falhou.
 */
async function entrar(page, email, senha) {
  await page.goto('/auth.html');
  await page.fill('#loginEmail', email);
  await page.fill('#loginPassword', senha);
  const [resposta] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/auth/login') && r.request().method() === 'POST'),
    page.click('#loginForm button[type=submit]'),
  ]);
  return resposta.status();
}

test.describe('login', () => {
  test('admin entra e cai no painel de admin', async ({ page }) => {
    test.skip(semAdmin, 'ADMIN_PASSWORD não está no ambiente');

    expect(await entrar(page, ADMIN.email, ADMIN.password)).toBe(200);
    await expect(page).toHaveURL(/admin\.html$/);
    // O painel renderiza o e-mail do titular: prova que o envelope do login
    // chegou ao front e foi lido, e não só que a resposta foi 200.
    await expect(page.locator('#userEmail')).toHaveText(ADMIN.email);
  });

  test('senha errada não entra em painel nenhum', async ({ page }) => {
    const status = await entrar(page, ADMIN.email || 'ninguem@saude.app', 'senha-errada-de-proposito');

    expect(status).toBe(401);
    // Não pode cair em painel nenhum…
    await expect(page).not.toHaveURL(/(admin|atendente|dashboard)\.html$/);
    // …e precisa dizer algo. Um botão que não faz nada também "não entra",
    // e é justamente esse o defeito que a cobertura estática não vê.
    await expect(page.locator('#toast, .toast, [role=alert], .error, .alert').first()).toBeVisible();
  });

  test('painel sem sessão volta para o login', async ({ page }) => {
    // requireAuth() faz location.replace('auth.html'): o painel não pode
    // renderizar conteúdo para quem não tem sessão.
    await page.goto('/dashboard.html');
    await expect(page).toHaveURL(/auth\.html$/);
  });

  test('a sessão de admin sobrevive ao recarregar', async ({ page }) => {
    test.skip(semAdmin, 'ADMIN_PASSWORD não está no ambiente');

    await entrar(page, ADMIN.email, ADMIN.password);
    await expect(page).toHaveURL(/admin\.html$/);

    await page.reload();
    await expect(page.locator('#railUserHead')).toBeVisible();
    await expect(page.locator('#userEmail')).toHaveText(ADMIN.email);
  });

  test('sair derruba a sessão e volta ao login', async ({ page }) => {
    test.skip(semAdmin, 'ADMIN_PASSWORD não está no ambiente');

    await entrar(page, ADMIN.email, ADMIN.password);
    await expect(page).toHaveURL(/admin\.html$/);

    await page.click('button:has-text("Sair")');
    await expect(page).toHaveURL(/auth\.html$/);

    // Com a sessão fora, o painel precisa recusar de novo.
    await page.goto('/admin.html');
    await expect(page).toHaveURL(/auth\.html$/);
  });
});

test.describe('a URL é uma só', () => {
  test('rota sem extensão redireciona para o .html', async ({ request }) => {
    // Medido no HTTP, sem seguir o redirect: pelo navegador o resultado final
    // seria `/auth.html`, porque o painel carregado em seguida aciona
    // requireAuth() e joga quem não tem sessão para o login. O redirect em si
    // está correto, e é isso que este teste verifica — sem a guarda misturada.
    const res = await request.get('/admin', { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(res.headers().location).toMatch(/\/admin\.html$/);
  });

  test('a home é a landing, e o "Entrar" dela leva ao formulário de login', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('a[href="auth.html"]').first()).toBeVisible();

    await page.click('a[href="auth.html"]');
    await expect(page.locator('#loginForm')).toBeVisible();
  });

  test('os painéis abrem sem erro de JavaScript e sem resposta 4xx', async ({ page }) => {
    test.skip(semAdmin, 'ADMIN_PASSWORD não está no ambiente');

    await entrar(page, ADMIN.email, ADMIN.password);
    await expect(page).toHaveURL(/admin\.html$/);

    const errosJs = [];
    const respostasRuins = [];
    page.on('pageerror', (e) => errosJs.push(String(e)));
    page.on('response', (r) => {
      if (r.status() >= 400) respostasRuins.push(`${r.status()} ${r.request().method()} ${r.url()}`);
    });

    for (const painel of PAINEIS) {
      await page.goto(`/${painel.url}`);
      await expect(page.locator(painel.marcador)).toBeVisible();
      // Um 401 limpa a sessão e joga a página para o login; um 500 deixa o
      // painel em skeleton. Nenhum dos dois é aceitável aqui.
      expect(respostasRuins, `${painel.url} respondeu com erro: ${respostasRuins.join(' | ')}`).toHaveLength(0);
    }

    expect(errosJs, `erro de JS na página: ${errosJs.join(' | ')}`).toHaveLength(0);
  });

  test('o admin não cai no painel do paciente', async ({ page }) => {
    // `dashboard.html:880` manda o admin para o painel administrativo: o
    // painel do paciente é para quem agenda consulta, e um superadmin não
    // deveria chegar nele. A regra existia no código sem nenhum teste.
    test.skip(semAdmin, 'ADMIN_PASSWORD não está no ambiente');

    await entrar(page, ADMIN.email, ADMIN.password);
    await expect(page).toHaveURL(/admin\.html$/);

    await page.goto('/dashboard.html');
    await expect(page).toHaveURL(/admin\.html$/);
  });
});

test.describe('recuperação de senha', () => {
  test('o link no login leva ao pedido do link', async ({ page }) => {
    await page.goto('/auth.html');
    await page.click('#linkRecuperar');

    await expect(page.locator('#forgotForm')).toBeVisible();
    await expect(page.locator('#resetForm')).toBeHidden();
  });

  test('um link com token abre direto o formulário da nova senha, e limpa a URL', async ({ page }) => {
    // O token não pode ficar na barra de endereço: ele sobreviveria no
    // histórico do navegador e em qualquer "copiar endereço".
    await page.goto('/auth.html?tab=reset&token=abc123def456');

    await expect(page.locator('#resetForm')).toBeVisible();
    await expect(page.locator('#forgotForm')).toBeHidden();
    await expect(page).not.toHaveURL(/token=/);
  });

  test('as senhas diferentes são recusadas antes de qualquer chamada', async ({ page }) => {
    await page.goto('/auth.html?tab=reset&token=abc123def456');

    let chamouApi = false;
    await page.route('**/auth/password/reset', (r) => { chamouApi = true; r.continue(); });

    await page.fill('#resetPassword', 'senha-um-123');
    await page.fill('#resetPassword2', 'senha-dois-456');
    await page.click('#resetForm button[type=submit]');

    await expect(page.locator('#toast, .toast, [role=alert]').first()).toBeVisible();
    expect(chamouApi, 'senha que não confere não deve gastar uma redefinição').toBe(false);
  });

  test('a senha é enviada e a pessoa volta para o login', async ({ page }) => {
    // Dublê: sem SMTP configurado a API responde 200 com "não foi possível
    // enviar", e este teste é da TELA, não do envio.
    await page.route('**/auth/password/reset', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      }));

    await page.goto('/auth.html?tab=reset&token=abc123def456');
    await page.fill('#resetPassword', 'senha-nova-123456');
    await page.fill('#resetPassword2', 'senha-nova-123456');
    await page.click('#resetForm button[type=submit]');

    await expect(page.locator('#loginForm')).toBeVisible();
  });

  test('sem SMTP a tela mostra o que a API respondeu, sem prometer envio', async ({ page }) => {
    // A resposta do /forgot é a mesma exista ou não a conta. Se a tela
    // inventasse uma confirmação ("Enviado!"), voltaria a enumerar contas
    // pela UI mesmo com a rota correta.
    await page.route('**/auth/password/forgot', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, message: 'Se houver uma conta com este e-mail, enviaremos um link.' }),
      }));

    await page.goto('/auth.html');
    await page.click('#linkRecuperar');
    await page.fill('#forgotEmail', 'ninguem@exemplo.org');
    await page.click('#forgotForm button[type=submit]');

    const aviso = page.locator('#toast, .toast, [role=alert]').first();
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText('Se houver uma conta');
  });
});