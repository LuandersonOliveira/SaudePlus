import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test as base, expect } from '@playwright/test';

const AUTH = resolve(__dirname, '.auth');
const FRONT = process.env.E2E_BASE_URL || 'http://localhost:8080';
const API = process.env.E2E_API_BASE_URL || 'http://localhost:4000';

/**
 * `test` com UMA SESSÃO NOVA POR TESTE (ADR-0011).
 *
 * O refresh token só existe em cookie HttpOnly e o access token só em memória: ao abrir a página, o
 * app recupera a sessão com `POST /auth/refresh`, e isso GIRA o refresh token. Um storageState
 * compartilhado entre testes reapresentaria um token já girado, e o servidor trata o reuso como roubo
 * e revoga a sessão inteira. Então o globalSetup valida as contas e guarda só um descritor
 * (`.auth/<papel>.json`: credencial + usuário), e este fixture faz um login por API por teste e monta
 * o storageState com o cookie daquela sessão.
 *
 * Um login por teste cabe nos limites (o runner eleva RATE_LIMIT_AUTH_MAX), e só login com erro
 * conta para o bloqueio por IP.
 */
export const test = base.extend({
  // Papel da sessão: test.use({ papel: 'admin' }). Não dá para usar test.use({ storageState }), porque um valor
  // fixo em test.use substitui o fixture abaixo e o arquivo de descritor seria carregado como se fosse um estado.
  papel: [undefined, { option: true }],

  storageState: async ({ storageState, papel, playwright }, use) => {
    const arquivo = papel ? stateOf(papel) : undefined;
    let descritor = null;
    if (arquivo) {
      try {
        descritor = JSON.parse(readFileSync(arquivo, 'utf8'));
      } catch {
        descritor = null;
      }
    }
    if (!descritor || !descritor.login) return use(storageState);

    const api = await playwright.request.newContext({ baseURL: API });
    try {
      const res = await api.post('/auth/login', { data: descritor.login });
      if (!res.ok()) throw new Error(`[e2e] login de ${descritor.login.email} devolveu ${res.status()}`);
      const corpo = await res.json();
      const setCookie = res.headersArray().find((h) => h.name.toLowerCase() === 'set-cookie' && h.value.startsWith('saude_refresh='));
      if (!setCookie) throw new Error('[e2e] o login não devolveu o cookie de refresh');
      const valor = setCookie.value.split(';')[0].slice('saude_refresh='.length);
      const origem = new URL(FRONT);
      await use({
        // O navegador chama /api/auth/* (proxy do Vite), então o cookie vale nesse Path.
        cookies: [{
          name: 'saude_refresh', value: valor, domain: origem.hostname, path: '/api/auth',
          httpOnly: true, secure: false, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 3600,
        }],
        origins: [{ origin: origem.origin, localStorage: [{ name: 'saude_user', value: JSON.stringify(corpo.user) }] }],
      });
    } finally {
      await api.dispose();
    }
  },
});

export { expect };
/** Arquivo de descritor de um papel, ou `undefined` se o setup não conseguiu criá-lo (os specs usam para pular). */
export function stateOf(nome) {
  const file = resolve(AUTH, `${nome}.json`);
  return existsSync(file) ? file : undefined;
}

export function creds() {
  try {
    return JSON.parse(readFileSync(resolve(AUTH, 'creds.json'), 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Observa a página: erro de JavaScript e resposta 4xx/5xx da API são defeitos de
 * produto (um 403 significa que a tela ofereceu algo que o papel não pode fazer).
 * `ignorar` recebe um RegExp com respostas esperadas pelo teste.
 */
export function vigiar(page, ignorar) {
  const erros = [];
  page.on('pageerror', (e) => erros.push(`pageerror: ${e}`));
  page.on('response', (r) => {
    const url = r.url();
    if (!/\/api\//.test(url) || r.status() < 400) return;
    if (ignorar && ignorar.test(`${r.status()} ${url}`)) return;
    erros.push(`${r.status()} ${r.request().method()} ${url.replace(/^.*\/api/, '')}`);
  });
  return erros;
}

/** A página inteira não pode rolar para o lado (elementos dentro de um scroll próprio não contam). */
export async function semRolagemHorizontal(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}
