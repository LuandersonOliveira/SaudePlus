import { test, expect } from '@playwright/test';
import { stateOf, vigiar } from './fixtures.js';

/**
 * Login, sessão e guardas de rota do front React — com navegador de verdade.
 *
 * O servidor já garante o contrato de `POST /auth/login`. Estes testes cobrem o que
 * ele não vê: a tela pega o envelope, grava a sessão, leva cada papel ao seu painel,
 * e quem não tem sessão (ou tem o papel errado) não vê conteúdo de outro painel.
 */
const ADMIN = { email: process.env.ADMIN_EMAIL || 'admin@saude.app', password: process.env.ADMIN_PASSWORD || '' };

async function entrar(page, email, senha) {
  await page.goto('/auth');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/auth/login') && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Entrar', exact: true }).click(),
  ]);
  return res.status();
}

test.describe('login', () => {
  test('admin entra e cai no painel de admin com o e-mail visível', async ({ page }) => {
    test.skip(!ADMIN.password, 'ADMIN_PASSWORD não está no ambiente');
    expect(await entrar(page, ADMIN.email, ADMIN.password)).toBe(200);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByText(ADMIN.email).first()).toBeVisible();
  });

  test('senha errada não entra e a tela diz o motivo', async ({ page }) => {
    expect(await entrar(page, ADMIN.email, 'senha-errada-de-proposito')).toBe(401);
    await expect(page).toHaveURL(/\/auth/);
    // Um botão que não faz nada também "não entra": precisa haver mensagem.
    await expect(page.getByText(/inválid|incorret|não foi possível|erro/i).first()).toBeVisible();
  });

  test('painel sem sessão volta para o login', async ({ page }) => {
    for (const rota of ['/dashboard', '/atendente', '/admin']) {
      await page.goto(rota);
      await expect(page, rota).toHaveURL(/\/auth/);
    }
  });

  test('a sessão sobrevive ao recarregar e "Sair" a derruba', async ({ page }) => {
    test.skip(!ADMIN.password, 'ADMIN_PASSWORD não está no ambiente');
    await entrar(page, ADMIN.email, ADMIN.password);
    await expect(page).toHaveURL(/\/admin$/);
    await page.reload();
    await expect(page).toHaveURL(/\/admin$/);

    await page.getByRole('button', { name: 'Sair' }).first().click();
    await expect(page).toHaveURL(/\/auth|\/$/);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/auth/);
  });
});

test.describe('papel errado não vê o painel do outro', () => {
  test.describe('admin', () => {
    test.use({ storageState: stateOf('admin') });
    test('não cai no painel do paciente', async ({ page }) => {
      test.skip(!stateOf('admin'), 'sem sessão de admin');
      await page.goto('/dashboard');
      await expect(page).toHaveURL(/\/admin/);
    });
  });
  test.describe('paciente', () => {
    test.use({ storageState: stateOf('paciente') });
    test('não entra em /admin nem em /atendente', async ({ page }) => {
      test.skip(!stateOf('paciente'), 'sem sessão de paciente');
      for (const rota of ['/admin', '/atendente']) {
        await page.goto(rota);
        await expect(page, rota).toHaveURL(/\/dashboard/);
      }
    });
  });
});

test.describe('páginas públicas', () => {
  test('a home é a landing e "Entrar" leva ao formulário', async ({ page }) => {
    const erros = vigiar(page);
    await page.goto('/');
    await page.getByRole('link', { name: /entrar/i }).first().click();
    await expect(page.getByRole('form', { name: 'Entrar na conta' })).toBeVisible();
    expect(erros).toEqual([]);
  });

  test('a política de privacidade abre e a âncora do DPO existe', async ({ page }) => {
    await page.goto('/privacy#dpo');
    await expect(page.locator('#dpo')).toBeVisible();
  });

  test('"Esqueci minha senha" abre o pedido do link', async ({ page }) => {
    await page.goto('/auth');
    await page.getByRole('button', { name: /esqueci minha senha/i }).click();
    await expect(page.getByRole('form', { name: 'Pedir redefinição de senha' })).toBeVisible();
  });

  test('link com token abre a nova senha e tira o token da URL', async ({ page }) => {
    // O token não pode ficar na barra de endereço: sobreviveria no histórico e em "copiar endereço".
    await page.goto('/auth?tab=reset&token=abc123def456');
    await expect(page.getByLabel(/nova senha/i).first()).toBeVisible();
    await expect(page).not.toHaveURL(/token=/);
  });
});
