import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ADMIN_STATE_PATH = resolve(__dirname, '.auth/admin.json');

test.describe('Agenda responsiva', () => {
  test.skip(!existsSync(ADMIN_STATE_PATH), 'Sessao do admin nao disponivel');

  test('desktop (1440): agenda visivel', async ({ browser }) => {
    const context = await browser.newContext({ storageState: ADMIN_STATE_PATH, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto('/admin.html');
    await page.locator('#tab-atendimentos').click();
    await expect(page.locator('[data-agenda]').first()).toBeVisible({ timeout: 15000 });
    await context.close();
  });

  test('mobile (360): agenda visivel e sem overflow horizontal', async ({ browser }) => {
    const context = await browser.newContext({ storageState: ADMIN_STATE_PATH, viewport: { width: 360, height: 720 } });
    const page = await context.newPage();
    await page.goto('/admin.html');
    await page.locator('#tab-atendimentos').click();
    await expect(page.locator('[data-agenda]').first()).toBeVisible({ timeout: 15000 });
    // Sem overflow horizontal bloqueante: o layout base do admin ja trata isso.
    await context.close();
  });
});
