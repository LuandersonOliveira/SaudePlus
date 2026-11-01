import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const AUTH = resolve(__dirname, '.auth');

/** Caminho do storageState de um papel, ou `undefined` se o setup não conseguiu criá-lo. */
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
