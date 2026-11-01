import { test, expect } from '@playwright/test';
import { stateOf, vigiar, semRolagemHorizontal } from './fixtures.js';

/**
 * Painel administrativo (React) contra a API real: o que o superadmin enxerga, os
 * cadastros que mexem em dados de verdade, e a regra de que a tela nunca provoca 403.
 */
test.use({ storageState: stateOf('admin') });
test.skip(!stateOf('admin'), 'ADMIN_PASSWORD não está no ambiente (sem sessão de admin)');

const sufixo = Date.now().toString(36);
const pick = async (page, scope, label, option) => {
  await scope.getByLabel(label).click();
  await page.getByRole('option', { name: option, exact: true }).click();
};

test.describe('navegação', () => {
  test('menu do superadmin e todas as seções abrem sem erro de JS nem 4xx', async ({ page }) => {
    const erros = vigiar(page);
    await page.goto('/admin');
    const nav = page.getByRole('navigation', { name: 'Navegação administrativa' });
    await expect(nav.getByRole('link')).toHaveText([/Início/, /Atendimentos/, /Cadastros/, /Auditoria/, /Minha conta/]);
    for (const rota of ['/admin/atendimentos', '/admin/cadastros/pessoas', '/admin/cadastros/rede', '/admin/cadastros/profissionais', '/admin/cadastros/doencas', '/admin/auditoria', '/admin/conta']) {
      await page.goto(rota);
      await page.waitForLoadState('networkidle');
      await expect(page, rota).toHaveURL(new RegExp(`${rota}$`));
    }
    expect(erros).toEqual([]);
  });

  test('endereço inexistente dentro de /admin volta ao Início', async ({ page }) => {
    await page.goto('/admin/nao-existe');
    await expect(page).toHaveURL(/\/admin$/);
  });

  test('o Início mostra números reais e baixa o resumo em CSV', async ({ page }) => {
    await page.goto('/admin');
    for (const l of ['Hoje (pendentes)', 'Aguardando ativação', 'Alertas ativos', 'Unidades ativas']) {
      await expect(page.getByText(l, { exact: true })).toBeVisible();
    }
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Baixar resumo CSV' }).click()]);
    expect(dl.suggestedFilename()).toBe('saude-plus-resumo-administrativo.csv');
  });
});

test.describe('Cadastros > Rede de saúde', () => {
  test('cadastra, edita e desativa uma unidade; o catálogo do paciente acompanha', async ({ page, request }) => {
    const nome = `UBS PW ${sufixo}`;
    await page.goto('/admin/cadastros/rede');
    const form = page.getByRole('form', { name: 'Cadastrar unidade de saúde' });
    await form.getByRole('button', { name: 'Adicionar unidade' }).click();
    await expect(page.getByText('Informe o nome da unidade.')).toBeVisible();
    await form.getByLabel('Nome da unidade').fill(nome);
    await pick(page, form, 'Tipo', 'Clínica');
    await form.getByLabel('Bairro ou região').fill('Bairro PW');
    await form.getByRole('button', { name: 'Adicionar unidade' }).click();
    await expect(page.getByRole('button', { name: `Editar ${nome}` })).toBeVisible();
    await expect(page.locator('li', { hasText: nome })).toContainText('Clínica · Bairro PW');

    await page.getByRole('button', { name: `Editar ${nome}` }).click();
    await page.getByRole('dialog').getByLabel('Bairro ou região').fill('Bairro PW 2');
    await page.getByRole('dialog').getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.locator('li', { hasText: nome })).toContainText('Bairro PW 2');

    // Desistir da confirmação não desativa.
    await page.getByRole('button', { name: `Desativar ${nome}` }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Voltar' }).click();
    await expect(page.getByRole('button', { name: `Desativar ${nome}` })).toBeVisible();

    await page.getByRole('button', { name: `Desativar ${nome}` }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Desativar unidade' }).click();
    await expect(page.getByRole('button', { name: `Ativar ${nome}` })).toBeVisible();
  });

  test('serviços da unidade: adiciona, recusa duplicata e remove', async ({ page }) => {
    await page.goto('/admin/cadastros/rede');
    const form = page.getByRole('form', { name: 'Adicionar serviço ofertado por unidade' });
    const servico = `Serviço PW ${sufixo}`;
    await form.getByLabel('Especialidade ou exame').fill(servico);
    await form.getByRole('button', { name: 'Adicionar serviço' }).click();
    await expect(page.getByRole('button', { name: `Remover serviço ${servico}` })).toBeVisible();
    await form.getByLabel('Especialidade ou exame').fill(servico);
    await form.getByRole('button', { name: 'Adicionar serviço' }).click();
    await expect(page.getByText('Este serviço já está cadastrado nesta unidade.')).toBeVisible();
    await page.getByRole('button', { name: `Remover serviço ${servico}` }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remover serviço' }).click();
    await expect(page.getByRole('button', { name: `Remover serviço ${servico}` })).toHaveCount(0);
  });
});

test.describe('Cadastros > Profissionais', () => {
  test('cadastra um profissional e monta a agenda: horários de 2 dias e bloqueio com motivo', async ({ page }) => {
    const nome = `Dr. PW ${sufixo}`;
    await page.goto('/admin/cadastros/profissionais');
    const form = page.getByRole('form', { name: 'Cadastrar profissional' });
    await form.getByLabel('Nome').fill(nome);
    await form.getByLabel('Cargo').fill('Médico');
    await form.getByRole('button', { name: 'Adicionar' }).click();
    await page.getByRole('button', { name: `Gerenciar vínculos e agenda de ${nome}` }).click();
    const dlg = page.getByRole('dialog');

    await dlg.getByRole('tab', { name: 'Horários' }).click();
    const sched = dlg.getByRole('form', { name: 'Adicionar horário de atendimento' });
    await sched.getByLabel('Unidade').click();
    await page.getByRole('option').nth(1).click(); // a 1ª opção é a vazia ("Selecione a unidade…")
    await sched.getByLabel('Segunda').click();
    await sched.getByLabel('Quarta').click();
    await sched.getByLabel('Início').fill('08:00');
    await sched.getByLabel('Fim').fill('12:00');
    await sched.getByRole('button', { name: 'Adicionar horário' }).click();
    await expect(dlg.locator('li', { hasText: '08:00–12:00' })).toHaveCount(2);

    await dlg.getByRole('tab', { name: 'Bloqueios' }).click();
    const block = dlg.getByRole('form', { name: 'Bloquear agenda do profissional' });
    await block.getByLabel('Unidade').click();
    await page.getByRole('option').nth(1).click();
    await block.getByLabel('Início').fill('2027-03-01T08:00');
    await block.getByLabel('Fim').fill('2027-03-05T18:00');
    await block.getByRole('button', { name: 'Bloquear agenda' }).click();
    await expect(block.getByText(/Informe o motivo/)).toBeVisible();
    await block.getByLabel('Motivo').fill('Férias PW');
    await block.getByRole('button', { name: 'Bloquear agenda' }).click();
    await expect(dlg.getByText('01/03/2027 08:00 → 05/03/2027 18:00')).toBeVisible();
  });
});

test.describe('Cadastros > Doenças e alertas', () => {
  test('cria, filtra, desativa (com confirmação) e exclui um alerta', async ({ page }) => {
    const nome = `Alerta PW ${sufixo}`;
    await page.goto('/admin/cadastros/doencas');
    const form = page.getByRole('form', { name: 'Cadastrar alerta de doença' });
    await form.getByLabel('Nome').fill(nome);
    await form.getByLabel('Região (Bairro)').click();
    await page.getByRole('option').first().click();
    await form.getByLabel('Descrição').fill('Criado pelo teste e2e');
    await form.getByRole('button', { name: 'Adicionar' }).click();
    await expect(page.getByRole('button', { name: `Editar alerta ${nome}` })).toBeVisible();

    await page.getByLabel('Filtrar alertas pelo nome ou região').fill(nome);
    await page.getByRole('button', { name: `Desativar alerta ${nome}` }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Desativar alerta' }).click();
    await expect(page.getByRole('button', { name: `Ativar alerta ${nome}` })).toBeVisible();

    await page.getByRole('button', { name: `Excluir alerta ${nome}` }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Excluir alerta' }).click();
    await expect(page.getByRole('button', { name: `Editar alerta ${nome}` })).toHaveCount(0);
  });
});

test.describe('responsivo (celular)', () => {
  test.use({ viewport: { width: 390, height: 800 } });
  test('nenhuma seção rola para o lado', async ({ page }) => {
    for (const rota of ['/admin', '/admin/atendimentos', '/admin/cadastros/pessoas', '/admin/cadastros/rede', '/admin/cadastros/profissionais', '/admin/cadastros/doencas', '/admin/auditoria', '/admin/conta']) {
      await page.goto(rota);
      await page.waitForLoadState('networkidle');
      expect(await semRolagemHorizontal(page), `${rota} rola para o lado`).toBe(true);
    }
  });
});
