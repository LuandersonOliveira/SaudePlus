import { test, expect, sessaoPorApi, stateOf } from './fixtures.js';
import { totpNow } from './totp.js';

/**
 * Segundo fator obrigatório (ADR-0010) com navegador de verdade: um atendente NOVO, sem MFA, entra só com a
 * senha, é levado à tela de configuração, não alcança o painel antes de ativar e, depois, entra no painel.
 */
test.skip(!stateOf('admin'), 'ADMIN_PASSWORD não está no ambiente (sem sessão de admin)');

test('atendente sem MFA é levado a configurar o segundo fator e só então vê o painel', async ({ page, playwright }) => {
  const admin = await sessaoPorApi(playwright, 'admin');
  const email = `mfa-e2e-${Date.now()}@saude.app`;
  const senha = 'Senha-E2e-Forte-123';
  const api = await playwright.request.newContext({
    baseURL: process.env.E2E_API_BASE_URL || 'http://localhost:4000',
    extraHTTPHeaders: { Authorization: `Bearer ${admin.token}` },
  });
  try {
    const criada = await api.post('/admin/users', {
      data: { full_name: 'Atendente MFA E2E', email, password: senha, role: 'atendente', account_status: 'ativo', mobile: '(87) 98888-7777' },
    });
    expect(criada.ok(), `criar atendente: ${criada.status()}`).toBe(true);
  } finally {
    await api.dispose();
  }

  // login só com a senha: a API entrega uma sessão restrita e a tela leva à configuração
  await page.goto('/auth');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/seguranca\/mfa$/);
  await expect(page.getByRole('heading', { name: 'Ative a verificação em duas etapas' })).toBeVisible();

  // o painel não abre enquanto o MFA não está ativo
  await page.goto('/atendente');
  await expect(page).toHaveURL(/\/seguranca\/mfa$/);

  // configuração: senha, chave, código do aplicativo
  await page.getByLabel('Confirme sua senha').fill(senha);
  await page.getByRole('button', { name: 'Gerar código de configuração' }).click();
  const chave = ((await page.getByLabel('Chave de configuração').textContent()) ?? '').replace(/\s+/g, '');
  expect(chave).toMatch(/^[A-Z2-7]{32}$/);
  await page.getByLabel('Código').fill(totpNow(chave));
  await page.getByRole('button', { name: 'Ativar e continuar' }).click();

  await expect(page).toHaveURL(/\/atendente/);
  // a sessão liberada sobrevive ao recarregar (o refresh não devolve a marca de restrição)
  await page.reload();
  await expect(page).toHaveURL(/\/atendente/);
  await expect(page.getByRole('heading', { name: 'Ative a verificação em duas etapas' })).toHaveCount(0);
});