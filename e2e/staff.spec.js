import { test, expect } from '@playwright/test';
import { stateOf, vigiar, semRolagemHorizontal } from './fixtures.js';

/**
 * Painel do atendente (React) contra a API real. A conta é criada pelo globalSetup
 * (senha aleatória por execução); sem ela os testes são pulados.
 */
test.use({ storageState: stateOf('atendente') });
test.skip(!stateOf('atendente'), 'sem sessão de atendente (ver e2e/global-setup.js)');

const SECOES = [
  ['/atendente', 'Fila do dia'],
  ['/atendente/agenda', 'Agenda'],
  ['/atendente/agendamentos', 'Agendamentos'],
  ['/atendente/pacientes', 'Buscar paciente'],
  ['/atendente/conta', 'Minha conta'],
];

test('todas as seções abrem sem erro de JS nem 4xx', async ({ page }) => {
  const erros = vigiar(page);
  for (const [rota] of SECOES) {
    await page.goto(rota);
    await page.waitForLoadState('networkidle');
    await expect(page, rota).toHaveURL(new RegExp(`${rota}$`));
  }
  expect(erros).toEqual([]);
});

test('o menu lateral leva a cada seção', async ({ page }) => {
  await page.goto('/atendente');
  const nav = page.getByRole('navigation').first();
  for (const [rota, nome] of SECOES.slice(1)) {
    await nav.getByRole('link', { name: nome, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${rota}$`));
  }
});

test('endereço inexistente volta para a fila', async ({ page }) => {
  await page.goto('/atendente/nao-existe');
  await expect(page).toHaveURL(/\/atendente$/);
});

test('o atendente não entra no painel de admin', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/atendente/);
});

test.describe('responsivo (celular)', () => {
  test.use({ viewport: { width: 360, height: 800 } });
  test('Agenda e Fila não rolam para o lado', async ({ page }) => {
    for (const rota of ['/atendente', '/atendente/agenda']) {
      await page.goto(rota);
      await page.waitForLoadState('networkidle');
      expect(await semRolagemHorizontal(page), `${rota} rola para o lado`).toBe(true);
    }
  });
});
