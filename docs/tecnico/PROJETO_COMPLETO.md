# Saúde+ — documentação completa do projeto

> Documento técnico consolidado e revisado em 26/10/2026 a partir do código atual. Descreve o que está implementado e separa o que depende de configuração externa ou continua como próximo passo.

## 1. Resumo executivo

O Saúde+ é uma aplicação web para apoiar o atendimento da rede de saúde de Lagoa de Itaenga. A solução tem três camadas:

- **Frontend:** páginas HTML, CSS e JavaScript vanilla, sem build.
- **Backend:** API REST em Node.js + Express.
- **Persistência:** MySQL 8 via `mysql2/promise`.

Fluxos implementados: cadastro e login (com MFA opcional), recuperação de senha, perfil, agendamento de consultas e exames com agenda real, lembretes no painel e por e-mail, alertas de doenças, catálogo de unidades/profissionais/serviços, área do atendente e painel administrativo com níveis de permissão.

Papéis: `paciente`, `atendente` e `admin`. O admin possui `admin_level` (`superadmin`, `gestor`, `atendimento`, `alertas`) com capabilities distintas.

## 2. Arquitetura e inicialização

```text
Navegador
  HTML + assets/api.js + assets/ui.js
          |
          | fetch + Authorization: Bearer <access token>
          | cookie httpOnly <refresh token>
          v
API Express (server/src/app.js)
          | pool.query parametrizado
          v
MySQL (banco saude)
```

1. `server/src/server.js` sobe o processo e agenda o job de lembretes.
2. `server/src/app.js` carrega `.env`, aplica Helmet, CORS fechado, cookie parser, limites de corpo e rate limit; registra as rotas, 404 e erro 500.
3. `server/src/db.js` cria o pool MySQL (`utf8mb4`, até 10 conexões, `dateStrings: true`).
4. O navegador guarda o access token em `localStorage` e o refresh token em cookie `httpOnly`.

## 3. Papéis, permissões e sessão

| Papel | Cadastro | Acesso principal | Restrições |
| --- | --- | --- | --- |
| `paciente` | Aberto | Próprios agendamentos, exames, lembretes, alertas, catálogo e conta | Não acessa dados de terceiros nem rotas administrativas |
| `atendente` | Aberto, inicia `pendente` | Consultas/exames, busca de pacientes e histórico | Precisa ser ativado; sem vínculo profissional a agenda é fail-closed (vazia) |
| `admin` | Criado/promovido por seed ou admin autorizado | Usuários, atendimentos, cadastros, auditoria e relatórios | Ações dependem de `admin_level`/capability |

### Capabilities por nível administrativo

| Nível | Capabilities |
| --- | --- |
| `superadmin` | `users`, `appointments`, `diseases`, `units`, `audit`, `reports`, `admins` |
| `gestor` | `users`, `appointments`, `diseases`, `units`, `audit`, `reports` |
| `atendimento` | `appointments` |
| `alertas` | `diseases` |

`requireCapability` é fail-closed: nível ausente ou desconhecido é negado. A capability `admins` é exclusiva do `superadmin`.

### Sessão

- Access token JWT curto, padrão **15 minutos** (`JWT_EXPIRES_IN`), enviado como Bearer.
- Refresh token rotativo de **30 dias** (`JWT_REFRESH_EXPIRES_IN`), em cookie `httpOnly` e também aceito no corpo para clientes sem cookie.
- O banco guarda apenas o SHA-256 do refresh token. Reuso de token revoga a família inteira.
- Logout, troca de senha e ações administrativas de revogação invalidam refresh tokens ativos.
- Login pode exigir TOTP (MFA). O replay de TOTP é bloqueado por atualização condicional do último passo usado.

## 4. Banco de dados

`server/schema.sql` cria o banco `saude` com `utf8mb4` e **14 tabelas**:

`users`, `appointments`, `exams`, `reminders`, `diseases`, `health_units`, `professionals`, `unit_offers`, `professional_offers`, `work_schedules`, `schedule_blocks`, `audit_log`, `refresh_tokens`, `password_reset_tokens`.

### Tabelas principais

- **`users`**: identidade, contato, documentos, perfil, endereço, `role`, `account_status`, `admin_level`, `job_role`, consentimento LGPD e dados de MFA.
- **`appointments`** e **`exams`**: agendamentos do paciente, com profissional/unidade, serviço, horário, status e observações.
- **`reminders`**: lembretes do paciente, com `read`, `sent_at` e `send_error`.
- **`diseases`**: alertas epidemiológicos por região, nível e status ativo.
- **`health_units`**: unidades de saúde e bairros.
- **`professionals`**: profissionais, vínculo opcional com `users.user_id` e status ativo.
- **`unit_offers`** e **`professional_offers`**: serviços ofertados por unidade e por profissional.
- **`work_schedules`** e **`schedule_blocks`**: janelas de atendimento e bloqueios de agenda.
- **`audit_log`**: trilha administrativa encadeada por hash (`prev_hash`/`entry_hash`), com ator, ação, entidade, detalhes e data.
- **`refresh_tokens`**: hash, família, expiração e revogação.
- **`password_reset_tokens`**: hash do token de recuperação, expiração e uso.

### Regras de agendamento

- Novo agendamento nasce `pendente`.
- O paciente pode editar/cancelar registros pendentes ou confirmados.
- Registros cancelados/concluídos não são editáveis.
- Cancelamento é lógico: muda o status e preserva o histórico.
- A disponibilidade considera oferta, profissional, unidade, horários, bloqueios e conflitos.

## 5. API REST

Todas as queries usam placeholders `?`. Rotas protegidas exigem `Authorization: Bearer <token>`.

### Saúde, autenticação e conta

| Método | Rota | Função |
| --- | --- | --- |
| GET | `/health` | Disponibilidade básica da API |
| GET | `/ready` | Disponibilidade + conexão com o banco + estado do lock de auditoria |
| POST | `/auth/signup` | Cria paciente ou atendente (atendente nasce `pendente`) |
| POST | `/auth/login` | Valida credenciais; pode exigir segundo fator |
| POST | `/auth/mfa/verify` | Conclui login com TOTP |
| POST | `/auth/mfa/setup` | Inicia configuração de MFA |
| POST | `/auth/mfa/enable` | Confirma e ativa MFA |
| POST | `/auth/mfa/disable` | Desativa MFA com validação |
| POST | `/auth/password/forgot` | Solicita link de recuperação |
| POST | `/auth/password/reset` | Redefine senha com token válido |
| POST | `/auth/refresh` | Rotaciona access/refresh token |
| POST | `/auth/logout` | Revoga a sessão |
| GET/PUT | `/auth/me` | Lê/atualiza o próprio perfil |
| GET | `/auth/me/export` | Exporta os dados do titular |
| DELETE | `/auth/me` | Exclui/anonymiza a conta conforme LGPD |
| GET | `/auth/govbr/login` | Inicia login Gov.br (quando configurado) |
| GET | `/auth/govbr/callback` | Retorno do login Gov.br |

### Área do paciente

| Método | Rota | Função |
| --- | --- | --- |
| GET/POST | `/me/appointments` | Lista/cria consultas do próprio usuário |
| PUT | `/me/appointments/:id` | Edita consulta própria |
| PATCH | `/me/appointments/:id/cancel` | Cancela consulta própria |
| GET/POST | `/me/exams` | Lista/cria exames do próprio usuário |
| PUT | `/me/exams/:id` | Edita exame próprio |
| PATCH | `/me/exams/:id/cancel` | Cancela exame próprio |
| GET | `/me/reminders` | Lista lembretes próprios |

### Catálogo e dados gerais

| Método | Rota | Função |
| --- | --- | --- |
| GET | `/catalog/offers` | Serviços de uma unidade por tipo |
| GET | `/catalog/professionals` | Profissionais habilitados para o serviço |
| GET | `/catalog/availability` | Dias e horários livres |
| GET | `/catalog/services` | Serviços disponíveis na rede |
| GET | `/catalog/slots` | Cartões de vagas por unidade/dia |
| GET | `/health-units` | Unidades ativas |
| GET | `/diseases` | Alertas (filtro opcional `?active=true`) |
| GET | `/public/stats` | Contagens agregadas sem PII |
| GET | `/public/dpo` | Contato público do Encarregado LGPD |

### Atendente

Todas exigem `verifyToken` + `requireStaff`.

| Método | Rota | Função |
| --- | --- | --- |
| GET | `/staff/appointments` | Agenda de consultas (fail-closed por vínculo) |
| GET | `/staff/exams` | Agenda de exames (fail-closed por vínculo) |
| GET | `/staff/patients?q=...` | Busca pacientes ativos |
| GET | `/staff/patients/:id/history` | Histórico do paciente |
| PATCH | `/staff/:kind/:id` | Atualiza status/data de consulta ou exame |

### Administração

Rotas sob `/admin` exigem `requireAdmin` e a capability indicada.

| Método | Rota | Capability | Função |
| --- | --- | --- | --- |
| GET | `/admin/stats` | `users` | Indicadores do painel |
| GET | `/admin/export/summary.csv` | `reports` | Exportação agregada sem PII |
| GET | `/admin/appointments` | `appointments` | Consultas de todos |
| GET | `/admin/exams` | `appointments` | Exames de todos |
| PATCH | `/admin/:kind/:id` | `appointments` | Confirma/cancela/reagenda |
| GET | `/admin/history?userId=...` | `users` | Perfil e histórico |
| GET/POST | `/admin/diseases` | `diseases` | Lista/cria alertas |
| PATCH/DELETE | `/admin/diseases/:id` | `diseases` | Edita/remove alertas |
| GET | `/admin/audit-log` | `audit` | Consulta a trilha |
| GET | `/admin/audit-log/verify` | `audit` | Verifica a cadeia de hashes |

### Usuários, unidades e profissionais (admin)

| Método | Rota | Função |
| --- | --- | --- |
| GET | `/admin/users` | Lista/busca usuários sem CPF/RG, com filtros por papel/e-mail |
| GET | `/admin/users/:id` | Perfil completo para admin |
| POST | `/admin/users` | Cria conta administrativa |
| PATCH | `/admin/users/:id` | Altera status, cargo, nível e vínculo profissional |
| DELETE | `/admin/users/:id` | Soft delete + revogação de acesso |
| GET | `/health-units/manage` | Catálogo completo de unidades |
| POST/PATCH | `/health-units` | Cria/edita unidade |
| GET/POST | `/health-units/:id/offers` | Lista/adiciona serviços da unidade |
| DELETE | `/health-units/:id/offers/:offerId` | Remove serviço da unidade |
| GET/POST | `/admin/professionals` | Lista/cria profissionais |
| PATCH | `/admin/professionals/:id` | Edita profissional |
| POST/DELETE | `/admin/professionals/:id/offers` | Gerencia vínculos de serviço |
| POST/DELETE | `/admin/professionals/:id/schedules` | Gerencia horários |
| POST/DELETE | `/admin/professionals/:id/blocks` | Gerencia bloqueios |

### Interoperabilidade

| Método | Rota | Função |
| --- | --- | --- |
| GET | `/interop/status` | Estado das integrações |
| POST | `/interop/rnds/send` | Envio RNDS (capability `reports`, exige credenciamento) |

## 6. Frontend

### `index.html` — landing page

Apresentação pública, recursos, contadores agregados, links para login/cadastro e política de privacidade. Redireciona sessão existente para o painel do papel.

### `auth.html` — login e cadastro

- Login com e-mail/senha e fluxo de MFA quando ativo.
- Recuperação de senha.
- Cadastro em **2 passos**: **Você** (tipo de conta e dados pessoais) e **Acesso** (credenciais). O restante do perfil fica em "Minha conta".
- Máscaras de CPF, telefone e CEP; autopreenchimento ViaCEP com correção manual.
- Atendente é criado como `pendente`.

### `dashboard.html` — paciente

Abas: **Início**, **Agendar**, **Meus agendamentos**, **Alertas**, **Minha conta**.

- Início: cards e próximos eventos.
- Agendar: fluxo guiado por unidade → serviço → profissional → horário, para consulta ou exame.
- Meus agendamentos: lista, edição e cancelamento.
- Alertas: doenças ativas.
- Minha conta: perfil, MFA, exportação e exclusão de conta.

### `atendente.html` — atendimento

Abas: **Fila do dia**, **Agendamentos**, **Buscar paciente**, **Minha conta**. Permite confirmar, cancelar, reagendar e consultar histórico, respeitando o vínculo profissional.

### `admin.html` — administração

Abas: **Início**, **Atendimentos**, **Cadastros**, **Auditoria**, **Minha conta**.

- Cadastros: sub-abas **Pessoas**, **Rede** e **Doenças**.
- Atendimentos: filtros, confirmação, cancelamento e reagendamento.
- Auditoria: consulta e verificação da cadeia.
- Minha conta: perfil, MFA e sessão.
- Gating por `admin_level` esconde abas/operações sem capability.

### `privacy.html` — privacidade

Política em linguagem simples, com contato do DPO (via `/public/dpo`) e aviso de revisão jurídica pendente.

## 7. Assets compartilhados

### `assets/api.js`

Cliente HTTP global: `apiGet`, `apiPost`, `apiPut`, `apiPatch`, `apiDelete`, login/signup, refresh, logout, sessão, `requireAuth`, `requireRole`, helpers de papel, datas e toast. Access token em `saude_token`; usuário resumido em `saude_user`.

### `assets/ui.js`

Primitivas de UI: modais, `confirmDialog`, `loadingButton`, skeleton, estados vazios/erro, navegação por teclado em abas e utilitários visuais.

### `assets/styles.css`

Design system com variáveis de cor/tipografia, componentes, responsividade, foco visível e `prefers-reduced-motion`. Fonte **Inter autohospedada** em `assets/fonts/inter-latin.woff2`.

## 8. Backend por arquivo

- **`app.js`**: middlewares globais, CORS, rate limit, rotas, 404 e erro.
- **`server.js`**: entrada do processo e job de lembretes.
- **`db.js`**: pool MySQL.
- **`middleware/auth.js`**: `verifyToken`, `requireAdmin`, `requireStaff`.
- **`middleware/capabilities.js`**: mapa nível → capabilities, fail-closed.
- **`middleware/rateLimit.js`**: limites global, de autenticação e de readiness.
- **`middleware/audit.js`** e **`utils/audit.js`**: trilha encadeada e tolerante a falha.
- **`middleware/crypto.js`** e **`utils/crypto.js`**: criptografia de documentos sensíveis.
- **`routes/auth.routes.js`**: cadastro, login, MFA, refresh, reset, Gov.br e conta.
- **`routes/me.booking.routes.js`**: implementação única de agendamentos do paciente.
- **`routes/appointments.routes.js`** e **`exams.routes.js`**: fábricas para consulta/exame.
- **`routes/reminders.routes.js`** e **`jobs/reminders.js`**: leitura e geração/envio de lembretes.
- **`routes/catalog.routes.js`**: agenda inteligente.
- **`routes/staff.routes.js`**: área do atendente.
- **`routes/admin.routes.js`**: painel, atendimentos, alertas, auditoria e exportação.
- **`routes/admin.users.routes.js`**: CRUD administrativo de usuários.
- **`routes/admin.professionals.routes.js`**: profissionais, serviços, horários e bloqueios.
- **`routes/units.routes.js`**: unidades e ofertas.
- **`routes/public.routes.js`** e **`routes/interop.routes.js`**: vitrine e integrações.
- **`utils/booking.js`**: disponibilidade, conflitos e duração.
- **`utils/privacy.js`**: consentimento e anonimização.
- **`utils/loginThrottle.js`** e **`utils/mfaAttempts.js`**: proteção contra força bruta e replay.
- **`services/`**: `mailer`, `govbr`, `rnds`, `cnes`, `infodengue`.

## 9. Scripts e configuração

### Raiz

`npm run setup`, `dev`, `start`, `db:setup`, `db:migrate`, `db:seed`, `db:clean:keep-admin`, `test`, `test:race`, `test:all`, `test:e2e`, `lint`, `check`, `doctor`, `smoke-test`, `backup`.

### `server/package.json`

`start`, `dev`, `start:local`, `test`, `test:race`, `seed:admin`, `seed:demo`, `migrate:supabase`, `link:professionals-users`, migrações individuais, `migrate:all`, `purge:retention`, `backup`, `sync:cnes`, `sync:alerts`, `test:rnds`, `smoke-test`.

### Ordem de `migrate:all`

`v3` → `professional-user` → `security` → `privacy` → `interop` → `audit` → `audit:details` → `mfa:replay` → `booking:duration` → `reminder:delivery` → `password:reset`.

### Scripts operacionais

- `scripts/db-setup.js`: cria banco/schema e resolve a migração real pelo comando npm.
- `scripts/doctor.js`: verifica ambiente, conexão, schema, migrations, CORS e configuração.
- `scripts/serve-web.js`: servidor estático local.
- `server/scripts/seed-admin.js`: cria/promove admin a partir de `ADMIN_EMAIL`/`ADMIN_PASSWORD`.
- `server/scripts/seed-v3-demo.js`: dados de demonstração.
- `server/scripts/link-professionals-to-users.js`: vincula profissionais a contas com senha aleatória.
- `server/scripts/clean-db-keep-admin.js`: limpeza destrutiva de desenvolvimento, mantendo admin.
- `server/scripts/purge-retention.js`: anonimização por inatividade.
- `server/scripts/backup.js`: backup.
- `server/scripts/build-pdf.js`: gera HTML/PDF do checklist V3.

### Configuração

`server/.env.example` documenta porta, CORS, proxy, banco, JWT, criptografia, DPO, retenção, CNES/InfoDengue, RNDS, Gov.br, SMTP e admin inicial. Segredos reais não devem ser versionados.

## 10. Segurança, LGPD e interoperabilidade

- Helmet, CORS por allowlist (sem `*`), limite de corpo de 100 KB e rate limit.
- Bloqueio progressivo de login por `IP|e-mail`, com Map limitado e varrido.
- MFA TOTP com bloqueio de replay e limite de tentativas.
- Senhas com bcrypt; tokens de refresh/reset guardados apenas como hash.
- CPF/RG/CNS criptografados em coluna; logs e respostas administrativas minimizam PII.
- Auditoria encadeada por hash, com verificação de integridade e gravação tolerante a falha.
- LGPD: consentimento versionado, exportação, exclusão/anonimização, retenção e canal do DPO.
- Integrações opcionais: CNES, InfoDengue, RNDS e Gov.br — todas dependem de configuração/credenciamento.

## 11. Testes, lint e CI

- `npm test`: suíte `node:test` do backend (327 casos na última execução registrada).
- `npm run test:race`: testes de concorrência em `server/test/race/`.
- `npm run test:e2e`: Playwright (`e2e/login.spec.js`, `dashboard.spec.js`, `admin-responsive.spec.js`).
- `npm run lint`: ESLint na raiz.
- `npm run doctor`: diagnóstico de ambiente e schema.
- CI em `.github/workflows/ci.yml`: lint, suíte + E2E com MySQL 8.4/Playwright e `npm audit` para vulnerabilidades críticas.

## 12. Como executar

```powershell
npm run setup
npm run doctor
npm run dev
```

O `setup` instala raiz/backend, cria o banco e aplica as migrações. O `dev` sobe API e front; em desenvolvimento, `start:local` permite rodar sem `DATA_ENCRYPTION_KEY` via `ALLOW_PLAINTEXT_DEV=1`. Em produção, a chave é obrigatória e o caminho `start:api` não liga o modo plaintext.

Front padrão: `http://localhost:8080`. API padrão: `http://localhost:4000`.

## 13. Lacunas e riscos verificados

1. **Produção:** exige HTTPS, SMTP real, chave de criptografia em KMS/Vault e CORS fechado no domínio correto.
2. **RNDS/Gov.br:** implementados, mas dependem de credenciamento e certificados externos.
3. **Paginação:** existe em partes da API; nem todas as listas administrativas têm paginação completa.
4. **Front sem build:** decisão consciente; não há bundler, tipagem ou framework.
5. **Acessibilidade:** há foco visível, ARIA e teclado; auditoria contínua ainda recomendada.
6. **Dark mode:** ausente por decisão de escopo.
7. **Texto jurídico:** `privacy.html` e documentos LGPD ainda requerem revisão jurídica formal antes de produção.
8. **Dados de saúde reais:** exigem backup, retenção, resposta a incidentes e operação monitorada.

## 14. Conclusão

O Saúde+ é um sistema funcional de gestão de consultas e exames com autenticação forte, separação de papéis, agenda real, auditoria encadeada, proteção LGPD e painéis para paciente, atendente e administração. A base está organizada em módulos pequenos e SQL parametrizado. Para produção com dados reais, o foco deve ser operação segura (HTTPS, segredos, SMTP, backup), credenciamento das integrações e revisão jurídica dos textos e processos de privacidade.
