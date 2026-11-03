import { request } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { totpNow } from './totp.js';

/**
 * Sessões criadas UMA vez para a suíte inteira, por API (sem passar pela tela de login).
 *
 * `/auth/login` é limitado (60 tentativas/15 min) e ainda trava o IP; um login por
 * teste estouraria o limite e os últimos testes morreriam de timeout — falha de
 * infraestrutura, não de página. Aqui as contas são criadas e validadas UMA vez; cada teste abre a própria
 * sessão por API (fixtures.js), porque o refresh token só vive em cookie HttpOnly e gira a cada uso (ADR-0011).
 *
 *  - admin: ADMIN_EMAIL/ADMIN_PASSWORD do ambiente (sem eles, os testes de admin são pulados);
 *  - atendente: criado pelo admin com senha ALEATÓRIA desta execução (nunca uma senha conhecida
 *    num banco que pode ser o real); a senha vai para .auth/creds.json, que o git ignora;
 *  - paciente: signup idempotente (409 tolerado), como antes.
 */
const AUTH_DIR = resolve(__dirname, '.auth');
const API = process.env.E2E_API_BASE_URL || 'http://localhost:4000';

const PAUSA_429 = 30_000;
const TENTATIVAS_MAX = 34; // 17 min: o limitador GLOBAL da API é 300 req/15min

// Descritor da conta (ver fixtures.js): cada teste faz o PRÓPRIO login, porque o refresh token gira a cada uso
// e um storageState compartilhado reapresentaria um token já girado (ADR-0011). O arquivo está em .auth/, ignorado pelo git.
function descritor(email, password, data, totp) {
  return { login: { email, password }, user: data.user, ...(totp ? { totp } : {}) };
}

// ADR-0010: atendente e admin só usam o painel com o segundo fator ativo. O setup faz o que a tela de
// configuração faz (setup com a senha, enable com o código) e guarda o segredo no descritor: cada teste
// entra com login + código. Exige banco descartável: uma conta que já tem MFA não tem o segredo conhecido.
async function configurarMfa(ctx, email, password) {
  const entrada = await login(ctx, email, password);
  if (entrada.mfa_required) {
    throw new Error(` já tem MFA ativo e o segredo é desconhecido: rode o e2e em banco descartável`);
  }
  const auth = { Authorization: `Bearer ${entrada.token}` };
  const setup = await ctx.post('/auth/mfa/setup', { headers: auth, data: { password } });
  if (!setup.ok()) throw new Error(`mfa/setup de ${email} devolveu ${setup.status()}`);
  const { secret } = await setup.json();
  const enable = await ctx.post('/auth/mfa/enable', { headers: auth, data: { code: totpNow(secret) } });
  if (!enable.ok()) throw new Error(`mfa/enable de ${email} devolveu ${enable.status()}`);
  const liberada = await enable.json();
  return { secret, token: liberada.token, user: liberada.user };
}

async function login(ctx, email, password) {
  for (let tentativa = 1; ; tentativa++) {
    const res = await ctx.post('/auth/login', { data: { email, password } });
    if (res.status() === 200) return res.json();
    if (res.status() === 429 && tentativa < TENTATIVAS_MAX) {
      if (tentativa === 1) console.log('\n[e2e] /auth/login devolveu 429 — aguardando a janela do limitador…');
      await new Promise((r) => setTimeout(r, PAUSA_429));
      continue;
    }
    throw new Error(`login de ${email} devolveu ${res.status()}`);
  }
}

// O Playwright só espera o FRONT (Vite) ficar de pé; a API sobe um pouco depois. Sem esta espera o login do
// setup tomava ECONNREFUSED, as contas eram puladas e o que sobrava em .auth/ era de uma execução anterior.
async function aguardarApi(ctx) {
  for (let i = 0; i < 90; i++) {
    try {
      if ((await ctx.get('/health')).ok()) return;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('[e2e] a API não respondeu em /health em 90 s');
}

// Descritores de execuções anteriores (senhas de outro banco) nunca podem valer: começa do zero.
function limparAuth() {
  mkdirSync(AUTH_DIR, { recursive: true });
  for (const f of readdirSync(AUTH_DIR)) if (f.endsWith('.json')) rmSync(resolve(AUTH_DIR, f));
}

function save(name, data) {
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(resolve(AUTH_DIR, name), JSON.stringify(data));
}

export default async function globalSetup() {
  const ctx = await request.newContext({ baseURL: API });
  const creds = {};
  limparAuth();
  try {
    await aguardarApi(ctx);
    // ---- paciente ----
    const pEmail = process.env.E2E_PATIENT_EMAIL || 'paciente.e2e@saude.app';
    const pPassword = process.env.E2E_PATIENT_PASSWORD || 'senha-e2e-123456';
    try {
      const res = await ctx.post('/auth/signup', {
        data: { email: pEmail, password: pPassword, full_name: 'Paciente E2E', birth_date: '1990-01-01', cpf: '52998224725' },
      });
      if (res.status() !== 201 && res.status() !== 409) console.warn(`[e2e] signup do paciente devolveu ${res.status()}`);
      save('paciente.json', descritor(pEmail, pPassword, await login(ctx, pEmail, pPassword)));
      creds.patient = { email: pEmail };
    } catch (err) {
      console.warn('[e2e] sem sessão de paciente:', err?.message || err);
    }

    // ---- admin e atendente ----
    if (process.env.ADMIN_PASSWORD) {
      try {
        const aEmail = process.env.ADMIN_EMAIL || 'admin@saude.app';
        const admin = await configurarMfa(ctx, aEmail, process.env.ADMIN_PASSWORD);
        save('admin.json', descritor(aEmail, process.env.ADMIN_PASSWORD, admin, { secret: admin.secret }));
        creds.admin = { email: admin.user.email };

        const sEmail = process.env.E2E_STAFF_EMAIL || 'atendente.e2e@saude.app';
        const sPassword = process.env.E2E_STAFF_PASSWORD || `${randomBytes(12).toString('base64url')}Aa1!`;
        const auth = { Authorization: `Bearer ${admin.token}` };
        const created = await ctx.post('/admin/users', {
          headers: auth,
          data: { full_name: 'Atendente E2E', email: sEmail, password: sPassword, role: 'atendente', account_status: 'ativo', mobile: '(87) 98888-7777' },
        });
        // 409/400 = já existia de uma execução anterior: aí a senha só vale se veio do ambiente.
        if (created.ok() || process.env.E2E_STAFF_PASSWORD) {
          const staff = await configurarMfa(ctx, sEmail, sPassword);
          save('atendente.json', descritor(sEmail, sPassword, staff, { secret: staff.secret }));
          creds.staff = { email: sEmail, password: sPassword };
        } else {
          console.warn('[e2e] atendente já existe e E2E_STAFF_PASSWORD não foi informada: testes de atendente serão pulados.');
        }
      } catch (err) {
        console.warn('[e2e] sem sessão de admin/atendente:', err?.message || err);
      }
    }
  } finally {
    await ctx.dispose();
  }
  save('creds.json', creds);
}
