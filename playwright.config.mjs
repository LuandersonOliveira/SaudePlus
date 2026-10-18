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

  use: {
    baseURL: FRONT,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: {
    command: 'npm run dev',
    url: FRONT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});