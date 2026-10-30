import { test as base, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ADMIN_STATE_PATH = resolve(__dirname, '.auth/admin.json');
const adminTest = base.extend({
  adminPage: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: ADMIN_STATE_PATH });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));
    await page.goto('/admin.html');
    await expect(page.locator('#tab-atendimentos')).toBeVisible({ timeout: 15000 });
    await use({ page, pageErrors });
    await context.close();
  },
});

adminTest.describe('Agenda operacional (admin)', () => {
  adminTest.skip(!existsSync(ADMIN_STATE_PATH), 'Sessao do admin nao disponivel');

  adminTest('abre a aba de atendimentos e renderiza a agenda compartilhada', async ({ adminPage }) => {
    const { page, pageErrors } = adminPage;
    await page.locator('#tab-atendimentos').click();
    await expect(page.locator('#atendimentos')).toHaveClass(/active/);
    await expect(page.locator('[data-agenda]').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-day-list], [data-calendar]').first()).toBeVisible({ timeout: 15000 });
    expect(pageErrors.filter((e) => !e.includes('favicon'))).toEqual([]);
  });

  adminTest('alterna para "Para remarcar" sem erros', async ({ adminPage }) => {
    const { page, pageErrors } = adminPage;
    await page.locator('#tab-atendimentos').click();
    const remarcar = page.locator('[data-agenda-tab="remarcar"]').first();
    if (await remarcar.count()) await remarcar.click();
    await expect(page.locator('[data-agenda]').first()).toBeVisible();
    expect(pageErrors.filter((e) => !e.includes('favicon'))).toEqual([]);
  });
});
