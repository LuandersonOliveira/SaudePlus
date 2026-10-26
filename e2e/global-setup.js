import { chromium, request } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Sessões criadas UMA vez para a suíte inteira.
 *
 * Admin: login pela interface (API limita 60/15min + trava IP). Com sessão
 * reutilizada, evitamos estourar o limite com um login por teste.
 * Paciente: criado pelo signup idempotente via API (409 tolerado) e logado
 * pela interface (mesmo formato de localStorage).
 */
const STATE_PATH = resolve(__dirname, '.auth/admin.json');
const PATIENT_STATE_PATH = resolve(__dirname, '.auth/paciente.json');

const PAUSA_429 = 30_000;
// 34 tentativas = 17 min. O limitador GLOBAL da API é 300 req/15min.
const TENTATIVAS_MAX = 34;

async function tentarLogin(page, base, email, password) {
  await page.goto(`${base}/auth.html`);
  await page.fill('#loginEmail', email);
  await page.fill('#loginPassword', password);
  const [resposta] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/auth/login') && r.request().method() === 'POST'),
    page.click('#loginForm button[type=submit]'),
  ]);
  return resposta.status();
}

async function criarSessaoPaciente(base, apiBase) {
  const email = process.env.E2E_PATIENT_EMAIL || 'paciente.e2e@saude.app';
  const password = process.env.E2E_PATIENT_PASSWORD || 'senha-e2e-123456';
  const fullName = 'Paciente E2E';
  const birthDate = '1990-01-01';
  const cpf = '52998224725';

  try {
    const ctx = await request.newContext({ baseURL: apiBase });
    const res = await ctx.post('/auth/signup', {
      data: { email, password, full_name: fullName, birth_date: birthDate, cpf },
    });
    await ctx.dispose();
    if (res.status() !== 201 && res.status() !== 409) {
      throw new Error(`signup paciente retornou ${res.status()}`);
    }
  } catch (err) {
    // 409 vem como "já existe" — seguimos para o login
    if (!/409/.test(String(err)) && !/já existe/.test(String(err).toLowerCase())) {
      console.warn('[e2e] aviso ao criar paciente:', err?.message || err);
    }
  }

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    for (let tentativa = 1; ; tentativa++) {
      try {
        const status = await tentarLogin(page, base, email, password);
        if (status === 200) break;
        if (status === 429 && tentativa < TENTATIVAS_MAX) {
          if (tentativa === 1) {
            console.log('\n[e2e] /auth/login paciente devolveu 429 — aguardando a janela do limitador…');
          }
          await new Promise((r) => setTimeout(r, PAUSA_429));
          continue;
        }
        await ctx.close();
        throw new Error(`Login do paciente no setup devolveu ${status}.`);
      } catch (e) {
        if (tentativa >= TENTATIVAS_MAX) throw e;
        await new Promise((r) => setTimeout(r, PAUSA_429));
        continue;
      }
    }
    await page.waitForURL(/dashboard\.html/, { timeout: 30_000 });
    const state = await ctx.storageState();
    mkdirSync(dirname(PATIENT_STATE_PATH), { recursive: true });
    writeFileSync(PATIENT_STATE_PATH, JSON.stringify(state));
    await ctx.close();
  } finally {
    await browser.close();
  }
}

export default async function globalSetup() {
  const base = process.env.E2E_BASE_URL || 'http://localhost:8080';
  const apiBase = process.env.E2E_API_BASE_URL || 'http://localhost:4000';

  if (process.env.ADMIN_PASSWORD) {
    try {
      const browser = await chromium.launch();
      try {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        for (let tentativa = 1; ; tentativa++) {
          try {
            const status = await tentarLogin(page, base, process.env.ADMIN_EMAIL || 'admin@saude.app', process.env.ADMIN_PASSWORD);
            if (status === 200) break;
            if (status === 429 && tentativa < TENTATIVAS_MAX) {
              if (tentativa === 1) {
                console.log('\n[e2e] /auth/login devolveu 429 — aguardando a janela do limitador…');
              }
              await new Promise((r) => setTimeout(r, PAUSA_429));
              continue;
            }
            await ctx.close();
            throw new Error(`Login do admin no setup devolveu ${status}.`);
          } catch (e) {
            if (tentativa >= TENTATIVAS_MAX) throw e;
            await new Promise((r) => setTimeout(r, PAUSA_429));
            continue;
          }
        }
        await page.waitForURL(/admin\.html/, { timeout: 30_000 });
        const state = await ctx.storageState();
        mkdirSync(dirname(STATE_PATH), { recursive: true });
        writeFileSync(STATE_PATH, JSON.stringify(state));
        await ctx.close();
      } finally {
        await browser.close();
      }
    } catch (err) {
      console.warn('[e2e] Não foi possível criar sessão do admin:', err?.message || err);
    }
  }

  try {
    await criarSessaoPaciente(base, apiBase);
  } catch (err) {
    console.warn('[e2e] Não foi possível criar sessão do paciente:', err?.message || err);
  }
}