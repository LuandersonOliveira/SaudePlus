import { request } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Sessões criadas UMA vez para a suíte inteira, por API (sem passar pela tela de login).
 *
 * `/auth/login` é limitado (60 tentativas/15 min) e ainda trava o IP; um login por
 * teste estouraria o limite e os últimos testes morreriam de timeout — falha de
 * infraestrutura, não de página. A sessão do React vive em localStorage
 * (saude_token / saude_user / saude_refresh), então o storageState é montado direto.
 *
 *  - admin: ADMIN_EMAIL/ADMIN_PASSWORD do ambiente (sem eles, os testes de admin são pulados);
 *  - atendente: criado pelo admin com senha ALEATÓRIA desta execução (nunca uma senha conhecida
 *    num banco que pode ser o real); a senha vai para .auth/creds.json, que o git ignora;
 *  - paciente: signup idempotente (409 tolerado), como antes.
 */
const AUTH_DIR = resolve(__dirname, '.auth');
const ORIGIN_FRONT = process.env.E2E_BASE_URL || 'http://localhost:8080';
const API = process.env.E2E_API_BASE_URL || 'http://localhost:4000';

const PAUSA_429 = 30_000;
const TENTATIVAS_MAX = 34; // 17 min: o limitador GLOBAL da API é 300 req/15min

function stateFrom(data) {
  const ls = [
    { name: 'saude_token', value: data.token },
    { name: 'saude_user', value: JSON.stringify(data.user) },
  ];
  if (data.refreshToken) ls.push({ name: 'saude_refresh', value: data.refreshToken });
  return { cookies: [], origins: [{ origin: new URL(ORIGIN_FRONT).origin, localStorage: ls }] };
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

function save(name, data) {
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(resolve(AUTH_DIR, name), JSON.stringify(data));
}

export default async function globalSetup() {
  const ctx = await request.newContext({ baseURL: API });
  const creds = {};
  try {
    // ---- paciente ----
    const pEmail = process.env.E2E_PATIENT_EMAIL || 'paciente.e2e@saude.app';
    const pPassword = process.env.E2E_PATIENT_PASSWORD || 'senha-e2e-123456';
    try {
      const res = await ctx.post('/auth/signup', {
        data: { email: pEmail, password: pPassword, full_name: 'Paciente E2E', birth_date: '1990-01-01', cpf: '52998224725' },
      });
      if (res.status() !== 201 && res.status() !== 409) console.warn(`[e2e] signup do paciente devolveu ${res.status()}`);
      save('paciente.json', stateFrom(await login(ctx, pEmail, pPassword)));
      creds.patient = { email: pEmail };
    } catch (err) {
      console.warn('[e2e] sem sessão de paciente:', err?.message || err);
    }

    // ---- admin e atendente ----
    if (process.env.ADMIN_PASSWORD) {
      try {
        const admin = await login(ctx, process.env.ADMIN_EMAIL || 'admin@saude.app', process.env.ADMIN_PASSWORD);
        save('admin.json', stateFrom(admin));
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
          save('atendente.json', stateFrom(await login(ctx, sEmail, sPassword)));
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
