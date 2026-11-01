import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// O `.env` é carregado por `server/src/app.js`, e só lá — o processo do
// Playwright é outro. Sem isto, `ADMIN_PASSWORD` chega vazio, todo teste que
// precisa da conta real é pulado e a suíte "passa" sem verificar nada.
dotenv.config({ path: path.join(ROOT, 'server', '.env') });

/**
 * E2E com navegador real.
 *
 * Até aqui a cobertura era de contrato no servidor (RBAC, CORS, status,
 * formato de resposta) mais verificação estática do front — nenhuma das
 * duas abre uma página. Isso deixa passar justamente o tipo de defeito que
 * o usuário vê: o botão que não faz nada por causa de um erro de sintaxe
 * no script da página, o `onclick` apontando para função que foi renomeada,
 * o painel que carrega mas trava na hora de renderizar a lista.
 *
 * Os testes rodam contra `npm run dev` (API em 4000 + front em 8080), que é
 * a forma como o projeto é usado. `webServer` sobe e derruba o processo,
 * então não depende de alguém lembrar de deixar o dev rodando.
 *
 * O Chromium é o único navegador: os testes verificam comportamento da
 * aplicação, não diferenças entre engines, e um engine só mantém o CI em
 * minutos em vez de dezenas.
 */
const FRONT = process.env.E2E_BASE_URL || 'http://localhost:8080';

export default defineConfig({
  testDir: './e2e',
  // Os testes compartilham o mesmo banco e as mesmas contas de seed.
  // Rodar em paralelo faria um login derrubar o lockout do outro.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  // Faz UM login de admin e grava o storageState para a suíte inteira.
  // `/auth/login` é limitado a 60 tentativas/15min e ainda trava o IP; com um
  // login por teste a suíte responsiva estourava o limite e os testes
  // seguintes morriam de timeout — falha de infraestrutura, não de página.
  globalSetup: './e2e/global-setup.js',

  use: {
    baseURL: FRONT,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: {
    // Front legado (HTML) até cada página ser migrada para React: o e2e atual
    // cobre atendente/dashboard/admin, que o `npm run dev` (React) não serve.
    command: 'npm run dev:legacy',
    url: FRONT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    // A suíte abre 3 painéis e dezenas de abas em poucos minutos; o teto de
    // produção (300/15min) faz os últimos testes receberem 429. O limite
    // continua coberto pelos testes de unidade, aqui ele só não pode mascarar
    // uma falha real de página.
    env: {
      RATE_LIMIT_GLOBAL_MAX: '10000',
      RATE_LIMIT_AUTH_MAX: '1000',
    },
  },
});