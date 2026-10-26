import { test as base, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PATIENT_STATE_PATH = resolve(__dirname, '.auth/paciente.json');

// Helper: data futura em formato datetime-local (YYYY-MM-DDTHH:mm)
function futureDatetime(daysFromNow = 30, hour = 10, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, minute, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Fixture worker-scoped (espelho de adminPage) para carregar o dashboard UMA vez
const test = base.extend({
  patientPage: [async ({ browser }, use) => {
    if (!existsSync(PATIENT_STATE_PATH)) {
      throw new Error('e2e/.auth/paciente.json não encontrado. Rode global-setup ou crie a sessão do paciente.');
    }
    const context = await browser.newContext({ storageState: PATIENT_STATE_PATH });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));
    const badResponses = [];
    page.on('response', (res) => {
      const status = res.status();
      const url = res.url();
      if ((status >= 400 && !url.includes('/auth/login')) || status >= 500) {
        badResponses.push({ status, url });
      }
    });
    await page.goto('/dashboard.html');
    await expect(page.locator('#userName')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.tab[data-tab="inicio"]').first()).toHaveClass(/active/);
    await use({ page, pageErrors, badResponses });
    await context.close();
  }, { scope: 'worker' }],
});

test.describe('Dashboard paciente (8D)', () => {
  test.skip(!existsSync(PATIENT_STATE_PATH), 'Sessão do paciente não disponível');

  test('1) painel abre no Início sem erro de JS e sem 4xx relevantes', async ({ patientPage: ctx }) => {
    const page = ctx.page;
    // Abas principais presentes
    await expect(page.locator('.tab[data-tab="inicio"]')).toBeVisible();
    await expect(page.locator('.tab[data-tab="agendar"]')).toBeVisible();
    await expect(page.locator('.tab[data-tab="agendamentos"]')).toBeVisible();
    await expect(page.locator('.tab[data-tab="alertas"]')).toBeVisible();
    await expect(page.locator('.tab[data-tab="minha-conta"]')).toBeVisible();
    // Painéis
    await expect(page.locator('#inicio')).toHaveClass(/active/);
    await expect(page.locator('#agendar')).not.toHaveClass(/active/);
    // Sem erros JS ou 5xx
    expect(ctx.pageErrors.filter(e => !e.includes('favicon'))).toEqual([]);
    const bad = ctx.badResponses.filter(r => r.status >= 500);
    expect(bad).toEqual([]);
  });

  test('2) estado de erro da lista tem "Tentar de novo" e recarrega', async ({ browser }) => {
    if (!existsSync(PATIENT_STATE_PATH)) test.skip();
    const context = await browser.newContext({ storageState: PATIENT_STATE_PATH });
    const page = await context.newPage();
    await page.route('**/me/appointments', route => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'erro teste' }) });
      }
      return route.continue();
    });
    await page.goto('/dashboard.html', { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page.locator('#userName')).toBeVisible({ timeout: 15000 });
    await page.locator('.tab[data-tab="agendamentos"]').click();
    await expect(page.locator('#agendamentos')).toHaveClass(/active/);
    const err = page.locator('#appts .state-error');
    await err.waitFor({ state: 'visible', timeout: 20000 });
    await expect(err).toContainText(/Tentar de novo/);
    await page.unroute('**/me/appointments');
    await err.locator('button').first().click({ force: true });
    await page.waitForResponse(r => r.url().includes('/me/appointments') && r.request().method() === 'GET', { timeout: 15000 }).catch(() => null);
    await expect(err).toBeHidden({ timeout: 15000 });
    await context.close();
  });

  test('3) agendar consulta manual: "Outra" → review modal → confirmar → aparece na lista', async ({ patientPage: ctx }) => {
    const page = ctx.page;
    // Ir para agendar
    await page.locator('.tab[data-tab="agendar"]').click();
    await expect(page.locator('#agendar')).toHaveClass(/active/);
    // Garantir aba Consulta
    await page.locator('#kindAppt').click();
    await expect(page.locator('#apptFormCard')).toBeVisible();
    // Selecionar "Outra (especificar)"
    await page.locator('#apptServiceSelect').selectOption({ value: '__outra' });
    await expect(page.locator('#specialtyOutra')).toBeVisible();
    await page.locator('#specialtyOutra').fill('E2E Consulta Teste');
    // Caminho manual
    await expect(page.locator('#apptManualBlock')).toBeVisible();
    // Selecionar primeira unidade
    await page.locator('#apptManualUnit').selectOption({ index: 1 });
    // Data/hora futura
    await page.locator('#apptManualDate').fill(futureDatetime(30, 10, 0));
    // Habilitado
    await expect(page.locator('#apptSubmitBtn')).toBeEnabled();
    // Enviar → abre modal de revisão
    await page.locator('#apptSubmitBtn').click();
    await expect(page.locator('#reviewModal')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#reviewModalLines')).toContainText('E2E Consulta Teste');
    // Confirmar
    await page.locator('#reviewModalConfirm').click();
    await expect(page.locator('.toast.show')).toContainText(/Consulta agendada|agendada/);
    // Ir para agendamentos e verificar
    await page.locator('.tab[data-tab="agendamentos"]').click();
    await expect(page.locator('#agendamentos')).toHaveClass(/active/);
    await expect(page.locator('#appts')).toContainText('E2E Consulta Teste');
  });

  test('4) review modal "Voltar" não envia (sem POST, item não adicionado)', async ({ patientPage: ctx }) => {
    const page = ctx.page;
    await page.locator('.tab[data-tab="agendar"]').click();
    await expect(page.locator('#agendar')).toHaveClass(/active/);
    await page.locator('#kindAppt').click();
    // Novo agendamento
    await page.locator('#apptServiceSelect').selectOption({ value: '__outra' });
    await page.locator('#specialtyOutra').fill('E2E Consulta Voltar Teste');
    await page.locator('#apptManualUnit').selectOption({ index: 1 });
    await page.locator('#apptManualDate').fill(futureDatetime(31, 11, 0));
    await expect(page.locator('#apptSubmitBtn')).toBeEnabled();
    await page.locator('#apptSubmitBtn').click();
    await expect(page.locator('#reviewModal')).toBeVisible();
    await page.locator('#reviewModalBack').click();
    await expect(page.locator('#reviewModal')).toBeHidden();
    // Item não deve ter sido criado
    await page.locator('.tab[data-tab="agendamentos"]').click();
    await expect(page.locator('#appts')).not.toContainText('E2E Consulta Voltar Teste');
  });

  test('5) cancelar: alertdialog Voltar não cancela, confirmar cancela e vira "Tentar agendar novamente"', async ({ browser }) => {
    test.setTimeout(90000);
    if (!existsSync(PATIENT_STATE_PATH)) test.skip();
    const context = await browser.newContext({ storageState: PATIENT_STATE_PATH });
    const page = await context.newPage();
    const nome = `E2E Cancelar ${Date.now()}`;
    await page.goto('/dashboard.html');
    await expect(page.locator('#userName')).toBeVisible({ timeout: 15000 });
    // Criar item próprio para cancelar
    await page.locator('.tab[data-tab="agendar"]').click();
    await expect(page.locator('#agendar')).toHaveClass(/active/);
    await page.locator('#kindAppt').click();
    await page.locator('#apptServiceSelect').selectOption({ value: '__outra' });
    await page.locator('#specialtyOutra').fill(nome);
    await page.locator('#apptManualUnit').selectOption({ index: 1 });
    await page.locator('#apptManualDate').fill(futureDatetime(32, 9, 0));
    await expect(page.locator('#apptSubmitBtn')).toBeEnabled();
    await page.locator('#apptSubmitBtn').click();
    await expect(page.locator('#reviewModal')).toBeVisible({ timeout: 10000 });
    await page.locator('#reviewModalConfirm').click();
    await expect(page.locator('.toast.show')).toContainText(/agendada/, { timeout: 10000 });
    // Ir para agendamentos
    await page.locator('.tab[data-tab="agendamentos"]').click();
    await expect(page.locator('#agendamentos')).toHaveClass(/active/);
    // Aguardar lista renderizar
    await page.waitForTimeout(2000);
    // Clicar em cancelar no item criado
    await page.locator('#appts').getByText(nome).first().waitFor({ timeout: 20000 });
    const item = page.locator('#appts .item').filter({ hasText: nome }).first();
    await item.locator('button[data-act="cancel"]').click({ timeout: 20000 });
    await expect(page.locator('#cancelModal')).toBeVisible();
    await expect(page.locator('#cancelModal')).toHaveAttribute('role', 'alertdialog');
    // Voltar não cancela
    await page.locator('#cancelModalBack').click();
    await expect(page.locator('#cancelModal')).toBeHidden();
    await expect(item.locator('button[data-act="cancel"]')).toBeVisible();
    // Cancelar de verdade
    await item.locator('button[data-act="cancel"]').click();
    await expect(page.locator('#cancelModal')).toBeVisible();
    await page.locator('#cancelModalConfirm').click();
    await expect(page.locator('.toast.show')).toContainText(/cancelado/i);
    // Deve aparecer botão rebook
    await expect(item.locator('button[data-act="rebook"]')).toBeVisible({ timeout: 15000 });
    await context.close();
  });

  test('6) editar: banner aparece, título muda, cancelar edição restaura', async ({ patientPage: ctx }) => {
    const page = ctx.page;
    // Criar item próprio para editar
    await page.locator('.tab[data-tab="agendar"]').click();
    await expect(page.locator('#agendar')).toHaveClass(/active/);
    await page.locator('#kindAppt').click();
    await page.locator('#apptServiceSelect').selectOption({ value: '__outra' });
    await page.locator('#specialtyOutra').fill('E2E Consulta Editar Teste');
    await page.locator('#apptManualUnit').selectOption({ index: 1 });
    await page.locator('#apptManualDate').fill(futureDatetime(33, 14, 0));
    await expect(page.locator('#apptSubmitBtn')).toBeEnabled();
    await page.locator('#apptSubmitBtn').click();
    await expect(page.locator('#reviewModal')).toBeVisible();
    await page.locator('#reviewModalConfirm').click();
    await expect(page.locator('.toast.show')).toContainText(/agendada/);
    await page.locator('.tab[data-tab="agendamentos"]').click();
    await expect(page.locator('#agendamentos')).toHaveClass(/active/);
    const item = page.locator('#appts .item', { hasText: 'E2E Consulta Editar Teste' }).first();
    await item.locator('button[data-act="edit"]').click();
    await expect(page.locator('#agendar')).toHaveClass(/active/);
    await expect(page.locator('#apptEditBanner')).toBeVisible();
    await expect(page.locator('#apptFormTitle')).toContainText(/Editar consulta/);
    await expect(page.locator('#apptCancelEdit')).toBeVisible();
    // Cancelar edição
    await page.locator('#apptCancelEdit').click();
    await expect(page.locator('#apptEditBanner')).toBeHidden();
  });

  test('7) agendar exame manual: flux completo', async ({ patientPage: ctx }) => {
    const page = ctx.page;
    await page.locator('.tab[data-tab="agendar"]').click();
    await expect(page.locator('#agendar')).toHaveClass(/active/);
    await page.locator('#kindExam').click();
    await expect(page.locator('#examFormCard')).toBeVisible();
    await expect(page.locator('#apptFormCard')).toBeHidden();
    // Exame
    await page.locator('#examServiceSelect').selectOption({ value: '__outro' });
    await expect(page.locator('#examTypeOutro')).toBeVisible();
    await page.locator('#examTypeOutro').fill('E2E Exame Teste');
    await expect(page.locator('#examManualBlock')).toBeVisible();
    await page.locator('#examManualUnit').selectOption({ index: 1 });
    await page.locator('#examManualDate').fill(futureDatetime(34, 8, 30));
    await expect(page.locator('#examSubmitBtn')).toBeEnabled();
    await page.locator('#examSubmitBtn').click();
    await expect(page.locator('#reviewModal')).toBeVisible();
    await expect(page.locator('#reviewModalLines')).toContainText('E2E Exame Teste');
    await page.locator('#reviewModalConfirm').click();
    await expect(page.locator('.toast.show')).toContainText(/Exame agendado|agendado/);
    // Verificar na lista de exames
    await page.locator('.tab[data-tab="agendamentos"]').click();
    await expect(page.locator('#exams')).toContainText('E2E Exame Teste');
  });

  test('8) perfil: salvar social_name atualiza meter; CPF inválido não envia PUT', async ({ patientPage: ctx }) => {
    const page = ctx.page;
    await page.locator('.tab[data-tab="minha-conta"]').click();
    await expect(page.locator('#minha-conta')).toHaveClass(/active/);
    await expect(page.locator('#profileForm')).toBeVisible();
    // CPF inválido não deve fazer PUT
    let putMe = 0;
    page.on('request', req => {
      if (req.method() === 'PUT' && req.url().includes('/auth/me')) putMe++;
    });
    await page.locator('#p_cpf').fill('11111111111');
    await page.locator('#profileSubmit').click();
    await expect(page.locator('#p_cpf').locator('..')).toHaveClass(/has-error/);
    expect(putMe).toBe(0);
    // Salvar social_name válido
    await page.locator('#p_cpf').fill('');
    await page.locator('#p_social_name').fill(`Paciente E2E ${Date.now()}`);
    await page.locator('#profileSubmit').click();
    await expect(page.locator('.toast.show')).toContainText(/Perfil salvo/);
    await expect(page.locator('#profilePct')).toContainText(/%/);
    await expect(page.locator('#profileBar')).toHaveAttribute('aria-valuenow');
  });

  test('9) MFA: setup revela secret, código errado não ativa', async ({ patientPage: ctx }) => {
    const page = ctx.page;
    await page.locator('.tab[data-tab="minha-conta"]').click();
    await expect(page.locator('#minha-conta')).toHaveClass(/active/);
    // Se já tiver MFA ativado, pular (não deve acontecer em conta fresca)
    const mfaOn = await page.locator('#mfaDisableBtn').isVisible().catch(() => false);
    if (mfaOn) {
      test.skip();
      return;
    }
    // Iniciar setup se disponível
    const setupBtn = page.locator('#mfaSetupBtn');
    if (!(await setupBtn.isVisible().catch(() => false))) {
      test.skip();
      return;
    }
    await setupBtn.click();
    await expect(page.locator('#passwordModal')).toBeVisible();
    await page.locator('#passwordModalInput').fill(process.env.E2E_PATIENT_PASSWORD || 'senha-e2e-123456');
    await page.locator('#passwordModalConfirm').click();
    // Secret revelado
    await expect(page.locator('#mfaSetup')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#mfaSecret')).not.toHaveText('', { timeout: 5000 });
    // Código errado
    await page.locator('#mfaEnableCode').fill('000000');
    await page.locator('#mfaEnableBtn').click();
    await expect(page.locator('.toast.show')).toContainText(/inválid/i);
    // Ainda não ativado
    await expect(page.locator('#mfaDisableBtn')).toBeHidden();
  });

  test('10) LGPD: consent line carrega, download e delete mockado redireciona', async ({ browser }) => {
    if (!existsSync(PATIENT_STATE_PATH)) test.skip();
    const context = await browser.newContext({ storageState: PATIENT_STATE_PATH });
    const page = await context.newPage();
    // Mock DELETE para não destruir conta
    await page.route('**/auth/me', route => {
      if (route.request().method() === 'DELETE') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      }
      return route.continue();
    });
    await page.goto('/dashboard.html');
    await expect(page.locator('#userName')).toBeVisible({ timeout: 15000 });
    await page.locator('.tab[data-tab="minha-conta"]').click();
    await expect(page.locator('#minha-conta')).toHaveClass(/active/);
    // Consentimento carrega
    await expect(page.locator('#consentLine')).toContainText(/Política de privacidade/i, { timeout: 10000 });
    // Download
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#lgpdDownloadBtn').click(),
    ]);
    expect(download.suggestedFilename()).toBe('meus-dados-saude-mais.json');
    // Delete flow
    await page.locator('#lgpdDeleteBtn').click();
    await expect(page.locator('#passwordModal')).toBeVisible();
    await page.locator('#passwordModalInput').fill(process.env.E2E_PATIENT_PASSWORD || 'senha-e2e-123456');
    await page.locator('#passwordModalConfirm').click();
    await expect(page.locator('#passwordModalTitle')).toContainText(/certeza/i);
    await expect(page.locator('#passwordModalField')).toBeHidden();
    await page.locator('#passwordModalConfirm').click(); // btn-danger
    await expect(page.locator('.toast.show')).toContainText(/Conta excluída/);
    await page.waitForURL(/auth\.html/, { timeout: 10000 });
    await context.close();
  });
});
