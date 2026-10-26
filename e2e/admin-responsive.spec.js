import { test as base, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Admin responsivo — o contrato de layout que nenhuma outra suíte cobre.
 *
 * `login.spec.js` roda num único viewport (Desktop Chrome, 1280x720). Nada
 * olhava o painel abaixo de 980px, onde o rail vira topbar e a agenda vira
 * card. Foi exatamente nessa faixa que a Auditoria media 8099px de documento
 * num viewport de 360px, e a suíte existente ficava verde.
 *
 * Uma PAGINA so para a suite inteira (fixture de worker). Nao e economia:
 * a API tem limitador global de 300 requisicoes/15 min, e carregar o painel em
 * cada teste x 4 viewports estourava a janela no meio da execucao — os testes
 * passavam a falhar por 429, que nao e defeito de layout nenhum.
 */
const semAdmin = !process.env.ADMIN_PASSWORD;

const STATE_PATH = resolve(__dirname, '.auth/admin.json');
const STATE = existsSync(STATE_PATH) ? STATE_PATH : undefined;

const test = base.extend({
  // scope: 'worker' → criado uma vez e reusado por todos os testes do arquivo.
  adminPage: [async ({ browser }, use) => {
    const ctx = await browser.newContext({ storageState: STATE });
    const page = await ctx.newPage();
    await page.goto('/admin.html');
    await page.waitForSelector('#railUserHead');
    await use(page);
    await ctx.close();
  }, { scope: 'worker' }],
});

// Quatro viewports, um por alvo do produto: celular, tablet, notebook e TV.
// Casos intermediários (414, 1180) mudam de comportamento entre dois
// breakpoints, não criam um terceiro — e cada viewport custa ~13 requisições
// à API, que tem limite global de 300/15min.
const VIEWPORTS = [
  { nome: 'celular', width: 360, height: 780 },
  { nome: 'tablet', width: 820, height: 1180 },
  { nome: 'notebook', width: 1440, height: 900 },
  { nome: 'TV', width: 1920, height: 1080 },
];

const ABAS = ['overview', 'atendimentos', 'cadastros', 'auditoria', 'minha-conta'];

/** Vai para uma aba e espera a carga correspondente terminar. */
async function irPara(page, aba) {
  await page.click(`[data-tab="${aba}"]`);
  await page.waitForTimeout(aba === 'cadastros' ? 700 : 400);
}

/** Volta ao Início sem recarregar. Só recarrega se o teste anterior deixou
 *  um hash na URL — recarregar o painel custa ~13 requisições à API. */
async function paginaLimpa(page) {
  if (new URL(page.url()).hash) {
    await page.goto('/admin.html');
    await page.waitForSelector('#railUserHead');
  }
  const ativa = await page.locator('.tab[data-tab].active').getAttribute('data-tab');
  if (ativa !== 'overview') await irPara(page, 'overview');
}

/** Elementos dentro de uma faixa com rolagem horizontal são legítimos:
 *  `.table-wrap` e a barra de abas rolam de propósito. Só conta como
 *  vazamento o que estoura o documento. */
async function vazamentos(page) {
  return page.evaluate(() => {
    const dentroDeRolagem = (el) => {
      let pai = el.parentElement;
      while (pai && pai !== document.documentElement) {
        const ox = getComputedStyle(pai).overflowX;
        if (ox === 'auto' || ox === 'scroll') return true;
        pai = pai.parentElement;
      }
      return false;
    };
    const limite = document.documentElement.clientWidth;
    const out = [];
    document.querySelectorAll('main *, .app-rail *').forEach((el) => {
      if (el.offsetParent === null) return;
      if (dentroDeRolagem(el)) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0) return;
      if (r.right > limite + 1 || r.left < -1) {
        out.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} [${Math.round(r.left)}…${Math.round(r.right)}] em ${limite}`);
      }
    });
    return out.slice(0, 6);
  });
}

test.describe('admin responsivo', () => {
  test.describe('sem rolagem horizontal', () => {
    for (const vp of VIEWPORTS) {
      test(`${vp.nome} (${vp.width}px) não rola para o lado em nenhuma aba`, async ({ adminPage: page }) => {
        test.skip(semAdmin, 'ADMIN_PASSWORD não está no ambiente');
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await paginaLimpa(page);

        for (const aba of ABAS) {
          await irPara(page, aba);
          const vazou = await vazamentos(page);
          expect(vazou, `aba ${aba} a ${vp.width}px`).toEqual([]);
          const excesso = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth
          );
          expect(excesso, `scrollWidth da aba ${aba} a ${vp.width}px`).toBeLessThanOrEqual(0);
        }
      });
    }
  });

  test.describe('alvos de toque', () => {
    test('todo botão visível tem 44px de altura no celular', async ({ adminPage: page }) => {
      test.skip(semAdmin, 'ADMIN_PASSWORD não está no ambiente');
      await page.setViewportSize({ width: 360, height: 780 });
      await paginaLimpa(page);
      for (const aba of ABAS) {
        await irPara(page, aba);
        const pequenos = await page.evaluate(() => {
          const out = [];
          document.querySelectorAll('main button, main a.btn, .app-rail button, .app-rail .tab').forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return;
            if (r.height < 44) {
              out.push(`"${(el.getAttribute('aria-label') || el.textContent).trim().slice(0, 24)}" = ${Math.round(r.height)}px`);
            }
          });
          return out;
        });
        expect(pequenos, `aba ${aba}`).toEqual([]);
      }
    });
  });

  test.describe('adaptação por largura', () => {
    test('a vira tabela no desktop e card no celular', async ({ adminPage: page }) => {
      test.skip(semAdmin, 'ADMIN_PASSWORD não está no ambiente');
      await page.setViewportSize({ width: 1440, height: 900 });
      await paginaLimpa(page);
      await irPara(page, 'atendimentos');
      await page.waitForTimeout(600);

      const tabela = page.locator('table[data-card]').first();
      // Sem agendamentos no banco a aba mostra estado vazio e não há tabela.
      if (await tabela.count() === 0) test.skip(true, 'sem agendamentos no banco');
      await expect(tabela.locator('thead')).toBeVisible();
      await expect(tabela.locator('tbody tr').first()).toHaveCSS('display', 'table-row');

      await page.setViewportSize({ width: 360, height: 780 });
      await page.waitForTimeout(500);
      await expect(tabela.locator('thead')).toBeHidden();
      await expect(tabela.locator('tbody tr').first()).toHaveCSS('display', 'block');
      // O rótulo da coluna vem de data-label — é o que substitui o thead.
      await expect(tabela.locator('tbody td').first()).toHaveAttribute('data-label', /.+/);
    });

    test('o rail é coluna no desktop e barra em cima no celular', async ({ adminPage: page }) => {
      test.skip(semAdmin, 'ADMIN_PASSWORD não está no ambiente');
      await page.setViewportSize({ width: 1440, height: 900 });
      await paginaLimpa(page);
      const colunas = await page.evaluate(() => getComputedStyle(document.querySelector('.app-shell')).gridTemplateColumns);
      expect(colunas.split(' ').length).toBe(2);

      await page.setViewportSize({ width: 360, height: 780 });
      await page.waitForTimeout(500);
      const areas = await page.evaluate(() => getComputedStyle(document.querySelector('.app-rail')).gridTemplateAreas);
      // "brand user" + "tabs tabs": marca e conta na primeira linha, abas na segunda.
      expect(areas).toContain('brand');
      expect(areas).toContain('tabs');
    });

    test('a marca não é cortada e o Sair continua inteiro no celular', async ({ adminPage: page }) => {
      test.skip(semAdmin, 'ADMIN_PASSWORD não está no ambiente');
      await page.setViewportSize({ width: 360, height: 780 });
      await paginaLimpa(page);
      await expect(page.locator('.rail-brand')).toHaveText('Saúde+');
      const cortado = await page.evaluate(
        () => document.querySelector('.rail-brand').scrollWidth > document.querySelector('.rail-brand').clientWidth + 1
      );
      expect(cortado).toBe(false);
      await expect(page.getByRole('button', { name: 'Sair' })).toBeVisible();
    });

    test('o Início vira duas colunas em tela larga', async ({ adminPage: page }) => {
      test.skip(semAdmin, 'ADMIN_PASSWORD não está no ambiente');
      await page.setViewportSize({ width: 1440, height: 900 });
      await paginaLimpa(page);
      await page.waitForTimeout(600);
      const colunas = await page.evaluate(() => getComputedStyle(document.getElementById('overview')).gridTemplateColumns);
      expect(colunas.split(' ').length).toBe(2);
    });
  });

  test.describe('nomes acessíveis', () => {
    test('nenhum botão fica sem nome acessível', async ({ adminPage: page }) => {
      test.skip(semAdmin, 'ADMIN_PASSWORD não está no ambiente');
      await page.setViewportSize({ width: 1280, height: 800 });
      await paginaLimpa(page);
      for (const aba of ABAS) {
        await irPara(page, aba);
        const semNome = await page.evaluate(() => {
          const out = [];
          document.querySelectorAll('button, a.btn').forEach((el) => {
            const nome = (el.getAttribute('aria-label') || el.textContent || '').trim();
            if (!nome) out.push(el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''));
          });
          return out;
        });
        expect(semNome, `aba ${aba}`).toEqual([]);
      }
    });

    test('as abas de Cadastros são tablist de verdade', async ({ adminPage: page }) => {
      test.skip(semAdmin, 'ADMIN_PASSWORD não está no ambiente');
      await page.setViewportSize({ width: 1280, height: 800 });
      await paginaLimpa(page);
      await irPara(page, 'cadastros');
      const subs = page.locator('#cadastros [data-subtab]');
      await expect(subs).toHaveCount(3);
      for (let i = 0; i < 3; i++) {
        await expect(subs.nth(i)).toHaveAttribute('role', 'tab');
        await expect(subs.nth(i)).toHaveAttribute('aria-selected', i === 0 ? 'true' : 'false');
        const alvo = await subs.nth(i).getAttribute('aria-controls');
        expect(alvo).toBeTruthy();
        await expect(page.locator('#' + alvo)).toHaveAttribute('role', 'tabpanel');
      }
    });
  });

  test.describe('estado na URL', () => {
    test('trocar de aba escreve no hash e o botão Voltar desfaz', async ({ adminPage: page }) => {
      test.skip(semAdmin, 'ADMIN_PASSWORD não está no ambiente');
      await page.setViewportSize({ width: 1280, height: 800 });
      await paginaLimpa(page);
      // O login precisa deixar a URL limpa: o e2e de login afirma
      // toHaveURL(/admin\.html$/) e nada pode escrever no hash antes disso.
      expect(new URL(page.url()).hash).toBe('');

      await irPara(page, 'auditoria');
      expect(new URL(page.url()).hash).toContain('tab=auditoria');

      await page.goBack();
      await page.waitForTimeout(700);
      await expect(page.locator('#overview')).toHaveClass(/active/);
    });

    test('o hash restaurado na entrada reabre a mesma aba e os mesmos filtros', async ({ adminPage: page }) => {
      test.skip(semAdmin, 'ADMIN_PASSWORD não está no ambiente');
      await page.setViewportSize({ width: 1280, height: 800 });
      // Recarga de verdade: é o caminho do deep link (link colado, F5).
      await page.goto('/admin.html#tab=cadastros&sub=pessoas&status=pendente');
      await page.waitForTimeout(1800);
      await expect(page.locator('#cadastros')).toHaveClass(/active/);
      await expect(page.locator('#userSearchStatus')).toHaveValue('pendente');
      await expect(page.locator('#userSummary')).toContainText(/usuário/);
    });
  });

  test.describe('confirmação destrutiva', () => {
    test('desativar unidade abre confirmação e não age se o admin desistir', async ({ adminPage: page }) => {
      test.skip(semAdmin, 'ADMIN_PASSWORD não está no ambiente');
      await page.setViewportSize({ width: 1280, height: 800 });
      await paginaLimpa(page);
      // hash em vez de goto: recarregar custa ~13 requisições e o caminho por
      // hash exercita o mesmo applyUrlState.
      await page.evaluate(() => { location.hash = '#tab=cadastros&sub=rede'; });
      await page.waitForSelector('[data-act="unit-toggle"]', { timeout: 15_000 });
      const antes = await page.locator('#unitList .badge-danger').count();

      await page.locator('[data-act="unit-toggle"]').first().click();
      await expect(page.locator('#confirmModal')).toBeVisible();
      await page.locator('#confirmModal [data-confirm="no"]').click();
      await expect(page.locator('#confirmModal')).toHaveCount(0);

      // Nada foi desativado e a lista segue como estava.
      await page.waitForTimeout(600);
      expect(await page.locator('#unitList .badge-danger').count()).toBe(antes);
    });
  });

  test.describe('paginação', () => {
    test('usuários e auditoria informam quando não há mais o que carregar', async ({ adminPage: page }) => {
      test.skip(semAdmin, 'ADMIN_PASSWORD não está no ambiente');
      await page.setViewportSize({ width: 1280, height: 800 });
      await paginaLimpa(page);

      await page.evaluate(() => { location.hash = '#tab=cadastros&sub=pessoas'; });
      await page.waitForTimeout(1000);
      await expect(page.locator('#userList .load-more-end, #userList .load-more').first()).toBeVisible();

      await page.evaluate(() => { location.hash = '#tab=auditoria'; });
      await page.waitForTimeout(1000);
      await expect(page.locator('#auditLog .load-more-end, #auditLog .load-more').first()).toBeVisible();
    });
  });
});