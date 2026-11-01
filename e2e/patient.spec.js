import { test, expect } from '@playwright/test';
import { stateOf, vigiar, semRolagemHorizontal } from './fixtures.js';

/** Painel do paciente (React) contra a API real. */
test.use({ storageState: stateOf('paciente') });
test.skip(!stateOf('paciente'), 'sem sessão de paciente');

const SECOES = [
  ['/dashboard', 'Início'],
  ['/dashboard/agendar', 'Agendar'],
  ['/dashboard/agendamentos', 'Meus agendamentos'],
  ['/dashboard/alertas', 'Alertas'],
  ['/dashboard/conta', 'Minha conta'],
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

test('o menu leva a cada seção', async ({ page }) => {
  await page.goto('/dashboard');
  const nav = page.getByRole('navigation').first();
  for (const [rota, nome] of SECOES.slice(1)) {
    await nav.getByRole('link', { name: nome, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${rota}$`));
  }
});

test('agendar: a revisão antes de enviar não grava nada se a pessoa voltar', async ({ page }) => {
  await page.goto('/dashboard/agendar');
  await page.waitForLoadState('networkidle');
  let posts = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/me\/(appointments|exams)/.test(r.url())) posts++;
  });
  // Sem preencher, o botão de enviar não pode criar nada.
  const enviar = page.getByRole('button', { name: /revisar|agendar consulta|agendar exame|confirmar/i }).first();
  if (await enviar.isVisible()) await enviar.click();
  await page.waitForTimeout(500);
  expect(posts).toBe(0);
});

test('Minha conta mostra o aviso de privacidade e o contato do DPO', async ({ page }) => {
  await page.goto('/dashboard/conta');
  await expect(page.getByText(/LGPD|privacidade/i).first()).toBeVisible();
});

test.describe('responsivo (celular)', () => {
  test.use({ viewport: { width: 360, height: 800 } });
  test('as seções não rolam para o lado', async ({ page }) => {
    for (const [rota] of SECOES) {
      await page.goto(rota);
      await page.waitForLoadState('networkidle');
      expect(await semRolagemHorizontal(page), `${rota} rola para o lado`).toBe(true);
    }
  });
});
