import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test as base, expect } from '@playwright/test';
import { totpNow, zerarUltimoPasso } from './totp.js';

const AUTH = resolve(__dirname, '.auth');
const FRONT = process.env.E2E_BASE_URL || 'http://localhost:8080';
const API = process.env.E2E_API_BASE_URL || 'http://localhost:4000';

/**
 * Abre uma sessão por API para a conta do descritor: login e, se a conta tem MFA, a verificação do código.
 * Devolve o access token, o usuário e o valor do cookie de refresh daquela sessão.
 */
async function abrirSessao(api, descritor) {
  const { email } = descritor.login;
  if (descritor.totp) await zerarUltimoPasso(email);

  let res = await api.post('/auth/login', { data: descritor.login });
  if (!res.ok()) throw new Error(`[e2e] login de ${email} devolveu ${res.status()}`);
  let corpo = await res.json();
  if (corpo.mfa_required) {
    if (!descritor.totp) throw new Error(`[e2e] ${email} exige MFA e o descritor não tem o segredo`);
    res = await api.post('/auth/mfa/verify', { data: { ticket: corpo.mfa_ticket, code: totpNow(descritor.totp.secret) } });
    if (!res.ok()) throw new Error(`[e2e] verificação MFA de ${email} devolveu ${res.status()}`);
    corpo = await res.json();
  }
  const setCookie = res.headersArray().find((h) => h.name.toLowerCase() === 'set-cookie' && h.value.startsWith('saude_refresh='));
  if (!setCookie) throw new Error('[e2e] a sessão não devolveu o cookie de refresh');
  return { token: corpo.token, user: corpo.user, refresh: setCookie.value.split(';')[0].slice('saude_refresh='.length) };
}

function lerDescritor(papel) {
  const arquivo = papel ? stateOf(papel) : undefined;
  if (!arquivo) return null;
  try {
    const d = JSON.parse(readFileSync(arquivo, 'utf8'));
    return d && d.login ? d : null;
  } catch {
    return null;
  }
}

/** Sessão por API de um papel (usada por testes que precisam do token, por exemplo para criar uma conta). */
export async function sessaoPorApi(playwright, papel) {
  const descritor = lerDescritor(papel);
  if (!descritor) throw new Error(`[e2e] sem descritor de sessão para "${papel}"`);
  const api = await playwright.request.newContext({ baseURL: API });
  try {
    return { ...(await abrirSessao(api, descritor)), login: descritor.login };
  } finally {
    await api.dispose();
  }
}

/** Código TOTP válido AGORA para o papel (zera o replay do passo antes). Para o formulário de login na tela. */
export async function codigoMfa(papel) {
  const descritor = lerDescritor(papel);
  if (!descritor || !descritor.totp) throw new Error(`[e2e] "${papel}" não tem segredo de MFA no descritor`);
  await zerarUltimoPasso(descritor.login.email);
  return totpNow(descritor.totp.secret);
}

/**
 * `test` com UMA SESSÃO NOVA POR TESTE (ADR-0011).
 *
 * O refresh token só existe em cookie HttpOnly e o access token só em memória: ao abrir a página, o
 * app recupera a sessão com `POST /auth/refresh`, e isso GIRA o refresh token. Um storageState
 * compartilhado entre testes reapresentaria um token já girado, e o servidor trata o reuso como roubo
 * e revoga a sessão inteira. Então o globalSetup valida as contas e guarda só um descritor
 * (`.auth/<papel>.json`: credencial, segredo do MFA e usuário), e este fixture abre uma sessão por API
 * por teste e monta o storageState com o cookie daquela sessão.
 *
 * Um login por teste cabe nos limites (o runner eleva RATE_LIMIT_AUTH_MAX), e só login com erro
 * conta para o bloqueio por IP.
 */
export const test = base.extend({
  // Papel da sessão: test.use({ papel: 'admin' }). Não dá para usar test.use({ storageState }), porque um valor
  // fixo em test.use substitui o fixture abaixo e o arquivo de descritor seria carregado como se fosse um estado.
  papel: [undefined, { option: true }],

  storageState: async ({ storageState, papel, playwright }, use) => {
    const descritor = lerDescritor(papel);
    if (!descritor) return use(storageState);

    const api = await playwright.request.newContext({ baseURL: API });
    try {
      const sessao = await abrirSessao(api, descritor);
      const origem = new URL(FRONT);
      await use({
        // O navegador chama /api/auth/* (proxy do Vite), então o cookie vale nesse Path.
        cookies: [{
          name: 'saude_refresh', value: sessao.refresh, domain: origem.hostname, path: '/api/auth',
          httpOnly: true, secure: false, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 3600,
        }],
        origins: [{ origin: origem.origin, localStorage: [{ name: 'saude_user', value: JSON.stringify(sessao.user) }] }],
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
