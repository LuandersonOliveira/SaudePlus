# Saúde+ Estabilização e Profissionalização — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o Saúde+ rodar localmente por um único comando, corrigir os 24 defeitos CRITICAL+HIGH que quebram funcionalidades visíveis, e fechar a lacuna de cobertura de teste.

**Architecture:** O projeto é HTML/JS/CSS sem build (frontend) + Node/Express + MySQL (backend em `server/`). O frontend roda como estático em `:8080` e a API em `:4000`, com CORS por allowlist exata. A Fase 0 introduz um `package.json` na raiz que orquestra os dois processos e scripts de setup/diagnóstico, sem alterar a premissa "frontend sem dependências" do DESIGN.md.

**Tech Stack:** Node >= 18 (testado em v24.18.0), Express 4, mysql2/promise, zod 4, bcryptjs, jsonwebtoken, helmet, `node:test` (runner nativo, zero dependência), `concurrently` + `serve` como devDependencies da raiz.

**Spec:** Este documento. A análise que o originou está em `docs/superpowers/plans/2026-10-16-saudeplus-estabilizacao.md` §Achados e nos 24 itens abaixo.

## Global Constraints

- **Zero dependência nova no backend.** `server/package.json` só ganha `devDependencies` de lint/test se estritamente necessário; testes usam `node:test`.
- **Node >= 18** (`server/package.json` `engines.node`). Não usar API acima disso.
- **Nenhuma coluna/rota nova sem migration idempotente** correspondente. `schema.sql` é a união de todas as migrations e precisa staying em sincronia.
- **Códigos de status preservados** onde o front já depende deles (`auth.html`, `dashboard.html`, `admin.html`, `atendente.html` leem `data.error`).
- **Mensagens de erro em português do Brasil**, exceto erros do Zod (ver Task 8, passo 4, que os traduz).
- **Portas fixas por contrato:** API `4000`, front `8080`. `CORS_ORIGIN` no `.env` casa com `http://localhost:8080`.
- **Nunca logar PII** (CPF/RG/CNS, senha, token) em `console` — o `sanitizeDetails` é a barreira e não pode ser contornado.
- **Não introduzir build step, bundler ou framework no frontend.** HTML/JS/CSS puro, como o DESIGN.md declara.
- **Português no código:** comentários, nomes de função e strings de usuário em pt-BR, seguindo o estilo existente (`req.audit`, `validateBooking`, `setFieldError`).

## Review Focus

Cinco classes de entrada que nenhum teste existente exercita e que são as que mais vão doer:

1. **`full_name` com apóstrofo ou aspas** (`Maria d'Ávila`, `O'Brien`) — o `esc()` atual só escapa `/[&<>"]/`, e o resultado é interpolado dentro de `onclick="fn('...')"`. Comportamento esperado: o botão abre o histórico. Hoje: SyntaxError e o botão morre em silêncio.
2. **Payload de `PUT /auth/me` sem uma chave** (formulário de perfil que não tem o campo, ex. `job_role` no admin/atendente) — o back hoje faz `coluna || null` e apaga o dado. Comportamento esperado: chave ausente = mantém; chave presente e vazia = limpa. Esse contrato já existe para `cpf`/`rg`/`cns` via `has(v)` e precisa ser estendido a todas as colunas.
3. **`reason` de status > 255 caracteres** em `PATCH /admin/users/:id` — o `sanitizeDetails` corta em 1000 e a coluna `audit_log.details` é `VARCHAR(255)`. Comportamento esperado: a ação acontece **e** a auditoria é gravada (com a coluna alargada), nunca uma sem a outra.
4. **Login com MFA habilitado** — a resposta é `{mfa_required, mfa_token}` sem `token`/`user`. Comportamento esperado: nenhum dado de sessão gravado; `getSession()` retorna `null` em vez de lançar.
5. **`admin_level` ausente/NULL num usuário `role='admin'`** — hoje `requireCapability` cai em `gestor`, que tem todas as capacidades. Comportamento esperado: negado (403) até o nível ser explicitamente atribuído.

---

## File Structure

**Raiz (novo):**
- `package.json` — orquestração de comandos. Dono de: todos os scripts npm do nível raiz.
- `scripts/db-setup.js` — bootstrap idempotente do banco. Dono de: criar schema + rodar migrations em ordem + seeds.
- `scripts/doctor.js` — diagnóstico do ambiente. Dono de: verificar pré-requisitos e imprimir comandos de correção.
- `.gitignore` — modificar: adicionar `node_modules/`.

**Backend (`server/`) — modificado:**
- `src/app.js` — CORS, `trust proxy`, `express.urlencoded`, ordem dos middlewares.
- `src/server.js` — validação de configuração no boot.
- `src/db.js` — handler de erro do pool.
- `src/routes/auth.routes.js` — MFA, `PUT /auth/me` partial update, lockout por conta.
- `src/routes/me.booking.routes.js` — transação no booking.
- `src/routes/admin.users.routes.js` — cap de `reason`, gating por capability.
- `src/utils/audit.js` — cap de `details`, erro 1406 visível.
- `src/utils/booking.js` — filtro de oferta no catálogo, duração por agendamento.
- `src/utils/crypto.js` — fail-closed.
- `src/middleware/capabilities.js` — fail-closed + capability `admins`.
- `src/jobs/reminders.js` — isolamento por linha.
- `schema.sql` — unir todas as migrations.
- `migration_003_audit_details.sql` — novo: `audit_log.details` → `TEXT`.
- `package.json` — scripts `migrate:all`, `test`.

**Frontend — modificado:**
- `assets/styles.css` — fechar o comentário órfão; `.grid-3`; `.opt`.
- `assets/api.js` — sessão com MFA, refresh selectivo, `getStoredUser` defensivo.
- `auth.html`, `dashboard.html`, `admin.html`, `atendente.html` — `esc()`, listeners, datas locais.
- `privacy.html` — carregar `assets/api.js`.

**Testes (novo, `server/test/`):** `helpers.test.js`, `crypto.test.js`, `audit.test.js`, `booking.test.js`, `capabilities.test.js`, `api.test.js`.

---

# Fase 0 — Rodar por comandos

### Task 1: `package.json` na raiz + static server seguro

**Files:**
- Create: `package.json`
- Create: `scripts/serve-web.js`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nada (primeira task).
- Produces: scripts npm `dev`, `dev:api`, `dev:web`, `start`, `stop`, `setup`, `db:setup`, `db:migrate`, `db:seed`, `test`, `doctor`. Os scripts `dev:api` e `dev:web` são consumidos por `dev` via `concurrently` e por `dev:*` nas fases seguintes.

**Why a custom static server em vez de `serve`:** `serve` na raiz do repositório expõe `server/.env` (contém `DB_PASSWORD`, `JWT_SECRET`, `DATA_ENCRYPTION_KEY`) e `server/backups/`. Um servidor de allowlist de ~40 linhas elimina a classe inteira do problema e remove uma dependência.

- [ ] **Step 1: Escrever o servidor estático com allowlist explícita**

Criar `scripts/serve-web.js`. Contrato: lê `WEB_PORT` do ambiente (default `8080`) e `WEB_HOST` (default `127.0.0.1`); serve **apenas** caminhos que casem com `^/(index|auth|dashboard|admin|atendente|privacy)\.html$` ou `^/assets/[A-Za-z0-9._/-]+\.(css|js|woff2|svg|png|webmanifest)$`; qualquer outro caminho responde `404` com corpo JSON `{"error":"Rota não encontrada."}`; `/` redireciona `301` para `/index.html`; resolve o path com `path.resolve` e rejeita se não estiver dentro da raiz do repositório (proteção contra `..`); define `Content-Type` por extensão com allowlist; `Cache-Control: no-cache` para `.html` e `.css`, `max-age=31536000, immutable` para `assets/fonts/*`; exporta `createWebServer()` e só chama `listen` quando executado diretamente (`require.main === module`) para permitir teste com porta efêmera.

- [ ] **Step 2: Escrever o teste que prova que `.env` não é servido**

Criar `server/test/web-server.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWebServer } = require('../../scripts/serve-web');

// helper: sobe em porta 0 e devolve a base
async function withServer(fn) { /* server.listen(0); try { await fn(base) } finally { close } */ }

test('serve-web não expõe server/.env', async () => {
  await withServer(async (base) => {
    for (const p of ['/server/.env', '/server/.env.example', '/.gitignore', '/server/backups/x.gz', '/../server/.env']) {
      const res = await fetch(base + p);
      assert.equal(res.status, 404, `${p} deveria dar 404`);
    }
  });
});

test('serve-web entrega as páginas e assets permitidos', async () => {
  await withServer(async (base) => {
    for (const p of ['/index.html', '/auth.html', '/dashboard.html', '/admin.html', '/atendente.html', '/privacy.html', '/assets/styles.css', '/assets/api.js', '/assets/ui.js', '/assets/fonts/inter-latin.woff2']) {
      const res = await fetch(base + p);
      assert.equal(res.status, 200, `${p} deveria dar 200`);
    }
    const root = await fetch(base + '/', { redirect: 'manual' });
    assert.equal(root.status, 301);
    assert.equal(root.headers.get('location'), '/index.html');
  });
});

test('serve-web rejeita travessia de caminho', async () => { /* /assets/../../server/.env → 404 */ });
```

- [ ] **Step 3: Rodar o teste para verificar que falha**

Run: `cd server && node --test test/web-server.test.js`
Expected: FAIL com `Cannot find module '../../scripts/serve-web'` (Step 1 não foi feito ainda, ou o require está errado).

- [ ] **Step 4: Criar `package.json` da raiz**

```json
{
  "name": "saude-plus",
  "version": "1.0.0",
  "private": true,
  "description": "Saúde+ — cuidado integrado Lagoa de Itaenga. Orquestra a API (server/) e o frontend estático.",
  "scripts": {
    "setup": "npm --prefix server install && npm run db:setup",
    "dev": "concurrently -k -n api,web -c green,cyan \"npm:dev:api\" \"npm:dev:web\"",
    "dev:api": "npm --prefix server run dev",
    "dev:web": "node scripts/serve-web.js",
    "start": "npm run dev",
    "db:setup": "node scripts/db-setup.js",
    "db:migrate": "npm --prefix server run migrate:all",
    "db:seed": "npm --prefix server run seed:admin && npm --prefix server run seed:demo",
    "test": "npm --prefix server test",
    "doctor": "node scripts/doctor.js"
  },
  "devDependencies": { "concurrently": "^9.1.2" },
  "engines": { "node": ">=18" }
}
```

- [ ] **Step 5: Modificar `.gitignore` da raiz**

Substituir o conteúdo atual (`.impeccable/`) por:

```gitignore
node_modules/
.impeccable/
*.log
```

- [ ] **Step 6: Instalar e rodar o teste para verificar que passa**

Run: `npm install` (na raiz) e depois `node --test server/test/web-server.test.js` (na raiz, para provar que o require relativo funciona de qualquer cwd).
Expected: `npm install` instala 1 pacote (`concurrently`) + 1 transitivo; teste passa com 3 testes, 0 falhas.

- [ ] **Step 7: Verificar visualmente que o front sobe e que `.env` está bloqueado**

Run: `node scripts/serve-web.js` em background; em outro shell, `curl -s -o NUL -w "%{http_code}" http://127.0.0.1:8080/index.html` e `curl -s -o NUL -w "%{http_code}" http://127.0.0.1:8080/server/.env`.
Expected: `200` e `404`. Depois derrubar o processo.

- [ ] **Step 8: Commit**

```bash
git add package.json .gitignore scripts/serve-web.js server/test/web-server.test.js package-lock.json
git commit -m "build: orquestra API e front por comando a partir da raiz"
```

### Task 2: `scripts/doctor.js` — diagnóstico do ambiente

**Files:**
- Create: `scripts/doctor.js`

**Interfaces:**
- Consumes: `server/.env` (via `dotenv` resolvido a partir de `server/node_modules`), `server/src/db.js`.
- Produces: exit code `0` se tudo ok, `1` se algum check falhar; cada linha no formato `[ok] nome — detalhe` / `[FALHA] nome — detalhe` / `[FIX] comando exato para corrigir`.

- [ ] **Step 1: Escrever o script com os 8 checks**

Criar `scripts/doctor.js`. Os checks, na ordem, cada um como uma função `async nome() -> {ok, detail, fix?}`:

1. `node` — `process.versions.node` satisfaz `>=18`. `fix`: `nvm install 18`.
2. `deps` — `server/node_modules` existe **e** `require.resolve('express', { paths: [serverDir] })` funciona. `fix`: `npm install`.
3. `.env` — `server/.env` existe. `fix`: `cd server && cp .env.example .env`.
4. `segredos` — `JWT_SECRET` tem >= 32 chars, `DATA_ENCRYPTION_KEY` casa `/^[0-9a-fA-F]{64}$/`, `ADMIN_PASSWORD` tem >= 8 chars. Reportar **cada** um que falhar, sem imprimir o valor (só comprimento/prefixo). `fix`: o comando `node -e` de geração de segredo.
5. `mysql` — `await pool.query('SELECT 1')` em try/catch. `fix`: mensagem com `DB_HOST`/`DB_USER`/`DB_NAME` (nunca a senha).
6. `banco existe` — `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?`. `fix`: `npm run db:setup`.
7. `migrations` — para cada coluna esperada (`users.govbr_sub`, `users.totp_secret`, `users.totp_enabled`, `users.privacy_version`, `users.cns`, `health_units.cnes_code`, `diseases.source`) e cada tabela esperada (`refresh_tokens`, `audit_log`, `work_schedules`, `professionals`, `professional_offers`, `schedule_blocks`), query em `information_schema`; listar **todas** as ausentes de uma vez. `fix`: `npm run db:migrate`.
8. `portas` — tentar `net.connect` em `4000` e `8080`; reportar "ocupada" ou "livre". Se `8080` ocupada e `4000` livre, adicionar hint de que pode ser o próprio front já rodando.

O script imprime o resultado, um resumo (`N checks, M falhas`), e as linhas `[FIX]` no fim. `process.exit(falhas ? 1 : 0)`.

- [ ] **Step 2: Rodar contra o ambiente atual para ver os checks dispararem**

Run: `node scripts/doctor.js`
Expected: imprime os 8 checks. Neste ambiente: `[ok] mysql`, `[ok] banco existe`, `[ok] migrations` (o banco local já está migrado), `[FALHA] portas` com 8080 e 4000 livres, exit `1` porque `deps`/`segredos` dependem de `.env` — verificar que cada `[FIX]` é um comando que roda de fato.

- [ ] **Step 3: Rodar de novo depois de `npm install` na raiz**

Run: `npm install && node scripts/doctor.js`
Expected: `[ok] deps`. Exit `0` se `.env` estiver válido.

- [ ] **Step 4: Commit**

```bash
git add scripts/doctor.js
git commit -m "build: adiciona doctor para diagnosticar o ambiente local"
```

### Task 3: `scripts/db-setup.js` — bootstrap idempotente do banco

**Files:**
- Create: `scripts/db-setup.js`
- Modify: `server/package.json` (adicionar `migrate:all`)

**Interfaces:**
- Consumes: `server/schema.sql`, os scripts de migration em `server/scripts/migrate-*.js` (cada um `require`s seu próprio `.env` e é idempotente), `mysql2/promise` de `server/node_modules`.
- Produces: exit `0` se o banco está pronto para uso; imprime cada passo. Aceita `--fresh` para dropar e recriar o banco.

**Why this replaces `npm run migrate`:** o script atual no `package.json` é `mysql ... -u %DB_USER% -p%DB_PASSWORD% %DB_NAME% < migration_001.sql` — aspas de `%VAR%` são expandidas só pelo `cmd.exe`, então quebra em PowerShell, Git Bash e em qualquer CI.

- [ ] **Step 1: Adicionar `migrate:all` ao `server/package.json`**

```json
"migrate:all": "npm run migrate:v3 && npm run migrate:security && npm run migrate:privacy && npm run migrate:interop && npm run migrate:audit"
```

- [ ] **Step 2: Escrever `scripts/db-setup.js`**

Comportamento:
- Resolve `serverDir = path.join(__dirname, '..', 'server')`.
- Carrega `server/.env` com `dotenv` resolvido a partir de `serverDir` (via `require.resolve('dotenv', { paths: [serverDir] })`).
- Se `--fresh`: `DROP DATABASE IF EXISTS \`name\`` e `CREATE DATABASE \`name\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`. Usar escape seguro: validar `DB_NAME` contra `/^[A-Za-z0-9_]+$/` e recusar com mensagem clara se não casar (previne injeção via nome de banco).
- Sem `--fresh`: `CREATE DATABASE IF NOT EXISTS` (idempotente, não destrutivo).
- Aplicar `server/schema.sql` lendo o arquivo e executando como `multipleStatements: true` numa conexão própria (o pool de `db.js` não tem essa flag). Depois rodar, em ordem, `migrate-v3`, `migrate-security`, `migrate-privacy`, `migrate-interop`, `migrate-audit` como **subprocessos** (`spawnSync(process.execPath, [script], { stdio: 'inherit' })`), falhando se qualquer uma sair != 0.
- Rodar `seed-admin.js`. **Não** rodar `seed:demo` (opcional, polui o banco) — imprimir a linha "dados demo: npm run db:seed".
- Ao final, imprimir `GET /health` e `GET /ready` como próximos passos.

- [ ] **Step 3: Testar com um banco descartável**

Run: `$env:DB_NAME='saude_doctest'; node scripts/db-setup.js --fresh` e depois `npm --prefix server run migrate:all` de novo (prova idempotência).
Expected: ambas as execuções saem 0. Depois conferir que as 7 colunas de `users` do Task 2.7 existem em `saude_doctest`. **Dropar `saude_doctest` ao final** (o plano não deixa lixo).

- [ ] **Step 4: Corrigir o README para o caminho novo (referência, não execução)**

Substituir o bloco de setup do README (linhas ~210-281) por: `npm run setup` / `npm run doctor` / `npm run dev`, com `schema.sql` + `migrate:all` como o caminho manual equivalente e a ordem correta de migrations **incluindo `migrate:interop`**. Fazer isso agora porque a Fase 1 Task 8 altera `schema.sql` e o README precisa ficar consistente desde já.

- [ ] **Step 5: Commit**

```bash
git add scripts/db-setup.js server/package.json README.md
git commit -m "build: bootstrap idempotente do banco e corrige o caminho de instalacao no README"
```

---

# Fase 1 — Os 9 CRITICAL

### Task 4: Destravar o CSS (`.sr-only` engolido pelo parser)

**Files:**
- Modify: `assets/styles.css:1-18`

**Interfaces:**
- Produces: a regra `.sr-only` (linha atual 18) volta a ser parseada. Nenhuma API nova.

- [ ] **Step 1: Confirmar o defeito antes de corrigir**

Run: `node -e "const fs=require('fs');const c=fs.readFileSync('assets/styles.css','utf8');const i=c.indexOf('.sr-only');console.log('indice .sr-only =',i);console.log('chaves antes =',(c.slice(0,i).match(/\{/g)||[]).length,'chaves depois =',(c.slice(i).match(/\{/g)||[]).length)"`
Expected: `chaves antes` é **1** (só a do `@font-face` na linha 7) — ou seja, o texto solto da linha 11 não abre nada e o `*/` da linha 14 deixa um `{` órfão forthcoming. O sintoma é observável no browser: os skip-links aparecem.

- [ ] **Step 2: Corrigir o cabeçalho**

As linhas 1-14 devem virar **um** bloco de comentário único, com a frase "Identidade" dentro dele. Reescrever linhas 1-14 como:

```css
/* ==========================================================================
   Saúde+ — Design system
   Fonte Inter autohospedada (latin, variável 100–900): zero dependência
   de rede — primeiro paint funciona com 3G instável ou offline.

   Identidade: a "lagoa" (Lagoa de Itaenga) como fio condutor — água, ondas,
   conexão que se espalha. Paleta de alto contraste e tipografia generosa
   porque o público inclui pessoas com baixa familiaridade digital.
   ========================================================================== */
```

E mover o `@font-face` original (linhas 6-10) para **depois** desse cabeçalho, mantendo `display=swap` e o caminho `fonts/inter-latin.woff2` intactos.

- [ ] **Step 3: Verificar que o CSS agora parseia**

Run: o mesmo comando do Step 1.
Expected: `chaves antes` = 2 (o `@font-face` + o `:root` da linha 20) e `.sr-only` agora é alcançado sem órfão.

- [ ] **Step 4: Verificar no browser**

Run: `npm run dev`, abrir `http://127.0.0.1:8080/index.html` e `dashboard.html` (login como admin).
Expected: o link "Pular para o conteúdo" **não** aparece como texto visível no topo; os rótulos `sr-only` do `dashboard` (ex.: "Digite a especialidade" sobre o campo de busca) não duplicam o placeholder.

- [ ] **Step 5: Commit**

```bash
git add assets/styles.css
git commit -m "fix(css): fecha comentario orfao que descartava a regra .sr-only"
```

### Task 5: `esc()` escapa apóstrofo e os botões de histórico param de morrer

**Files:**
- Modify: `admin.html` (definição de `esc`, linha ~1425; chamadas em ~641, 733, 777, 1139, 1145-1146, 1213, 1218, 1415-1417)
- Modify: `atendente.html` (`esc` linha ~675; chamada em ~625; também ~614)
- Modify: `dashboard.html` (`esc` linha ~483)

**Interfaces:**
- Produces: `esc(value)` passa a escapar `'` → `&#39;`. Um novo helper `data-*` para os dois botões de histórico: `showHistoryFromAttr(event)` em `admin.html` e `viewPatientFromAttr(event)` em `atendente.html`, que leem `event.currentTarget.dataset.id` e `event.currentTarget.dataset.name`.

- [ ] **Step 1: Escrever o teste de caracterização do `esc`**

Não há runner de DOM (o projeto é sem build e sem jsdom). Testar a lógica de escape extraindo-a para um módulo? Não — `esc` é redefinida por página. **Em vez disso**, adicionar a um `server/test/web-server.test.js` um check de sanidade do HTML servido: para cada `admin.html`/`atendente.html`/`dashboard.html`, afirmar que não existe nenhum `onclick="…('` seguido de `${esc(` sem `&#39;` no conjunto. Isso é frágil demais para valer como teste.

**Decisão: cobrir com o teste de integração do Task 13 (`api.test.js`) + verificação manual**, e adicionar uma asserção estática simples e útil — `scripts/doctor.js` ganha um check `frontend-escaping` que roda um regex sobre os três arquivos e falha se encontrar `onclick="` contendo `${esc(` e não contendo `&#39;`:

- [ ] **Step 1: Estender `esc` nos três arquivos**

Em `admin.html`, `atendente.html` e `dashboard.html`, mudar o mapa de substituição para incluir apóstrofo:

```js
const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function esc(s) { return (s ?? '').toString().replace(/[&<>"']/g, c => ESC_MAP[c]); }
```

- [ ] **Step 2: Converter os dois botões de histórico para `data-*` + listener delegado**

`admin.html:1145-1146` — substituir os dois botões:

```html
<button class="btn btn-outline btn-sm" data-act="view-user" data-id="${esc(u.id)}">Abrir perfil</button>
<button class="btn btn-outline btn-sm" data-act="show-history" data-id="${esc(u.id)}" data-name="${esc(u.full_name || '')}">Abrir histórico</button>
```

e adicionar um único listener delegado no `document` (ao lado do `document.querySelectorAll('.tabs')` que já existe nesse arquivo):

```js
document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-act]');
  if (!btn) return;
  if (btn.dataset.act === 'show-history') return showHistory(btn.dataset.id, btn.dataset.name);
  if (btn.dataset.act === 'view-user') return viewUser(btn.dataset.id);
});
```

`atendente.html:625` — mesma troca, com `data-act="view-history"` e o handler chamando `viewPatient(btn.dataset.id, btn.dataset.name)`.

- [ ] **Step 3: Verificar no browser com um nome problemático**

Run: `npm run db:seed` e depois, no admin, localizar/criar um usuário chamado `Maria d'Ávila Souza`.
Expected: clicar em "Abrir histórico" abre o modal. Conferir no console que não há SyntaxError. Repetir no `atendente.html` com "Ver histórico".

- [ ] **Step 4: Adicionar o check `frontend-escaping` no `doctor.js` e rodar**

Run: `node scripts/doctor.js`
Expected: `[ok] frontend-escaping — nenhuma interpolação onclick sem escape de apóstrofo`.

- [ ] **Step 5: Commit**

```bash
git add admin.html atendente.html dashboard.html scripts/doctor.js
git commit -m "fix(front): escapa apostrofo e delega os botoes de historico via data-attributes"
```

### Task 6: `PUT /auth/me` como partial update (mata 2 bugs: cargo apagado e campo obrigatório apagado)

**Files:**
- Modify: `server/src/routes/auth.routes.js:600-666`
- Create: `server/test/profile-partial-update.test.js`
- Modify: `dashboard.html:1480-1496`, `admin.html:1543-1557`, `atendente.html:435-450` (só o necessário)

**Interfaces:**
- Produces: contrato documentado de `PUT /auth/me` — **chave ausente = mantém; chave presente e vazia = limpa; chave presente com valor = valida e grava**. Aplica-se a **todas** as colunas, não só `cpf`/`rg`/`cns`. Whitelists de ENUM exportadas de `server/src/utils/validators.js`: `VALID_GENDERS`, `VALID_BLOOD_TYPES`, `VALID_ZONES`, `VALID_PRIORITIES`, `VALID_RACES`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `server/test/profile-partial-update.test.js`. Ele usa o app real em porta efêmera e um token assinado, mais um pool real (o banco `saude` local de desenvolvimento serve). Cada teste cria um usuário descartável com e-mail `partial+<n>@test.local` e **no fim** faz `DELETE FROM users WHERE email LIKE 'partial+%@test.local'`.

```js
test('PUT /auth/me sem job_role preserva o cargo existente', async () => {
  // arrange: INSERT user com job_role='Recepcionista'
  // act: PUT /auth/me { full_name: 'Fulano', phone: '87999999999' }
  // assert: 200 e SELECT job_role do banco ainda é 'Recepcionista'
});

test('PUT /auth/me com job_role vazio limpa o cargo', async () => {
  // PUT { job_role: '' } → job_role IS NULL
});

test('PUT /auth/me sem gender preserva, com gender inválido devolve 400', async () => {
  // sem gender → mantém; { gender: 'xablau' } → 400 e banco intocado
});

test('PUT /auth/me sem birth_date preserva a data de nascimento', async () => {
  // sem birth_date → mantém (dia da mãe que edita o telefone não perde o birthday)
});
```

- [ ] **Step 2: Rodar para verificar que falha**

Run: `node --test server/test/profile-partial-update.test.js`
Expected: FAIL — `job_role` volta `NULL` e `gender: 'xablau'` volta `200`.

- [ ] **Step 3: Exportar as whitelists de ENUM de `validators.js`**

Em `server/src/utils/validators.js`, derivar e exportar `VALID_GENDERS`, `VALID_BLOOD_TYPES`, `VALID_ZONES` a partir dos valores que `schema.sql` declara nos ENUM (ler `schema.sql` e copiar literalmente a lista de cada). Manter `VALID_PRIORITIES` e `VALID_RACES` como estão.

- [ ] **Step 4: Reescrever o handler como partial update**

Em `auth.routes.js`, substituir o `pool.query('UPDATE users SET ... ')` fixo (linhas 636-661) por construção dinâmica. Algoritmo: começar com `sets = []` e `params = []`; um helper local `setIfPresent(coluna, valor)` que só empurra quando `Object.prototype.hasOwnProperty.call(req.body, coluna)`; para cada coluna de texto (`full_name`, `social_name`, `phone`, `mobile`, `mother_name`, `father_name`, `guardian_name`, `cep`, `street`, `address_number`, `neighborhood`, `city`, `state`, `zone`, `reference_point`, `job_role`) aplicar `setIfPresent(coluna, trimmed || null)`; para as ENUM (`gender`, `blood_type`) aplicar `setIfPresent` **e** devolver `400` com mensagem pt-BR se o valor não estiver na whitelist; para `birth_date` aplicar `setIfPresent` validando `YYYY-MM-DD` e `400` se malformado; `priority` e `race` manter a lógica existente mas sob `setIfPresent`. Os documentos (`cpf`/`rg`/`cns`) manter exatamente a lógica `has()`/`blank()` atual. Se `sets.length === 0`, devolver `400` com `{ error: 'Nenhum campo para atualizar.' }` (um PUT vazio hoje faz um UPDATE inócuo e ainda devolve `ok`).

`full_name` mantém o fallback `|| req.user.full_name` **apenas** quando a chave está ausente — nunca quando vem vazia explícita, e nesse caso devolver `400` (`full_name` é obrigatório por `schema.sql`).

- [ ] **Step 5: Rodar o teste para verificar que passa**

Run: `node --test server/test/profile-partial-update.test.js`
Expected: PASS, 4 testes, 0 falhas.

- [ ] **Step 6: Ajustar o front para o novo contrato**

`dashboard.html:1486` e `:1490` usam `get('p_birth_date') || undefined` e `get('p_mobile') || undefined`. Com partial update, `undefined` (chave ausente) = mantém — que é o comportamento desejado quando o usuário **não** apagou o campo. Mas se o usuário apagar de propósito, o `|| undefined` continuaSignificantemente silenciando. Trocar por um helper `field(id)` que retorna `undefined` só quando o campo **não existe na página**, e a string vazia quando o campo existe e está vazio:

```js
const field = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : undefined; };
```

e usar `birth_date: field('p_birth_date')`, `mobile: field('p_mobile')`. Aplicar o mesmo helper em `admin.html` e `atendente.html`. Isso é o que fecha "apagar um campo obrigatório apaga o dado" — agora apagar é intencional e vazio significa limpar.

- [ ] **Step 7: Verificar no browser**

Run: `npm run dev`; login como atendente; em Minha conta, alterar **só** o telefone e salvar.
Expected: toast "Dados atualizados"; recarregar; o campo Cargo continua preenchido. Depois abrir a conta como admin, salvar o perfil, e conferir que `blood_type`/`priority`/`race` sobreviveram.

- [ ] **Step 8: Commit**

```bash
git add server/src/routes/auth.routes.js server/src/utils/validators.js server/test/profile-partial-update.test.js dashboard.html admin.html atendente.html
git commit -m "fix(auth): PUT /auth/me passa a ser partial update e valida colunas ENUM"
```

### Task 7: MFA setup exige senha antes de gerar o segredo

**Files:**
- Modify: `server/src/routes/auth.routes.js:328-360`
- Create: `server/test/mfa-setup.test.js`
- Modify: a tela que chama `mfa/setup` (localizar com grep por `mfa/setup`)

**Interfaces:**
- Consumes: `verifyToken` já aplicado na rota, `bcryptjs` já importado no arquivo.
- Produces: `POST /auth/mfa/setup` aceita `{ password }` no body; responde `400` com `{ error: 'Confirme sua senha para ativar o segundo fator.' }` se ausente/errada; `401` se o token expirou (comportamento atual de `verifyToken`).

- [ ] **Step 1: Escrever o teste que falha**

Criar `server/test/mfa-setup.test.js`:

```js
test('POST /auth/mfa/setup exige a senha do titular', async () => {
  // arrange: usuário real no banco local + token assinado desse id
  // act: POST /auth/mfa/setup { }
  // assert: 400 e users.totp_secret permanece NULL
});

test('POST /auth/mfa/setup com senha errada não gera segredo', async () => {
  // { password: 'senha-errada-123' } → 401/400, totp_secret NULL
});

test('POST /auth/mfa/setup com senha correta devolve o segredo e persiste', async () => {
  // { password: '<senha real>' } → 200, body.secret casa /^[A-Z2-7]{32}$/,
  // e users.totp_secret === body.secret
  // cleanup: UPDATE users SET totp_secret=NULL, totp_enabled=0 WHERE id=?
});
```

- [ ] **Step 2: Rodar para verificar que falha**

Run: `node --test server/test/mfa-setup.test.js`
Expected: FAIL — hoje responde `200` mesmo sem senha.

- [ ] **Step 3: Exigir a senha no handler**

Em `auth.routes.js`, dentro de `router.post('/mfa/setup', verifyToken, ...)`:

1. `const password = String(req.body.password || '');` — devolver `400` se vazio.
2. `const [[row]] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);` — devolver `404` se não encontrado.
3. `const ok = await bcrypt.compare(password, row.password_hash);` — devolver `401` com `{ error: 'Senha incorreta.' }` se falso. Usar `bcrypt.compare` com um `catch` (hash corrompido não deve virar 500).
4. Só então gerar o segredo e persistir.

**NÃO** permitir re-enrolar quando `totp_enabled = 1` (essa guarda já existe na linha 332 e precisa permanecer, senão o cenário acima continua destrutivo). Para trocar o因子 de um usuário com MFA ativo, o caminho é `mfa/disable`, que já exige senha.

- [ ] **Step 4: Atualizar o front**

Localizar a chamada a `mfa/setup` (grep). Ela precisa mandar a senha. Se a tela não tem campo de senha, **não** pedir a senha do usuário num prompt nativo (o DESIGN.md proíbe `prompt`/`alert`/`confirm`) — reaproveitar o modal de senha que já existe (`passwordModal` no `dashboard.html`) ou mostrar um erro orientationsivo pedindo `POST /auth/mfa/disable` primeiro.

- [ ] **Step 5: Rodar o teste para verificar que passa**

Run: `node --test server/test/mfa-setup.test.js`
Expected: PASS, 3 testes, 0 falhas.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/auth.routes.js server/test/mfa-setup.test.js dashboard.html admin.html
git commit -m "fix(auth): mfa/setup exige a senha do titular antes de gerar o segredo"
```

### Task 8: Auditoria nunca mais perde registro (`details` → `TEXT` + cap do `reason`)

**Files:**
- Create: `server/migration_003_audit_details.sql`
- Modify: `server/schema.sql:277`
- Modify: `server/src/utils/audit.js:33` e `91-94`
- Modify: `server/src/routes/admin.users.routes.js:128` e `server/src/routes/admin.professionals.routes.js:33`
- Modify: `server/scripts/migrate-audit.js` (para incluir a 003, ou criar `migrate-audit-details.js`)
- Create: `server/test/audit-details.test.js`

**Interfaces:**
- Produces: `audit_log.details` aceita 1000 chars (o teto do `sanitizeDetails`). Nenhum motivo de status é perdido por truncamento.

- [ ] **Step 1: Escrever o teste que falha**

Criar `server/test/audit-details.test.js`:

```js
test('logAction persiste details de 900 caracteres', async () => {
  // act: logAction(actorId, 'user.status', 'users', id, 'x'.repeat(900))
  // assert: a linha existe e details.length === 900
  // cleanup: DELETE do id criado
});

test('sanitizeDetails nunca devolve mais de 1000 caracteres', async () => {
  assert.equal(sanitizeDetails('y'.repeat(5000)).length, 1000);
});

test('um motivo de status longo não perde a auditoria', async () => {
  // E2E: PATCH /admin/users/:id com reason de 400 chars
  // assert: 200 E existe audit_log com action='user.status' e details contendo o motivo
});
```

O terceiro teste é o que realmente prova o bug do produto.

- [ ] **Step 2: Rodar para verificar que falha**

Run: `node --test server/test/audit-details.test.js`
Expected: FAIL no teste 1 e no 3 (`ER_DATA_TOO_LONG` engolido em `utils/audit.js:93`, logo a linha não existe).

- [ ] **Step 3: Criar a migration 003 e aplicá-la**

`server/migration_003_audit_details.sql`:

```sql
-- 003 — audit_log.details: VARCHAR(255) → TEXT
-- Motivo: sanitizeDetails() permite até 1000 caracteres e admin.users.routes.js /
-- admin.professionals.routes.js concatenam `reason` sem teto. Com a coluna em 255,
-- uma justificativa longa fazia a ação acontecer SEM gravar a auditoria
-- (ER_DATA_TOO_LONG engolido em utils/audit.js) — quebrando a cadeia de hash.
-- Idempotente.
ALTER TABLE audit_log MODIFY COLUMN details TEXT NULL;
```

Adicionar `"migrate:audit:details": "node scripts/migrate-audit-details.js"` ao `server/package.json`, com um script JS que executa o SQL acima e é idempotente (checar `information_schema.columns` antes). Incluir no `migrate:all` **e** em `migrate-audit.js` (para quem já rodou o audit antes).

- [ ] **Step 4: Alterar `schema.sql`**

`schema.sql:277`: `details VARCHAR(255) NULL,` → `details TEXT NULL,`. Fazer a mesma alteração ao regenerar `schema.sql` no Task 9.

- [ ] **Step 5: Tornar o erro de auditoria visível**

Em `utils/audit.js`, no `catch` de `91-94`: manter o `console.error` (não derrubar a requisição é o contrato), mas incluir `err.code` na mensagem e **remover** o silencioso para `ER_DATA_TOO_LONG` especificamente — nesse caso, truncar o `details` para 255 **e reexecutar** o insert, garantindo que nenhuma ação fique sem rastro mesmo em banco não migrado. Escrever o código do `catch` para que o fallback de truncamento exista mesmo em produção sem migration aplicada.

- [ ] **Step 6: Capar o `reason` na origem**

Em `admin.users.routes.js:128`, trocar `String(reason || status_notes || '').trim()` por `String(reason || status_notes || '').trim().slice(0, 1000)`.

Em `admin.professionals.routes.js:33`, aplicar o mesmo `.slice(0, 1000)` no `parseReason`.

- [ ] **Step 7: Rodar o teste para verificar que passa**

Run: `node --test server/test/audit-details.test.js`
Expected: PASS, 3 testes, 0 falhas.

- [ ] **Step 8: Commit**

```bash
git add server/migration_003_audit_details.sql server/schema.sql server/scripts/migrate-audit-details.js server/scripts/migrate-audit.js server/package.json server/src/utils/audit.js server/src/routes/admin.users.routes.js server/src/routes/admin.professionals.routes.js server/test/audit-details.test.js
git commit -m "fix(audit): details vira TEXT para que nenhuma acao fique sem rastro"
```

### Task 9: `schema.sql` = união de todas as migrations + `migrate:interop` no README

**Files:**
- Modify: `server/schema.sql` (adicionar `refresh_tokens`, colunas de `users`, colunas de `health_units`/`diseases`, FK do `audit_log`)
- Modify: `server/scripts/migrate-v3.js` / `migrate-security.js` / `migrate-privacy.js` / `migrate-interop.js` / `migrate-audit.js` (fonte da verdade)
- Create: `server/test/schema-parity.test.js`

**Interfaces:**
- Produces: um banco criado só com `server/schema.sql` tem **todas** as colunas que o código toca. Teste de paridade garante que isso não regrada.

- [ ] **Step 1: Inventariar a diferença**

Rodar e colar no commit as duas listas: as colunas que `schema.sql` cria, e as que os `migrate-*.js` criam. A diferença conhecida (verificada nesta análise) é:

| Falta em `schema.sql` | Criado por | Quebraria |
|---|---|---|
| tabela `refresh_tokens` | `migrate-security.js` | `POST /auth/refresh` → 500 |
| `users.totp_secret`, `users.totp_enabled` | `migrate-audit.js` | `POST /auth/mfa/setup` → 500 |
| `users.govbr_sub` (+ índice) | `migrate-interop.js` | `GET /auth/govbr/callback` → 500 |
| `users.privacy_version`, `users.consent_at`, `users.consent_ip`, `users.deleted_at` | `migrate-privacy.js` | `POST /auth/signup` → `Unknown column 'privacy_version'` |
| `users.cns` | `migrate-v3.js` | CNS no perfil |
| `health_units.cnes_code`, `.phone`, `.address` | `migrate-interop.js` | `npm run sync:cnes` aborta |
| `diseases.source`, `.external_ref` | `migrate-interop.js` | `npm run sync:alerts` aborta |
| `audit_log.prev_hash`, `.entry_hash`, `.seq` + trigger de FK `RESTRICT` | `migrate-audit.js` | MFA e cadeia de hash |

**Consequência a documentar no README:** sem `migrate:interop`, `users.totp_enabled` fica `undefined` e **o login nunca pede o segundo fator** — falha silenciosa, sem erro em lugar nenhum.

- [ ] **Step 2: Escrever o teste de paridade que falha**

Criar `server/test/schema-parity.test.js`:

```js
test('schema.sql cobre toda coluna e tabela tocada pelo código', async () => {
  // cria um banco efêmero (saude_parity_<pid>), aplica SÓ server/schema.sql
  // e afirma que existe: refresh_tokens, users.totp_secret, users.totp_enabled,
  // users.govbr_sub, users.privacy_version, users.consent_at, users.consent_ip,
  // users.deleted_at, users.cns, health_units.cnes_code, health_units.phone,
  // health_units.address, diseases.source, diseases.external_ref,
  // audit_log.prev_hash, audit_log.entry_hash, audit_log.seq
  // no finally: DROP DATABASE
});
```

- [ ] **Step 3: Rodar para verificar que falha**

Run: `node --test server/test/schema-parity.test.js`
Expected: FAIL, listando as 15 peças ausentes.

- [ ] **Step 4: Completar `schema.sql`**

Aplicar, em `schema.sql`, exatamente os mesmos `ALTER`/blocos que os `migrate-*.js` aplicam — copiando o SQL deles, não redisenhando. Para a FK do `audit_log`, incluir `ON DELETE RESTRICT ON UPDATE RESTRICT` (o `migrate-audit.js` já tem isso). Manter os `CREATE TABLE IF NOT EXISTS` e o `INSERT` das 10 unidades de seed que já existem.

- [ ] **Step 5: Rodar o teste de paridade para verificar que passa**

Run: `node --test server/test/schema-parity.test.js`
Expected: PASS.

- [ ] **Step 6: Corrigir o README**

Acrescentar `npm run migrate:interop` na tabela de scripts (linha ~303 já o documenta como script, mas **não** está na sequência do passo 2) e na nota de ordem. Adicionar uma nota explícita: *"Pular `migrate:interop` não dá erro visível — apenas desliga o MFA silenciosamente."*

- [ ] **Step 7: Rodar o bootstrap completo do zero para provar**

Run: `$env:DB_NAME='saude_parity_run'; node scripts/db-setup.js --fresh`; depois `node --test server/test/schema-parity.test.js`; depois dropar `saude_parity_run`.
Expected: exit 0 nos três. Este é o teste de aceitação de "instalar do zero funciona".

- [ ] **Step 8: Commit**

```bash
git add server/schema.sql server/test/schema-parity.test.js README.md
git commit -m "fix(schema): schema.sql passa a cobrir todas as migrations e o README documenta migrate:interop"
```

### Task 10: `/catalog/slots` só oferece slots que o booking aceita

**Files:**
- Modify: `server/src/utils/booking.js:362-398`
- Create: `server/test/catalog-slots.test.js`

**Interfaces:**
- Consumes: `professional_offers` como fonte de verdade do par (profissional, unidade) que atende um serviço.
- Produces: `findAvailabilityByService` nunca emite slot cujo par não tem `professional_offers`. `prof` deixa de ter o fallback `|| { name: '', job: '' }`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `server/test/catalog-slots.test.js`:

```js
test('catalog/slots não oferece par sem professional_offers', async () => {
  // arrange: unidade U, profissional P com work_schedule(active=1) mas SEM professional_offers
  // act: GET /catalog/slots?servico=...&unidade=U
  // assert: nenhum slot com professional_id === P aparece na resposta
});

test('catalog/slots oferece o par que tem professional_offers', async () => {
  // mesmo arranjo + professional_offers → o slot aparece com nome do profissional
});
```

- [ ] **Step 2: Rodar para verificar que falha**

Run: `node --test server/test/catalog-slots.test.js`
Expected: FAIL no teste 1 (o slot aparece com `professional_name: ''`).

- [ ] **Step 3: Juntar `work_schedules` com `professional_offers`**

Em `booking.js:362-367`, trocar a query de `schedRows` por uma que só devolve pares vinculados:

```sql
SELECT ws.professional_id, ws.unit_id, ws.weekday, ws.start_time, ws.end_time, ws.slot_minutes
FROM work_schedules ws
JOIN professional_offers po
  ON po.professional_id = ws.professional_id
 AND po.unit_id = ws.unit_id
 AND po.active = 1
WHERE ws.professional_id IN (?) AND ws.unit_id IN (?) AND ws.active = 1
```

Em `:396`, remover o fallback `|| { name: '', job: '' }` e, quando `profByPair.get(key)` for ausente, `continue` (o par não é bookável, não entra no mapa). Verificar se `professional_offers` tem coluna `active` no `schema.sql`; se não tiver, **não** adicionar coluna nova — omitir o filtro `po.active` e usar só a junção por id.

- [ ] **Step 4: Rodar o teste para verificar que passa**

Run: `node --test server/test/catalog-slots.test.js`
Expected: PASS, 2 testes.

- [ ] **Step 5: Verificar no browser**

Run: `npm run db:seed && npm run dev`; login como paciente; aba Agendar → escolher serviço e unidade → carregar horários.
Expected: todo slot clicável conclui o agendamento sem 409. Confirmar no console que nenhuma requisição retorna 409.

- [ ] **Step 6: Commit**

```bash
git add server/src/utils/booking.js server/test/catalog-slots.test.js
git commit -m "fix(booking): catalog/slots so oferece pares com professional_offers vinculado"
```

### Task 11: Booking transacional (fecha o double-booking)

**Files:**
- Modify: `server/src/routes/me.booking.routes.js:60-95` e `140-150`
- Modify: `server/src/utils/booking.js` (`validateBooking` recebe a conexão)
- Create: `server/test/booking-race.test.js`

**Interfaces:**
- Produces: `validateBooking(conn, { tipo, professionalId, unitId, scheduledAt, excludeId })` aceita **qualquer** objeto com `.query()` — pool ou conexão de transação. Today só recebe `pool`; a assinatura não muda, a flexibility que muda.
- Produces: uma função nova `withBookingLock(conn, professionalId, fn)` em `me.booking.routes.js` que faz `SELECT id FROM professionals WHERE id = ? FOR UPDATE` antes de validar, serializando dois agendamentos concorrentes do mesmo profissional.

- [ ] **Step 1: Escrever o teste que falha**

Criar `server/test/booking-race.test.js`:

```js
test('dois agendamentos simultâneos no mesmo horário: só um cria', async () => {
  // arrange: profissional+unidade+serviço+horário livres numa data futura
  // act: Promise.all([POST /me/appointments, POST /me/appointments]) com o MESMO payload
  // assert: exatamente 1 resposta 201 e 1 resposta 409
  // assert: SELECT COUNT(*) FROM appointments naquele horário === 1
});
```

- [ ] **Step 2: Rodar repetidamente para observar a falha**

Run: `for ($i=1; $i -le 20; $i++) { node --test server/test/booking-race.test.js }`
Expected: FALHA intermitente — é uma race. Registrar em quantas das 20 rodadas falhou (esse número é a evidência do bug).

- [ ] **Step 3: Fazer `validateBooking` aceitar uma conexão**

`validateBooking` já recebe `pool` como primeiro parâmetro e só chama `pool.query`. **Nenhuma mudança de assinatura é necessária** — apenas documentar que o parâmetro é "pool ou conexão". Adicionar o comentário no topo da função.

- [ ] **Step 4: Envolver validação + insert em transação com lock**

Em `me.booking.routes.js`, no handler de criação: obter `const conn = await pool.getConnection()`, `await conn.beginTransaction()`, `await conn.query('SELECT id FROM professionals WHERE id = ? FOR UPDATE', [professionalId])`, chamar `validateBooking(conn, {...})`, se houve erro → `rollback` e responder 409; se não → fazer o `INSERT` **usando `conn`**, `commit`, e `finally { conn.release() }`. Aplicar a mesma estrutura em `PUT /:id` (removendo o registro antigo e inserindo o novo dentro da mesma transação). Se `pool.query` de release falhar, o `finally` cobre.

- [ ] **Step 5: Rodar o teste 20 vezes para verificar que passa**

Run: `for ($i=1; $i -le 20; $i++) { node --test server/test/booking-race.test.js }`
Expected: PASS nas 20 rodadas.

- [ ] **Step 6: Verificar no browser**

Run: `npm run dev`, login como paciente, abrir duas abas na tela de agendamento, escolher o mesmo slot e salvar nas duas.
Expected: uma salva, a outra mostra "Horário já reservado".

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/me.booking.routes.js server/src/utils/booking.js server/test/booking-race.test.js
git commit -m "fix(booking): valida e insere em transacao com lock por profissional"
```

---

# Fase 2 — Os 15 HIGH

### Task 12: `trust proxy` + lockout por conta + teto do Map

**Files:**
- Modify: `server/src/app.js:25-52`
- Modify: `server/src/routes/auth.routes.js:90-120`, `:221-229`, `:255`
- Create: `server/test/rate-limit-key.test.js`

**Interfaces:**
- Produces: `trust proxy` configurável — `app.set('trust proxy', N)` com `N` vindo de `TRUST_PROXY_HOPS` (default `0` = desligado, que é o certo para dev local). Documentar no `.env.example`.
- Produces: chave de lockout = `` `${ip}|${email}` `` em vez de só `ip`. Sweep de entradas expiradas a cada chamada, mais teto duro de 10 000 entradas.

- [ ] **Step 1: Escrever o teste que falha**

Criar `server/test/rate-limit-key.test.js`, que extrai a lógica de chave para uma função exportada e a testa como unidade pura:

```js
const { loginKey, sweep } = require('../src/utils/loginThrottle');
assert.equal(loginKey('1.2.3.4', 'A@B.com'), '1.2.3.4|a@b.com');  // normaliza
assert.equal(sweep(map, now).size <= 1, true);                     // limpa expiradas
```

- [ ] **Step 2: Rodar para verificar que falha**

Run: `node --test server/test/rate-limit-key.test.js`
Expected: FAIL — `loginThrottle.js` ainda não existe (a lógica está inline em `auth.routes.js`).

- [ ] **Step 3: Extrair `server/src/utils/loginThrottle.js`**

Mover para lá: o `Map`, `loginKey(ip, email)` (minúsculo + trim no email), `sweep(map, now)` (remove entradas com `windowEndsAt` e `blockedUntil` no passado), `registerFailure(map, key, now, maxAttempts, windowMs)` e `loginBlockInfo(map, key, now)`. Manter os mesmos valores (`LOGIN_MAX_ATTEMPTS`, `LOGIN_WINDOW_MS`) que já existem em `auth.routes.js`. `registerFailure` chama `sweep` e, se `map.size > 10000`, descarta as entradas mais antigas.

- [ ] **Step 4: Reescrever o throttle em `auth.routes.js` para usar o módulo**

Substituir o bloco inline e as chamadas. `loginBlockInfo` passa a receber `loginKey(clientIp(req), body.email)` em vez de só `clientIp(req)`. Adicionar o `sweep` no login com sucesso também (hoje só remove a entrada do próprio IP).

**Consequência de projeto, a registrar no README:** com chave `ip|email`, bloquear a conta de uma pessoa não bloqueia mais a rede inteira — mas também significa que um atacante distribuído contra *um* email não é barrado por IP. Manter `globalLimiter` como limite global por IP.

- [ ] **Step 5: Configurar `trust proxy`**

Em `app.js`, **antes** de qualquer middleware: `const hops = Number(process.env.TRUST_PROXY_HOPS) || 0; if (hops > 0) app.set('trust proxy', hops);`. Adicionar `TRUST_PROXY_HOPS=0` ao `.env.example` com comentário explicando que atrás de nginx/Cloudflare deve ser o número de proxies (1 para um nginx).

- [ ] **Step 6: Mover `/health` e `/ready` para antes do `globalLimiter`**

Hoje `app.use(globalLimiter)` está na linha 46 e `/health` na 52 — um health check a cada 5s estoura a janela de 300 req/15min em ~25 min. Mover o registro de `/health` e `/ready` para **antes** do limiter.

- [ ] **Step 7: Rodar os testes e o smoke-test**

Run: `node --test server/test/rate-limit-key.test.js` e depois `npm --prefix server run smoke-test`.
Expected: PASS no primeiro; no smoke-test, todas as asserções de 401/403 passam e o `GET /health` continua `200` mesmo sem header de `Origin`.

- [ ] **Step 8: Commit**

```bash
git add server/src/utils/loginThrottle.js server/src/routes/auth.routes.js server/src/app.js server/.env.example server/test/rate-limit-key.test.js
git commit -m "fix(auth): lockout por conta em vez de por IP, sweep do Map e trust proxy configuravel"
```

### Task 13: `requireCapability` falha fechado + `superadmin` ≠ `gestor`

**Files:**
- Modify: `server/src/middleware/capabilities.js`
- Modify: `server/src/routes/admin.users.routes.js:112-119` e `:138-146`
- Modify: `admin.html` (espelhar o gating)
- Create: `server/test/capabilities.test.js`

**Interfaces:**
- Produces: `LEVEL_PERMISSIONS` ganha a capability `admins`, só no `superadmin`. `requireCapability('admins')` é o portão para alterar `admin_level` de outro usuário. Nível desconhecido/`null` → **403**, nunca `gestor`.

**Por que `admins` e não só differentiating o array:** hoje `superadmin` e `gestor` são idênticos. Dar ao superadmin uma capability que ele só tem é o que torna a hierarquia real — e `admin.users.routes.js:139` já tentava garantir isso com um `if` solto no controller.

- [ ] **Step 1: Escrever o teste que falha**

Criar `server/test/capabilities.test.js`:

```js
const { requireCapability, LEVEL_PERMISSIONS } = require('../src/middleware/capabilities');

// middleware puro: chame com um req falso
test('admin sem admin_level recebe 403 (não cai em gestor)', () => {
  const res = fakeRes();
  requireCapability('users')({ user: { role: 'admin', admin_level: null } }, res, () => t.fail('não deveria avançar'));
  assert.equal(res.statusCode, 403);
});

test('admin com nível desconhecido recebe 403', () => { /* admin_level: 'root' */ });

test('gestor tem todas as capacidades exceto admins', () => {
  assert.ok(!LEVEL_PERMISSIONS.gestor.includes('admins'));
  assert.ok(LEVEL_PERMISSIONS.superadmin.includes('admins'));
});

test('atendimento só tem appointments', () => {
  assert.deepEqual(LEVEL_PERMISSIONS.atendimento, ['appointments']);
});
```

- [ ] **Step 2: Rodar para verificar que falha**

Run: `node --test server/test/capabilities.test.js`
Expected: FAIL no teste 1 (hoje avança para `next()`).

- [ ] **Step 3: Reescrever `capabilities.js`**

```js
const LEVEL_PERMISSIONS = {
  superadmin: ['users', 'appointments', 'diseases', 'units', 'audit', 'reports', 'admins'],
  gestor: ['users', 'appointments', 'diseases', 'units', 'audit', 'reports'],
  atendimento: ['appointments'],
  alertas: ['diseases'],
};

function requireCapability(capability) {
  return (req, res, next) => {
    const user = req.user;
    // Sem sessão, papel errado ou nível ausente/desconhecido: negado.
    // Nunca degradar para 'gestor' — isso dava todas as capacidades.
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Seu nível administrativo não permite esta operação.' });
    }
    const allowed = LEVEL_PERMISSIONS[user.admin_level];
    if (!allowed || !allowed.includes(capability)) {
      return res.status(403).json({ error: 'Seu nível administrativo não permite esta operação.' });
    }
    return next();
  };
}
```

- [ ] **Step 4: Trocar o `if` solto pela capability em `admin.users.routes.js`**

`:139` — trocar `if (req.user.admin_level !== 'superadmin') return res.status(403)...` por `requireCapability('admins')` no roteador **se** a rota ainda for `.patch('/:id')` com gate existente; se a rota já tem `requireCapability('users')`, encadear as duas. Manter a mensagem de erro em pt-BR.

`:113` — `const targetRank = LEVEL_RANK[currentUser.admin_level] ?? LEVEL_RANK.gestor;` → usar `LEVEL_RANK[currentUser.admin_level]` **sem** fallback e devolver 403 se `undefined`.

- [ ] **Step 5: Espelhar no `admin.html`**

Em `admin.html`, `applyLevelGating` (~510) deve esconder também o controle de **nível administrativo** quando `admin_level !== 'superadmin'` (hoje ele esconde por outra condição). Verificar os dois pontos: o `<select>` de nível dentro do modal de usuário e o texto que mostra o nível atual.

- [ ] **Step 6: Rodar o teste e o smoke-test**

Run: `node --test server/test/capabilities.test.js` e `npm --prefix server run smoke-test`.
Expected: PASS no primeiro. **O smoke-test pode falhar** nos asserts `admin(atendimento) -> /admin/users` se o encadeamento ficou errado — nesse caso, ajustar até os 14 asserts originais passarem, **sem** afrouxá-los.

- [ ] **Step 7: Verificar no browser**

Run: `npm run seed:admin && npm run dev`, login como `admin@saude.app`.
Expected: a lista de usuários e o controle de nível funcionam; um admin de nível `gestor` não vê o controle de nível.

- [ ] **Step 8: Commit**

```bash
git add server/src/middleware/capabilities.js server/src/routes/admin.users.routes.js admin.html server/test/capabilities.test.js
git commit -m "fix(auth): capability falha fechada e superadmin ganha a capability 'admins'"
```

### Task 14: Job de lembretes não aborta mais o lote

**Files:**
- Modify: `server/src/jobs/reminders.js:20-38` e `53-66`
- Create: `server/test/reminders.test.js`

**Interfaces:**
- Produces: `createReminderFor(row, kind)` (o terceiro parâmetro `start`, hoje não lido, é removido) nunca lança: trunca a mensagem e devolve `false` se o insert falhar. `runReminderJob` isola cada linha e **sempre** retorna `{ created, appointments, exams, failed }`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `server/test/reminders.test.js`:

```js
test('createReminderFor não estoura com location de 180 chars', async () => {
  // arrange: specialty com 120 chars + location com 180 chars → message de ~315
  // act: await createReminderFor(row, 'appointment')
  // assert: não rejeita; returns false ou true; e a contagem de reminders não-exploded
});

test('runReminderJob isola a falha de uma linha e processa as demais', async () => {
  // arrange: 3 agendamentos amanhã, um com specialty inválido-longo
  // act: await runReminderJob()
  // assert: failed === 1 e created === 2 (o job não aborta no primeiro erro)
});
```

- [ ] **Step 2: Rodar para verificar que falha**

Run: `node --test server/test/reminders.test.js`
Expected: FAIL — `runReminderJob` rejeita e `created` fica menor que o esperado.

- [ ] **Step 3: Isolar e truncar**

Em `reminders.js`: envolver o corpo de `createReminderFor` num `try/catch` que faz `console.warn` e `return false`; truncar `message` com `.slice(0, 255)` antes do insert (e o `title`, que também é `VARCHAR` — verificar o tamanho no `schema.sql`). Nos dois `for` loops de `runReminderJob`, envolver **cada** iteração em `try/catch` incrementando um contador `failed`. Remover o terceiro parâmetro `start` de `createReminderFor` e das duas chamadas.

- [ ] **Step 4: Rodar o teste para verificar que passa**

Run: `node --test server/test/reminders.test.js`
Expected: PASS, 2 testes.

- [ ] **Step 5: Commit**

```bash
git add server/src/jobs/reminders.js server/test/reminders.test.js
git commit -m "fix(lembretes): isola a falha por linha e trunca a mensagem no limite da coluna"
```

### Task 15: `encryptField` falha fechado em produção + validação de config no boot

**Files:**
- Modify: `server/src/utils/crypto.js:13-38`
- Modify: `server/src/server.js`
- Create: `server/test/crypto.test.js`

**Interfaces:**
- Produces: `crypto.js` exporta `assertCryptoConfigured()` que lança se `DATA_ENCRYPTION_KEY` for inválida e `NODE_ENV=production`. `encryptField` **lança** (em vez de devolver texto puro) quando a chave falta e `NODE_ENV=production`; em dev mantém o `console.warn` e o texto puro, porque sem chave não há como cifrar.
- Produces: `server.js` chama `assertCryptoConfigured()` e valida `JWT_SECRET` (>= 32 chars) antes do `app.listen`, saindo com código 1 e mensagem acionável.

- [ ] **Step 1: Escrever o teste que falha**

Criar `server/test/crypto.test.js`:

```js
test('encryptField devolve texto cifrado com prefixo enc:v1:', () => {
  process.env.DATA_ENCRYPTION_KEY = 'a'.repeat(64);
  const out = encryptField('52998224725');
  assert.ok(out.startsWith('enc:v1:'));
  assert.equal(decryptField(out), '52998224725');
});

test('encryptField Lança em produção sem chave válida', () => {
  process.env.NODE_ENV = 'production';
  process.env.DATA_ENCRYPTION_KEY = '';
  assert.throws(() => encryptField('52998224725'), /DATA_ENCRYPTION_KEY/);
  // finally: restaurar env
});

test('assertCryptoConfigured aceita chave de 64 hex e rejeita 63', () => {
  assert.doesNotThrow(() => assertCryptoConfigured());
  process.env.DATA_ENCRYPTION_KEY = 'a'.repeat(63);
  assert.throws(() => assertCryptoConfigured());
});

test('encryptField é idempotente (não cifra duas vezes)', () => {
  const once = encryptField('123');
  assert.equal(encryptField(once), once);
});
```

- [ ] **Step 2: Rodar para verificar que falha**

Run: `node --test server/test/crypto.test.js`
Expected: FAIL no teste 2 (hoje devolve texto puro) e no 3 (`assertCryptoConfigured` não existe).

- [ ] **Step 3: Implementar**

Em `crypto.js`: adicionar `assertCryptoConfigured()` que valida a chave e, se `NODE_ENV === 'production'` e a chave for inválida, lança `Error` com a mensagem que já existe na linha 19. Em `encryptField`, trocar o `if (!key) return text;` por: se `!key` e `NODE_ENV === 'production'` → `assertCryptoConfigured()` (que lança); senão manter o `return text` + warn.

Em `server.js`: antes do `app.listen`, `assertCryptoConfigured()` e uma checagem de `JWT_SECRET` (`String(process.env.JWT_SECRET || '').length < 32` → `console.error` + `process.exit(1)`).

- [ ] **Step 4: Rodar para verificar que passa**

Run: `node --test server/test/crypto.test.js`
Expected: PASS, 4 testes.

- [ ] **Step 5: Commit**

```bash
git add server/src/utils/crypto.js server/src/server.js server/test/crypto.test.js
git commit -m "fix(seguranca): crypto falha fechada em producao e o boot valida a configuracao"
```

### Task 16: `pool.on('error')` + teto do `loginAttempts` (já coberto no Task 12)

**Files:**
- Modify: `server/src/db.js`
- Modify: `server/.env.example`

O teto do `loginAttempts` é resolvido no Task 12 (sweep + cap). Falta apenas o handler do pool:

- [ ] **Step 1: Adicionar o handler**

```js
pool.on('error', (err) => {
  // Conexão ociosa morre com o MySQL reiniciando / wait_timeout. Sem este
  // listener o mysql2 reemite no pool e o Node mata o processo com
  // 'Unhandled error event'.
  console.error('Erro na conexão do pool MySQL:', err.code || err.message);
});
```

- [ ] **Step 2: Documentar no `.env.example`**

Adicionar `POOL_CONNECTION_LIMIT=10` (opcional) e o comentário explicando que `waitForConnections` está ligado e que o pool se reconecta sozinho.

- [ ] **Step 3: Verificar**

Run: `npm run dev`; em outro shell, `mysql -u root -p -e "SHUTDOWN"` **não** usar (derruba o banco de desenvolvimento). Em vez disso, verificar que `GET /health` e `GET /ready` continuam respondendo após o pool reconectar: parar e subir o serviço MySQL80 com `Restart-Service MySQL80` e reconsultar `/ready`.
Expected: `/ready` volta a `{"ok":true,"db":true}` sem precisar reiniciar o `node`.

- [ ] **Step 4: Commit**

```bash
git add server/src/db.js server/.env.example
git commit -m "fix(db): handler de erro no pool evita que o processo morra com o MySQL fora"
```

### Task 17: Sessão com MFA não envenena o `localStorage`

**Files:**
- Modify: `assets/api.js:88-92`, `115-120`, `17-20`
- Modify: `admin.html:438-441`, `atendente.html:311-313`
- Create: `server/test/` — não se aplica (é front). **Teste:** manual + o `doctor.js` ganha um check que faz `node -e` para simular `getStoredUser` com o valor `"undefined"`? Não. **Verificação:** passo manual do Step 4.

**Interfaces:**
- Produces: `window.authLogin(email, password)` resolve `{ mfa_required: true, mfa_token }` **sem** gravar sessão. `getStoredUser()` envolve `JSON.parse` em `try/catch` e, ao falhar, chama `clearSession()` e devolve `null` — nunca lança.

- [ ] **Step 1: Corrigir `authLogin`**

Em `assets/api.js`:

```js
window.authLogin = async function (email, password) {
  var data = await request('POST', '/auth/login', { email: email, password: password });
  // Login com MFA não devolve token: gravar "undefined" no localStorage
  // quebrava getStoredUser() (JSON.parse) e travava admin/atendente em skeleton.
  if (!data || !data.token) return data;
  setSession(data.token, data.user, data.refreshToken);
  return data;
};
```

- [ ] **Step 2: Tornar `getStoredUser` defensivo**

```js
function getStoredUser() {
  var raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    var parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_e) {
    // Conteúdo corrompido (incluindo a string "undefined" de um bug anterior):
    // descarta a sessão em vez de deixar a página inteira quebrar.
    clearSession();
    return null;
  }
}
```

- [ ] **Step 3: Envolver os guards de página em try/catch**

Em `admin.html:438-441` e `atendente.html:311-313`, que hoje fazem `SESSION = await requireAuth()` sem tratamento, envolver em `try/catch` e, no `catch`, `location.replace('auth.html')`. Sem isso, qualquer rejeição deixa a página em skeleton para sempre.

- [ ] **Step 4: Verificar no browser**

Run: `npm run dev`; criar um usuário; ativar MFA; **recarregar a página no meio do prompt de MFA** (F12 → Application → recarregar). Depois: navegar para `admin.html` **e** `atendente.html` **sem** estar logado.
Expected: as duas redirecionam para `auth.html` em vez de ficarem em skeleton. Conferir `localStorage.saude_token` depois do prompt de MFA: deve estar **ausente**, não a string `"undefined"`.

- [ ] **Step 5: Limpar a sessão envenenada dos desenvolvedores**

Adicionar ao `doctor.js` um check que avisa (não falha) se `localStorage` não for acessível — impossível verificar de fora do browser. **Em vez disso**, documentar no README que quem já caiu no bug precisa de `localStorage.clear()` no console, ou usar o `clearSession` que agora roda sozinho no `getStoredUser`.

- [ ] **Step 6: Commit**

```bash
git add assets/api.js admin.html atendente.html
git commit -m "fix(auth): login com MFA nao grava sessao invalida e getStoredUser se recupera"
```

### Task 18: `/auth/*` volta a ter refresh, e a sessão não é derrubada sem necessidade

**Files:**
- Modify: `assets/api.js:70`

**Interfaces:**
- Produces: a condição de retry passa a ser `!AUTH_NO_RETRY.some(function (p) { return path.indexOf(p) === 0; })` com `AUTH_NO_RETRY = ['/auth/login', '/auth/signup', '/auth/refresh', '/auth/logout', '/auth/mfa/']`. `/auth/me` e `/auth/me/export` **passam** a renovar.

- [ ] **Step 1: Trocar o predicado**

Em `api.js`, declarar a lista acima do `request` e trocar `path.indexOf('/auth/') !== 0` pela checagem contra `AUTH_NO_RETRY`. Atualizar o comentário da linha 68 para explicar **por quê** (o `/auth/` inteiro era excluído e `/auth/me` ficava sem renovação → logout silencioso).

- [ ] **Step 2: Verificar no browser**

Run: `npm run dev`; login como paciente; DevTools → Application → em `saude_token`, colocar um token expirado (`'x'` serve) **mantendo** `saude_refresh` válido; abrir "Minha conta".
Expected: a tela abre (o `GET /auth/me` recebe 401 → `tryRefresh()` renova → repete → 200). Antes da correção, isso deslogava.

- [ ] **Step 3: Commit**

```bash
git add assets/api.js
git commit -m "fix(auth): /auth/me volta a renovar o token em vez de derrubar a sessao"
```

### Task 19: `privacy.html` carrega `assets/api.js` (DPO da LGPD)

**Files:**
- Modify: `privacy.html:1-15` e `:99-110`

- [ ] **Step 1: Carregar o script**

Adicionar `<script defer src="assets/api.js"></script>` no `<head>`, **antes** do `<script>` inline de `privacy.html`. Como `api.js` é `defer` e o script inline está no fim do `<body>`, a ordem de execução está correta.

- [ ] **Step 2: Usar `window.API_BASE` com o mesmo fallback**

Manter `var API = (window.API_BASE || 'http://localhost:4000');` — agora `window.API_BASE` existe e o override documentado em `api.js` passa a funcionar.

- [ ] **Step 3: Verificar**

Run: `npm run dev`; com `DPO_NAME`/`DPO_EMAIL` preenchidos no `.env` (o `.env` local está vazio — **preencher temporariamente** para o teste e reverter), abrir `privacy.html` e conferir que `#dpoContact` mostra o e-mail em vez de "indisponível no momento".
Expected: nome + e-mail do encarregado visíveis.

- [ ] **Step 4: Documentar a dependência**

Adicionar ao `doctor.js` um check `dpo`: se `DPO_NAME` **e** `DPO_EMAIL` estiverem vazios, imprimir `[AVISO] dpo — DPO_NAME/DPO_EMAIL vazios: a política de privacidade mostrará "indisponível"` (aviso, **não** falha — é opcional em ambiente de teste).

- [ ] **Step 5: Commit**

```bash
git add privacy.html scripts/doctor.js
git commit -m "fix(privacidade): privacy.html carrega api.js e o contato do DPO funciona"
```

### Task 20: `.grid-3` e `.opt` entram no design system

**Files:**
- Modify: `assets/styles.css` (junto de `.grid-2`/`grid-4`/`grid-5`, ~linhas 191-193 e 311)
- Modify: `auth.html:29` (remover a regra inline duplicada)

**Interfaces:**
- Produces: `.grid-3` (3 colunas, colapsa junto com as outras abaixo de 760px) e `.opt` (rótulo "(opcional)") disponíveis em todas as páginas.

- [ ] **Step 1: Adicionar `.grid-3`**

Junto da regra existente `.grid-2, .grid-4, .grid-5 { ... }` (linha 192), incluir `.grid-3` no seletor. Adicionar `.grid-3{ grid-template-columns:repeat(3, minmax(0,1fr)); }` na linha 191, ao lado de `.grid-2`.

- [ ] **Step 2: Mover `.opt` para o `styles.css`**

Copiar a definição de `auth.html:29` (`.opt{ font-size:.75rem; color:var(--muted); font-weight:400; margin-left:4px; }`) para `styles.css`, junto de `.field label`. **Remover** a linha do `<style>` inline do `auth.html` para não duplicar.

- [ ] **Step 3: Verificar no browser**

Run: `npm run dev`; login como admin; aba Rede → "Vincular profissional a unidade e serviço".
Expected: o formulário de 5 campos aparece em **3 colunas**, não em 1 coluna empilhada. E em `dashboard.html`, `admin.html`, `atendente.html`, os campos "(opcional)" aparecem menores e mais claros que os obrigatórios.

- [ ] **Step 4: Commit**

```bash
git add assets/styles.css auth.html
git commit -m "fix(css): adiciona .grid-3 e .opt ao design system compartilhado"
```

### Task 21: "Hoje" em horário local, não UTC

**Files:**
- Modify: `admin.html:963-972`
- Modify: `atendente.html:517-519`

**Interfaces:**
- Consumes: os dois arquivos **já** têm um helper de data local (`admin.html:1064`, `atendente.html:264`). Reusá-lo, sem criar um terceiro.

- [ ] **Step 1: Trocar a construção da data**

Em `admin.html:969`, substituir `const today = new Date().toISOString().slice(0, 10);` pelo helper local já existente. Conferir o nome exato antes de editar (grep por `function` que retorna `YYYY-MM-DD` com `getFullYear`). Em `atendente.html:517`, idem.

- [ ] **Step 2: Verificar**

Run: `npm run dev`; entre 21:00 e 23:59 (UTC-3), login como admin e como atendente.
Expected: "Agenda de hoje" e "Fila do dia" mostram **hoje**, não amanhã. Se não for possível testar nesse horário, verificar a lógica em Node: `new Date().toISOString().slice(0,10)` vs o helper, com `TZ=America/Sao_Paulo` forçado e um `Date` às 22h.

- [ ] **Step 3: Commit**

```bash
git add admin.html atendente.html
git commit -m "fix(front): agenda e fila do dia usam data local em vez de UTC"
```

### Task 22: `initProfile` não duplica listeners (dashboard)

**Files:**
- Modify: `dashboard.html:883`, `:1428-1461`, `:1497`

**Interfaces:**
- Produces: um flag `profileListenersBound` no escopo do IIFE do `dashboard.html`, no mesmo padrão do `acctLoaded`/`atAccountLoaded` que já existe no admin e no atendente.

- [ ] **Step 1: Adicionar a guarda**

Declarar `var profileListenersBound = false;` junto dos outros flags. No início de `initProfile`, se `profileListenersBound` for verdadeiro, **pular apenas o bloco de listeners** (continuar recarregando os dados do formulário, que é o que a chamada pós-save quer). Envolver o bloco de `addEventListener` em `if (!profileListenersBound) { ...; profileListenersBound = true; }`.

- [ ] **Step 2: Mover o listener do `submit` para fora do `try`**

`dashboard.html:1458` (`document.getElementById('profileForm').addEventListener('submit', saveProfile);`) é a última instrução dentro do `try`. Um 401/500 no `GET /auth/me` inicial cai no `catch` e a página fica **sem** handler de submit → o browser faz um GET nativo e perde o formulário. Mover o registro para **antes** do `try`, logo depois de obter a referência do elemento.

- [ ] **Step 3: Verificar no browser**

Run: `npm run dev`; login como paciente; aba Minha conta; salvar 3 vezes; conta as requisições no DevTools (Network, filtrar `auth/me`).
Expected: **1** `PUT /auth/me` por clique (não 2, 3 ou 4) e 1 toast "Perfil salvo".

- [ ] **Step 4: Commit**

```bash
git add dashboard.html
git commit -m "fix(front): initProfile para de duplicar listeners e o submit sobrevive a falha do GET"
```

---

# Fase 3 — Cobertura de teste

### Task 23: Suíte `node:test`

**Files:**
- Create: `server/test/helpers.test.js`, `server/test/audit.test.js`, `server/test/booking.test.js`
- Modify: `server/package.json` (adicionar `"test": "node --test test/"`)

**Interfaces:**
- Consumes: `server/src/utils/validators.js`, `server/src/utils/audit.js`, `server/src/utils/booking.js`, `server/src/utils/totp.js`.
- Produces: `npm test` roda tudo. Os testes que tocam o banco usam o `.env` de desenvolvimento e **limpam** o que criam (sufixo de e-mail `+teste@` e `finally` com `DELETE`/`DROP`).

- [ ] **Step 1: Adicionar o script `test`**

Em `server/package.json`: `"test": "node --test test/"`. Manter `smoke-test` como está (ele é valuable e é referenciado no README).

- [ ] **Step 2: `helpers.test.js` — funções puras**

Cobrir `isValidCPF` (válido, repetido, curto), `isValidCNS` (válido, curto, prefixo inválido), `parsePagination` (com e sem query), `sanitizeDetails` (mascara CPF, redige Bearer, corta em 1000), `chainHash` (determinístico, muda com qualquer campo), `verifyTotp` (código correto, código errado, janela), `privacy.js` helpers. These are all pure — **no banco**.

- [ ] **Step 3: `audit.test.js` — cadeia**

`test('cadeia unbroken quando nenhuma linha é alterada')`: inserir 5 linhas com `logAction`, rodar `verifyChain(pool)`, esperar `{ ok: true, checked: 5 }`.
`test('cadeia quebra quando uma linha é alterada')`: mesma coisa, depois `UPDATE audit_log SET details='x' WHERE seq=3` (desabilitando o trigger append-only **apenas no teste**, com `DROP TRIGGER`/`CREATE TRIGGER` de volta), esperar `ok: false` com `reason: 'conteúdo alterado'`.
`test('cadeia detecta remoção')`: `DELETE` e esperar `reason: 'elo anterior divergente'`.

- [ ] **Step 4: `booking.test.js` — lógica pura + pool injetado**

As funções de `booking.js` recebem `pool` como parâmetro, então dá para passar um **fake** com `query: async () => [[]]` e testar os retornos de erro sem banco: `validateBooking` com horário passado → `'Não é permitido agendar em data passada.'`; com slot_minutes inválido; com profissional sem oferta → a mensagem de "não atende este serviço nesta unidade".
`test('resolveTipo rejeita tipo desconhecido')`, `test('minutesOf e toDateStr')`, `test('nextDayWindow cai no dia seguinte')`.

- [ ] **Step 5: Rodar**

Run: `npm --prefix server test`
Expected: todos passam, 0 falhas, em < 10s.

- [ ] **Step 6: Commit**

```bash
git add server/package.json server/test/
git commit -m "test: suíte node:test para helpers, audit e booking"
```

### Task 24: `api.test.js` — RBAC, CORS e contratos HTTP

**Files:**
- Create: `server/test/api.test.js`
- Modify: `server/scripts/smoke-test.js` (só se houver sobreposição a eliminar)

**Interfaces:**
- Produces: sobe `app` em porta efêmera e exercita: `/health` e `/ready` (200), origem não permitida (403), rota inexistente (404 JSON), 401 sem token nas rotas protegidas, a matriz RBAC de 14 asserts que hoje vive no `smoke-test.js`, e os **contratos de resposta** que o front consome (`/catalog/services` → array, `/catalog/slots` → `{ unidades, totalVagas }`, `/admin/users` → `{ data, total }`, `/auth/me` → `{ user }`).

**Why importa:** o front depende dessas formas. Um `null` onde esperava array é exatamente a classe de bug que a auditoria achou em `dashboard.html:964`.

- [ ] **Step 1: Portar e estender o smoke-test**

Criar `api.test.js` com `node:test`. Reusar o helper de token que já existe em `smoke-test.js` (`jwt.sign` com `JWT_SECRET`). Cada caso vira um `test()`.

- [ ] **Step 2: Adicionar os testes de contrato**

```js
test('GET /catalog/services devolve array', async () => { /* assert Array.isArray */ });
test('GET /admin/users devolve { data, total }', async () => { /* assert Number.isInteger(total) */ });
test('GET /auth/me devolve { user }', async () => { /* token de paciente */ });
test('GET /auth/me sem token devolve 401 com mensagem pt-BR', async () => { /* assert.match(error, /[A-Za-z]/) e sem 'Invalid input' */ });
```

- [ ] **Step 3: Rodar e ajustar `smoke-test.js`**

Se a matriz RBAC ficou duplicada, deixar `smoke-test.js` como o comando curto (`npm run smoke-test`, usado no README) e `api.test.js` como a suíte completa. `npm run smoke-test` continua verde.

- [ ] **Step 4: Commit**

```bash
git add server/test/api.test.js server/scripts/smoke-test.js
git commit -m "test: suite de contratos HTTP e RBAC com node:test"
```

### Task 25: `npm test` na raiz

**Files:**
- Modify: `package.json` (raiz)

- [ ] **Step 1: Encadear o teste da raiz com o do server**

O script `test` da raiz já é `npm --prefix server test`. Acrescentar o teste do front (Task 1) que vive em `server/test/web-server.test.js` — ele já é coberto por `npm --prefix server test` porque está em `server/test/`. Confirmar que sim e **não duplicar**.

- [ ] **Step 2: Verificar**

Run: `npm test` na raiz.
Expected: mesma saída que `npm --prefix server test`.

- [ ] **Step 3: Commit**

```bash
git commit --allow-empty -m "test: npm test na raiz delega para server/test"
```

---

# Fase 4 — Documentação

### Task 26: README, DESIGN.md e ROTEIRO

**Files:**
- Modify: `README.md:210-320` (setup, scripts, troubleshooting) e `README.md:400-409` (problemas comuns)
- Modify: `DESIGN.md:71` (contraste) e `DESIGN.md:79` (grids)
- Modify: `ROTEIRO_TESTE_ALUNOS.md:1-60`

**Interfaces:**
- Produces: um documento de setup de **comandos** (`npm run setup` → `npm run doctor` → `npm run dev`), sem `npx serve` e sem a sequência manual de migrations.

- [ ] **Step 1: Reescrever a seção de setup do README**

Substituir "Setup completo" por:

```bash
git clone <repo> && cd SaudePlus
npm run setup     # instala as deps, cria o banco, aplica migrations e cria o admin
npm run doctor    # confere Node, .env, MySQL, migrations e portas
npm run dev       # sobe API (:4000) e front (:8080)
```

Manter a seção manual equivalente (schema.sql + `npm run db:migrate` + `npm run db:seed`) para quem não puder usar `npm run setup`. Atualizar a tabela de scripts com os scripts da raiz. Atualizar a linha do CORS para dizer que `npm run dev` já deixa `CORS_ORIGIN` consistente (o `serve-web.js` fixa 8080).

- [ ] **Step 2: Corrigir a ordem das migrations**

Adicionar `migrate:interop` à sequência e a nota de ordem, com o alerta explícito: *"Pular `migrate:interop` não gera erro visível — apenas desliga o MFA silenciosamente."*

- [ ] **Step 3: Atualizar "Problemas comuns"**

Adicionar: `GET /server/.env` → 404 (o servidor estático só serve allowlist, isso é o comportamento correto); "Failed to fetch" → `npm run doctor`; login que não pede segundo fator → rodar `npm run db:migrate`; "Muitos intentos de login" → o lockout é por conta, esperar 15 min ou trocar `TRUST_PROXY_HOPS`.

- [ ] **Step 4: Corrigir o DESIGN.md**

`:71` — o texto diz que 3 pares reprovados precisam de correção "na Fase 1". Verificar os pares no `styles.css` atual: `white on --primary` = 5.2:1 (passa), `white on --primary-600` = 7.9:1 (passa), `--warning-ink on --warning-bg` já é o token correto. **Reescrever esse trecho para registrar que a Fase 1 foi concluída**, e manter a proibição ("Don't") como regra permanente.

`:79` — corrigir "Grids: `.grid-2/4/5`" para `.grid-2/3/4/5`. Documentar `.opt` na seção de Components.

- [ ] **Step 5: Atualizar o ROTEIRO_TESTE_ALUNOS.md**

Trocar a checklist de instalação (`npm install` + `npx serve .`) por `npm run setup` + `npm run doctor` + `npm run dev`. Ajustar a tabela de troubleshooting. Adicionar um passo de verificação dos **5 Review Focus**:
1. criar usuário com nome `Maria d'Ávila Souza` e clicar "Abrir histórico" no admin;
2. atendente altera só o telefone → cargo continua;
3. admin salva o perfil → tipo sanguíneo/prioridade continuam;
4. login com MFA → recarregar no meio do prompt → as páginas redirecionam em vez de travar;
5. `admin_level` vazio num admin → 403, não acesso total.

- [ ] **Step 6: Verificar a documentação contra o código**

Run: seguir o README do zero numa cópia limpa do repositório (`git clone` para `C:\Users\LUANDE~1.OLI\AppData\Local\Temp\opencode\sp-check`), rodando cada comando citado.
Expected: `npm run setup` → `npm run doctor` → `npm run dev` funciona do zero, sem nenhum passo manual fora do que está documentado.

- [ ] **Step 7: Commit**

```bash
git add README.md DESIGN.md ROTEIRO_TESTE_ALUNOS.md
git commit -m "docs: setup por comandos, ordem real de migrations e roteiro de verificacao"
```

---

# Apêndice — Achados registrados e NÃO corrigidos nesta rodada

Documentar no final do README (seção "Dívida técnica conhecida") ou num `docs/TECNICAL_DEBT.md`, com link, para que ninguém redescubra:

| Sev | Onde | Achado |
|---|---|---|
| MEDIUM | `app.js:74` vs `admin.routes.js:124` | `GET /admin/users` é código morto (o mount de `admin.users.routes.js` sombreia). Resolver movendo `router.get('/users')` para `admin.users.routes.js` ou removendo. |
| MEDIUM | `booking.js:72`, `:110` | Duração de 30min hardcoded no cálculo de conflito, enquanto `work_schedules.slot_minutes` é 5–240. Agendamento de 60min não bloqueia 09:30. |
| MEDIUM | `booking.js:431-438` | `findAvailabilityByService` reporta só 1 profissional por horário; `totalVagas` subconta. |
| MEDIUM | `admin.routes.js:31-33` | `SUM()` sobre tabela vazia devolve `null`; `/admin/stats` retorna `pending: null`. Usar `COALESCE(SUM(...), 0)`. |
| MEDIUM | `privacy.js:18-45` | Anonimização LGPD não é transacional: 4 statements independentes. |
| MEDIUM | `auth.routes.js:461-462` | Fallback de CPF do Gov.br faz `SELECT * FROM users` e compara com `===` (não timing-safe). |
| MEDIUM | `admin.professionals.routes.js:149`, `units.routes.js:114` | `INSERT IGNORE` devolve `201` com um id que não foi persistido. |
| MEDIUM | `admin.professionals.routes.js:19-25` | `TIME_RE` aceita `99:99`. |
| MEDIUM | `auth.routes.js:304` / `totp.js:41` | TOTP sem proteção de replay e `/mfa/verify` sem contador de tentativas. |
| MEDIUM | `admin.users.routes.js:18` | `const SELF_RANK = 4` declarado e nunca usado. |
| MEDIUM | `admin.routes.js:263` | `audit_log` lido com `INNER JOIN users`, que oculta linhas órfãs — e `verifyChain` não usa join, então os dois discordam. |
| MEDIUM | CSS | Modais declaram `aria-modal="true"` sem focus trap, focus restore nem `tabindex="-1"`. |
| MEDIUM | `admin.html:969` / `atendente.html:517` | `esc()` não cobre `onclick` com aspas duplas em vários pontos (XSS residual). |
| MEDIUM | CSS | Tabelas de histórico sem wrapper de scroll horizontal (overflow da página em ≤400px). |
| MEDIUM | `auth.html`, `dashboard.html` | Inputs sem atributo `name`: autofill e gerenciadores de senha desabilitados. |
| MEDIUM | `auth.routes.js:139` | Erro de validação do Zod vaza em inglês ("Invalid input: expected string"). |
| LOW | 19 itens | `grid` com colunas vazias; CSS morto (`.footer-grid h4`, `.trust-item h4`, `--accent`); `atendente.html` com listeners duplicados; `setDateLimits` inconsistente entre 3 arquivos; `auth.html` sem guarda de sessão ativa; `api.js` sem `credentials: 'include'`; `privacy.html` sem nome de campo; `atendente.html` com label de input disabled; `dashboard.html:964` com `A.length` sem guarda; `dashboard.html:1274` com `openBookingForm` sem catch; `myAccountExtrasLoaded` sem retry; `express.urlencoded` ausente (Task 12 adiciona); `SELF_RANK`/`start` mortos. |