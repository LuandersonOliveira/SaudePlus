  # Saúde+ — Lagoa Conectada

  Plataforma de cuidado integrado para a rede de saúde de **Lagoa de Itaenga (PE)**:
  agendamento de consultas e exames com agenda inteligente, fila de atendimento,
  alertas epidemiológicos por região e lembretes automáticos.

  **Stack:** HTML5 + CSS3 + JS vanilla no front · Node.js + Express na API · MySQL 8 na persistência.
  Sem dependência externa obrigatória em produção — o core funciona 100% offline após instalado.

  > Setup testado de ponta a ponta (banco, API, cadastro, login, isolamento de dados
  > por usuário, redirecionamento por papel e bloqueio de rotas admin).

  ## Índice

- [Saúde+ — Lagoa Conectada](#saúde--lagoa-conectada)
  - [Índice](#índice)
  - [O que o sistema faz](#o-que-o-sistema-faz)
  - [Páginas do frontend](#páginas-do-frontend)
  - [Arquitetura](#arquitetura)
  - [Estrutura do repositório](#estrutura-do-repositório)
  - [Banco de dados](#banco-de-dados)
  - [API — endpoints](#api--endpoints)
  - [Setup completo](#setup-completo)
    - [1) Banco de dados](#1-banco-de-dados)
    - [2) API](#2-api)
    - [3) Frontend](#3-frontend)
  - [Scripts disponíveis](#scripts-disponíveis)
  - [Autenticação, papéis e segurança](#autenticação-papéis-e-segurança)
  - [Segurança da informação (Aulas 1–8 de auditoria)](#segurança-da-informação-aulas-18-de-auditoria)
  - [Lembretes automáticos e auditoria](#lembretes-automáticos-e-auditoria)
  - [Teste em sala de aula](#teste-em-sala-de-aula)
  - [Documentação extra](#documentação-extra)
  - [Decisões técnicas](#decisões-técnicas)
  - [Pendências e próximos passos](#pendências-e-próximos-passos)
  - [Problemas comuns](#problemas-comuns)

  ## O que o sistema faz

  | Papel              | Onde                         | Capacidades                                                                                                                                                                                                                                                                                          |
  | ------------------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | **Paciente** | `dashboard.html` | Navegação em **sidebar fixa** à esquerda (vira barra rolável no celular): Início (resumo + próximos eventos + lembretes), **Agendar** (alternador Consulta/Exame, escolhe o **serviço** e vê direto os cartões de unidades/dias com **vagas livres de verdade**, **resumo antes de confirmar**, **rascunho automático**), **Meus agendamentos** (consultas + exames com editar/cancelar/reagendar), Alertas da região, **Minha conta** (perfil com barra de progresso, dados LGPD, MFA, privacidade e DPO) |
  | **Atendente** | `atendente.html` | Navegação em **sidebar fixa** à esquerda (vira barra rolável no celular): Fila do dia (pendentes de hoje, com contador na aba), **Agendamentos** (consultas + exames recentes), Buscar paciente (por nome/e-mail + histórico), confirmar / cancelar / reagendar, **Minha conta** (perfil com barra de progresso, dados LGPD, privacidade e DPO) |
  | **Admin (gestão)** | `admin.html` | Navegação em **sidebar fixa** à esquerda (vira barra rolável no celular): Início (stats + CSV + recentes), Atendimentos (agenda de hoje + recentes), Cadastros (Pessoas / Rede de saúde / Doenças), Auditoria (quem fez o quê e quando) e **Minha conta** (dados do próprio admin + LGPD + privacidade + DPO). **Visão filtrada por `admin_level`** com badge do nível |
  | **Público**        | `index.html`, `privacy.html` | Landing com Como funciona + Recursos, Política de Privacidade em linguagem simples (sem juridiquês, **não revisada por advogado** — ver aviso no topo do arquivo)                                                                                                                                    |

  Cadastro (`auth.html`): wizard em 2 passos — 1) Você (tipo + nome, nascimento, CPF, celular) e 2) Acesso (e-mail + senha). O resto (documentos extras, endereço, perfil de saúde) vai para a seção **Minha conta** depois do 1º login, com barra de progresso.
  Conta de atendente nasce com `account_status = 'pendente'` e só opera após ativação pelo admin.
  Login redireciona automaticamente por papel (`redirectByRole()` em `assets/api.js`).

  ## Páginas do frontend

  | Arquivo             | Rota / acesso                        | Descrição                                                                                                                                                                                                                                                                                                                                  |
  | ------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `index.html`        | pública                              | Landing: hero, `#como-funciona` (3 passos), `#recursos` (consultas/exames/alertas). Se já logado, redireciona por papel                                                                                                                                                                                                                    |
  | `auth.html`         | pública                              | Abas Entrar / Criar conta. Login (`POST /auth/login`) + wizard de cadastro (`POST /auth/signup`)                                                                                                                                                                                                                                           |
  | `dashboard.html` | `requireAuth()` + papel `paciente` | **Sidebar** com rodapé (badge Paciente + nome + e-mail + Sair): Início, Agendar (Consulta/Exame), Meus agendamentos, Alertas, **Minha conta** (perfil, LGPD, MFA, privacidade, DPO). Consome `/me/*`, `/catalog/*`, `/diseases`, `/auth/me`, `/auth/me/export`, `/public/dpo` |
  | `atendente.html` | `requireRole(['atendente','admin'])` | **Sidebar** com rodapé (badge Atendente + nome + cargo + e-mail + Sair): Fila do dia (contador na aba), Agendamentos, Buscar paciente, **Minha conta** (perfil, LGPD, privacidade, DPO). Consome `/staff/*`, `/auth/me`, `/auth/me/export`, `/public/dpo` |
  | `admin.html` | `requireRole(['admin'])` | **Sidebar** com rodapé (badge do `admin_level` + e-mail + Sair): Início, Atendimentos, Cadastros (Pessoas / Rede / Doenças), Auditoria, **Minha conta** (perfil, LGPD, privacidade, DPO). Consome `/admin/*`, `/admin/users/*`, `/admin/professionals/*`, `/health-units/manage`, `/auth/me`, `/auth/me/export`, `/public/dpo` |
  | `privacy.html`      | pública                              | Política de Privacidade LGPD simplificada                                                                                                                                                                                                                                                                                                  |
  | `assets/styles.css` | —                                    | Design system (Inter, cards, tabs, badges, grids, topbar e sidebar/rail)                                                                                                                                                                                                                                                                   |
  | `assets/api.js`     | —                                    | Cliente HTTP + sessão. `API_BASE` padrão `http://localhost:4000`; `apiGet/Post/Put/Patch/Delete`, `authLogin/authSignup/signOut/getSession/requireAuth/requireRole/isAdmin/redirectByRole`, `fmtDate`, `toast`. Sessão em `localStorage` (`saude_token` / `saude_user`), cabeçalho `Authorization: Bearer <JWT>` em toda chamada protegida |

  > Se a API não estiver em `http://localhost:4000`, defina `window.API_BASE` no `<head>`
  > de cada HTML **antes** de `<script defer src="assets/api.js">`.

  ## Arquitetura

  ```text
  Navegador (HTML + assets/api.js)
    │ fetch + Authorization: Bearer <JWT>
    v
  API Express (server/src/app.js + routes/*)
    │ pool.query parametrizado (mysql2/promise)
    v
  MySQL 8 (banco `saude`, charset utf8mb4)
    ^
    │ job diário no boot da API
    └─ server/src/jobs/reminders.js → cria reminders da véspera
  ```

  - `server/src/server.js`: entrypoint — `app.listen(PORT)` + `startReminderJob()`.
  - `server/src/app.js`: CORS + `express.json()` + `GET /health` + montagem das rotas (ordem importa: `/admin/professionals` antes do router genérico `/admin/:kind/:id`) + 404 + handler 500.
  - `server/src/db.js`: pool `mysql2/promise` (`DB_HOST/PORT/USER/PASSWORD/NAME`), `utf8mb4`, limite 10, `dateStrings: true`.
  - `server/src/middleware/auth.js`: `verifyToken` (valida JWT → `req.user {id,email,role,full_name,admin_level}`), `requireAdmin` (só `role=admin`), `requireStaff` (`atendente` ou `admin`).
  - `server/src/middleware/capabilities.js`: `requireCapability` + mapa único nível→permissões (`superadmin/gestor/atendimento/alertas`).
  - `server/src/middleware/audit.js`: `req.audit()` e `audit()` declarativo (só 2xx) — controladores não importam `logAction`.
  - `server/src/middleware/crypto.js`: `req.encryptDoc()`/`req.decryptDoc()` — controladores não importam `utils/crypto`.
  - `server/src/utils/booking.js`: regra da agenda inteligente — janela válida (não no passado, máx. 366 dias), unidade ativa, oferta existe, profissional ativo/vinculado, dentro do `work_schedules`, sem overlap de 30 min nem `schedule_blocks`; `getAvailability()` lista slots livres dos próximos 30 dias.
  - `server/src/utils/audit.js`: `logAction()` grava em `audit_log` sem nunca quebrar a requisição.

  ## Estrutura do repositório

  ```text
  saude-plus/
  ├── index.html          # landing pública
  ├── auth.html           # login + wizard de cadastro (2 passos) + seção Minha conta no dashboard
  ├── dashboard.html      # painel do paciente (sidebar: início, agendar, agendamentos, alertas, minha conta)
  ├── atendente.html      # painel do atendente (sidebar: fila do dia, agendamentos, busca paciente, minha conta)
  ├── admin.html          # painel do admin (sidebar: stats, atendimentos, cadastros, auditoria, minha conta)
  ├── privacy.html        # política de privacidade (linguagem simples)
  ├── assets/
  │   ├── styles.css      # design system
  │   └── api.js          # cliente HTTP + sessão + helpers
  ├── ROTEIRO_TESTE_ALUNOS.md  # roteiro de teste em sala
  ├── docs/               # governanca/ (LGPD/ISO 27001), planos/, tecnico/, referencia/ (ver "Documentação extra")
  └── server/
      ├── schema.sql           # schema canônico (instalação do zero)
      ├── migration_001.sql    # migração p/ bancos antigos (perfil estendido)
      ├── package.json
      ├── .env.example
      ├── src/
      │   ├── app.js             # Express + montagem de rotas
      │   ├── server.js          # listen + job de lembretes
      │   ├── db.js              # pool MySQL
      │   ├── middleware/auth.js # verifyToken, requireAdmin/Staff (+ re-exporta Capability)
  │   ├── middleware/capabilities.js # mapa nível→permissões + requireCapability
  │   ├── middleware/audit.js # req.audit() + audit() declarativo
  │   ├── middleware/crypto.js # req.encryptDoc()/decryptDoc()
      │   ├── jobs/reminders.js  # gera lembretes da véspera (boot + 24h)
      │   ├── utils/booking.js   # validação de agenda + disponibilidade
      │   ├── utils/audit.js     # log de auditoria
      │   └── routes/            # auth, appointments, exams, reminders, diseases,
      │                          # units, staff, catalog, admin, admin.users,
      │                          # admin.professionals, public
      └── scripts/
          ├── seed-admin.js      # cria/promove admin via .env
          ├── seed-v3-demo.js    # massa de demonstração V3
          ├── migrate-v3.js      # migração idempotente p/ agenda inteligente
          ├── migrate-supabase.js# migração opcional a partir do Supabase
          ├── smoke-test.js      # health + 401 em rotas protegidas
          ├── diagnose-db.js     # diagnóstico de conexão/schema
          └── build-pdf.js       # gera PDFs de docs/
  ```

  ## Banco de dados

  Banco `saude` (`utf8mb4_unicode_ci`), 14 tabelas:

  | Tabela                | Guarda o quê                                                                                                                                                                                                                                                                                                                                                                                                                             |
  | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `users`               | Conta + perfil estilo SUS (~30 colunas): `full_name`, `social_name`, `email` único, `password_hash`, `role` (`paciente`/`atendente`/`admin`), `admin_level` (`superadmin`/`gestor`/`atendimento`/`alertas`), `account_status` (`ativo`/`inativo`/`pendente`), contato, `cpf/rg/cns`, `birth_date/gender/priority/race/blood_type`, filiação, responsável legal, endereço completo, `job_role` (atendente), `created_at`, `last_login_at` |
  | `appointments`        | Consultas: `user_id`, `specialty`, `doctor`, `location`, `unit_id`, `professional_id`, `scheduled_at`, `notes`, `status` (`pendente`/`confirmado`/`cancelado`/`concluido`)                                                                                                                                                                                                                                                               |
  | `exams`               | Exames: `exam_type`, mesmos vínculos de agenda/status de consultas                                                                                                                                                                                                                                                                                                                                                                       |
  | `reminders`           | Lembretes: `user_id`, `title`, `message`, `remind_at`, `read`, gerados na véspera pelo job                                                                                                                                                                                                                                                                                                                                               |
  | `diseases`            | Alertas epidemiológicos: `name`, `region`, `alert_level` (`baixo`/`medio`/`alto`), `description`, `active`                                                                                                                                                                                                                                                                                                                               |
  | `health_units`        | Catálogo real de unidades (fonte CNES via ubs.med.br, 10 seeds): UBSs, hospital, clínica, CAPS + `type`, `neighborhood`, `active`                                                                                                                                                                                                                                                                                                        |
  | `professionals`       | Profissionais de saúde: `name`, `job_title`, `registry`, `active`, `user_id` (vínculo opcional com a conta de atendente)                                                                                                                                                                                                                                                                                                                  |
  | `unit_offers`         | O que cada unidade oferece: `unit_id`, `kind` (`consulta`/`exame`), `name`                                                                                                                                                                                                                                                                                                                                                               |
  | `professional_offers` | O que cada profissional atende por unidade/tipo                                                                                                                                                                                                                                                                                                                                                                                          |
  | `work_schedules`      | Horários: `professional_id`, `unit_id`, `weekday` (0=dom…6=sáb), `start_time`, `end_time`, `slot_minutes` (padrão 30)                                                                                                                                                                                                                                                                                                                    |
  | `schedule_blocks`     | Folgas/bloqueios pontuais: `starts_at`, `ends_at`, `reason`                                                                                                                                                                                                                                                                                                                                                                              |
  | `audit_log`           | Rastreabilidade admin: `actor_id`, `action`, `entity_type`, `entity_id`, `details`, `prev_hash`/`entry_hash` (cadeia à prova de adulteração)                                                                                                                                                                                                                                                                                              |
  | `refresh_tokens`      | Sessões rotativas: hash do token, família, expiração e `revoked` (reuso revoga a família)                                                                                                                                                                                                                                                                                                                                                 |
  | `password_reset_tokens` | Recuperação de senha: SHA-256 do token, `expires_at` e `used_at` (uso único; `ON DELETE CASCADE`)                                                                                                                                                                                                                                                                                                                                        |
  | (views/índices)       | FKs com `ON DELETE CASCADE`/`RESTRICT` + índices em `user_id`, `scheduled_at`, `(entity_type, entity_id)`                                                                                                                                                                                                                                                                                                                                 |

  Telefones/horários das unidades na seed **não foram confirmados na fonte pública** — valide antes de divulgar oficialmente.

  ## API — endpoints

  Base `http://localhost:4000`. Auth: `P` = pública, `J` = `verifyToken`, `S` = `requireStaff`, `A` = `requireAdmin`.

  | Grupo               | Método + path                                                                                                 | Auth | Descrição                                                            |
  | ------------------- | ------------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------- |
  | Health              | `GET /health` · `GET /ready`                                                                                    | P    | `{ok:true}` · sonda de prontidão (503 se o banco cair)                 |
  | Auth                | `POST /auth/signup`                                                                                           | P    | Cadastro (paciente livre; atendente nasce `pendente`); registra consentimento e cifra CPF/RG/CNS |
  |                     | `POST /auth/login`                                                                                            | P    | Login (bloqueia `inativo`/`pendente`), retorna `{token, refreshToken, user}` |
  |                     | `POST /auth/refresh` · `POST /auth/logout`                                                                   | P    | Rotaciona sessão (detecta reuso) · revoga refresh                    |
  |                     | `POST /auth/password/forgot` · `POST /auth/password/reset`                                                    | P    | Envia link de recuperação (SMTP ou pendência registrada) · consome token de uso único |
  |                     | `GET /auth/me` · `PUT /auth/me`                                                                               | J    | Lê/atualiza perfil próprio                                           |
  |  | `GET /auth/me/export`                                                                                         | J    | Portabilidade LGPD (JSON + docs decifrados)                          |
  |  | `DELETE /auth/me`                                                                                             | J    | Eliminação LGPD (exige senha; anonimiza)                             |
  | MFA (Aulas 1/6) | `POST /auth/mfa/setup` · `POST /auth/mfa/enable` · `POST /auth/mfa/disable`                                  | J    | Ativa/gerencia o segundo fator TOTP                                  |
  |  | `POST /auth/mfa/verify`                                                                                       | P    | Troca ticket MFA + código pela sessão                                |

  | Minhas consultas    | `GET /me/appointments`                                                                                        | J    | Lista só do `user_id` logado                                         |
  |                     | `POST /me/appointments`                                                                                       | J    | Agenda com validação de `booking.js`                                 |
  |                     | `PATCH /me/appointments/:id/cancel` · `PUT /me/appointments/:id`                                              | J    | Cancela / reagenda (dono)                                            |
  | Meus exames         | `GET /me/exams`                                                                                               | J    | Idem para exames                                                     |
  |                     | `POST /me/exams`                                                                                              | J    | Agenda exame validado                                                |
  |                     | `PATCH /me/exams/:id/cancel` · `PUT /me/exams/:id`                                                            | J    | Cancela / reagenda (dono)                                            |
  | Lembretes           | `GET /me/reminders`                                                                                           | J    | Somente leitura                                                      |
  | Doenças (paciente)  | `GET /diseases?active=true`                                                                                   | J    | Alertas ativos para o painel                                         |
  | Unidades            | `GET /health-units`                                                                                           | J    | Catálogo ativo p/ seletores                                          |
  |                     | `GET /health-units/manage` · `POST /health-units` · `PATCH /health-units/:id`                                 | A    | Gestão de unidades                                                   |
  |                     | `GET /health-units/:id/offers` · `POST /health-units/:id/offers` · `DELETE /health-units/:id/offers/:offerId` | A    | Ofertas da unidade                                                   |
  | Catálogo/agenda     | `GET /catalog/offers` · `GET /catalog/professionals` · `GET /catalog/availability` · `GET /catalog/services?tipo=` · `GET /catalog/slots?tipo=&name=` | J | Seletores dependentes + serviços de todas as unidades + cartões de vagas livres (30 dias) |
  | Staff               | `GET /staff/appointments` · `GET /staff/exams`                                                                | S    | Fila e recentes (todos os pacientes)                                 |
  |                     | `GET /staff/patients?q=` · `GET /staff/patients/:id/history`                                                  | S    | Busca paciente ativo + histórico (sem `cpf/rg`)                      |
  |                     | `PATCH /staff/:kind/:id`                                                                                      | S    | `kind=appointments\|exams`: confirmar/cancelar/reagendar + auditoria |
  | Admin geral         | `GET /admin/stats`                                                                                            | A    | Totais + pendentes + ativos                                          |
  |                     | `GET /admin/export/summary.csv`                                                                               | A    | Resumo CSV                                                           |
  |                     | `GET /admin/appointments` · `GET /admin/exams`                                                                | A    | Todos os agendamentos                                                |
  |                     | `PATCH /admin/:kind/:id`                                                                                      | A    | Gerenciar qualquer agendamento + auditoria                           |
  |                     | `GET /admin/users` · `GET /admin/history?userId=`                                                             | A    | Lista filtrável + histórico por usuário                              |
  |                     | `GET /admin/diseases` · `POST /admin/diseases` · `PATCH /admin/diseases/:id` · `DELETE /admin/diseases/:id`   | A    | CRUD de alertas                                                      |
  |                     | `GET /admin/audit-log`                                                                                        | A    | Trilha de auditoria com filtros                                      |
  |                     | `GET /admin/audit-log/verify`                                                                                 | A    | Verifica a cadeia de hashes (detecta adulteração/remoção)             |
  | Admin usuários      | `GET /admin/users/` (`?q=&role=&status=`) · `GET /admin/users/:id`                                            | A    | Busca e detalhe (lista ignora contas com soft delete)                |
  |                     | `POST /admin/users/`                                                                                          | A    | Cria usuário (valida vínculo profissional antes do insert)          |
  |                     | `PATCH /admin/users/:id`                                                                                      | A    | Status, cargo, papel, nível, senha e vínculo; revoga sessões         |
  |                     | `DELETE /admin/users/:id`                                                                                     | A    | Soft delete + revogação de refresh/resets; bloqueia autoexclusão     |
  | Admin profissionais | `GET /admin/professionals` · `POST /admin/professionals` · `PATCH /admin/professionals/:id`                   | A    | CRUD profissionais                                                   |
  |                     | `POST /admin/professionals/:id/offers` · `DELETE /admin/professionals/:id/offers/:offerId`                    | A    | Vínculos unidade/serviço                                             |
  |                     | `POST /admin/professionals/:id/schedules` · `DELETE /admin/professionals/:id/schedules/:scheduleId`           | A    | Horários semanais                                                    |
  |                     | `POST /admin/professionals/:id/blocks` · `DELETE /admin/professionals/:id/blocks/:blockId`                    | A    | Bloqueios pontuais                                                   |
  | Pública             | `GET /public/stats`                                                                                           | P    | Estatísticas agregadas p/ landing                                    |
  |                     | `GET /public/dpo`                                                                                             | P    | Canal do Encarregado LGPD (usa `DPO_NAME`/`DPO_EMAIL`)                |
  | Interop (Fase 2)    | `GET /interop/status`                                                                                         | S    | CNES/RNDS/Gov.br: o que está configurado (sem segredos)               |
  |                     | `POST /interop/rnds/send` (`{kind, id}`)                                                                      | S    | Monta Bundle RAC e envia à RNDS (501 sem certificado)                 |
  |                     | `GET /auth/govbr/login` · `GET /auth/govbr/callback`                                                          | P    | Login Único (501 sem client; nunca cria usuário sozinho)              |

  Toda query de dado de paciente filtra por `WHERE user_id = ?` (paciente) ou exige `requireStaff`/`requireAdmin` + `audit_log`.

  ## Setup completo

  Pré-requisitos: **Node >= 18** e **MySQL 8 rodando**. Só isso — não precisa
  de `npx serve`, nem de `mysql < schema.sql` na mão.

  ```bash
  git clone <repo> && cd SaudePlus

  npm run setup     # instala as deps, cria o banco, aplica as migrations e cria o admin
  npm run doctor    # confere Node, .env, MySQL, migrations pendentes e portas
  npm run dev       # sobe a API (:4000) e o front (:8080)
  ```

  Acesse `http://localhost:8080`. O `npm run doctor` responde "pronto para
  rodar" quando não falta nada — e diz o quê falta quando falta.

  Os três comandos são idempotentes: rodar de novo não duplica nada.

  ### Setup manual (só se `npm run setup` não servir no seu ambiente)

  O resultado é o mesmo; a diferença é controlar cada passo.

  ### 1) Banco de dados

  ```bash
  mysql --default-character-set=utf8mb4 -u root -p < server/schema.sql
  ```

  > Isso cria o banco `saude` com as 14 tabelas + 10 unidades de saúde de seed.
  O `schema.sql` já é a **união de todas as migrations** — ele sozinho produz um
  banco completo, sem precisar rodar nenhuma migration depois.

  > **Importante (Windows):** o `mysql.exe` usa `latin1` por padrão na sessão CLI.
  > A flag `--default-character-set=utf8mb4` ( + `SET NAMES utf8mb4` no schema)
  > garante que nomes de unidades com acentos sejam gravados corretamente.
  > Sem ela, os seletores de Local exibem caracteres corrompidos.

  > O `schema.sql` tem `CREATE DATABASE saude` e `USE saude` fixos, para funcionar
  > com `mysql < schema.sql`. Para outro nome de banco, use `npm run db:setup`,
  > que reescreve essas duas linhas para o `DB_NAME` em uso.

  Banco já existente de versão anterior: `npm run db:migrate` (aplica todas as
  migrations na ordem correta; todas idempotentes).

  ### 2) API

  ```bash
  cd server
  copy .env.example .env   # Windows (cmd) — no Git Bash/WSL use: cp .env.example .env
  # edite o .env com suas credenciais MySQL, um JWT_SECRET forte e a DATA_ENCRYPTION_KEY
  npm install
  npm run migrate:all                 # todas as migrations, na ordem correta
  npm run seed:admin                  # cria o admin definido no .env
  npm start
  ```

> **Ordem importa:** `migrate:all` roda `v3` → `professional-user` → `security`
> → `privacy` → `interop` → `audit` → `audit:details` → `mfa:replay`
> → `booking:duration` → `reminder:delivery` → `password:reset` →
> `waitlist` → `agenda`, nessa ordem. Pular o
> `migrate:privacy` causa `Unknown column 'privacy_version'` no signup.
  >
  > **Pular o `migrate:interop` não dá erro visível — apenas desliga o MFA
  > silenciosamente.** Sem `users.totp_enabled`, o `if (user.totp_enabled)` da
  > rota de login lê `undefined`, que é falso, e o segundo fator nunca é pedido.
  > Nenhum aviso, nenhuma exceção. Rode `npm run doctor` para conferir.

  `.env` (ver `server/.env.example`):

  | Var                                                           | Exemplo                                 | Para quê                                                          |
  | ------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------- |
  | `PORT`                                                        | `4000`                                  | Porta da API                                                      |
  | `CORS_ORIGIN`                                                 | `http://localhost:8080`                 | Deve bater **exatamente** com a URL do front. `npm run doctor` compara com o que o `serve-web.js` anuncia: se divergirem, todo `fetch` do navegador volta 403 e aparece como "Failed to fetch" no login, sem nada no terminal |
  | `TRUST_PROXY_HOPS`                                            | `0`                                     | Atrás de nginx/Cloudflare: nº de proxies (1 para um nginx). Sem isso o rate limit e o lockout de login vêm do IP do proxy |
  | `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | `localhost / 3306 / root / *** / saude` | Conexão MySQL                                                     |
  | `JWT_SECRET` | string longa aleatória | Assinatura dos tokens (nunca commitar o real) |
  | `JWT_EXPIRES_IN` | `15m` | Validade do access token (curto, padrão RNDS; o front renova sozinho via refresh) |
  | `JWT_REFRESH_EXPIRES_IN` | `30d` | Validade do refresh token (rotativo, revogável via `POST /auth/logout`) |
  | `DATA_ENCRYPTION_KEY` | hex 64 chars | Chave AES-256 da cripto em coluna (CPF/RG/CNS). **Sem ela o app não sobe** — ver "Gravar em texto puro" abaixo |
  | `DPO_NAME` / `DPO_EMAIL` | `...` | Encarregado LGPD exibido em `privacy.html` via `GET /public/dpo` |
  | `RETENTION_INACTIVE_YEARS` | `5` | Anos sem login até anonimização (`purge:retention`) |
  | `CNES_MUNICIPIO_CODE` / `INFODENGUE_GEOCODE` | `260850` / `2608503` | Município IBGE (syncs; sem credencial) |
  | `RNDS_ENV` / `RNDS_UF` / `RNDS_CERT_PFX_PATH` / `RNDS_CERT_PASS` | `homologacao` / `pe` / `...` | Barramento RNDS (exige e-CNPJ + credenciamento) |
  | `GOVBR_BASE_URL` / `GOVBR_CLIENT_ID` / `GOVBR_CLIENT_SECRET` / `GOVBR_REDIRECT_URI` | `https://sso.acesso.gov.br` / `...` | Login Único (exige client homologado) |
  | `ADMIN_EMAIL` / `ADMIN_PASSWORD`                              | `admin@saude.app / ***`                 | Conta criada pelo `seed:admin`                                    |

  API sobe em `http://localhost:4000` — confira com `GET /health` → `{"ok":true}`
  ou `GET /ready` → `{"ok":true,"db":true}` (esse último também testa o banco).

  ### Gravar documentos em texto puro é recusado por padrão

  CPF, RG e CNS são cifrados em repouso com `DATA_ENCRYPTION_KEY`. **Sem essa
  chave, a API não sobe** — a recusa é explícita, com o comando para gerar a
  chave.

  Localmente não é preciso ter a chave: `npm run dev` (e `npm run dev:api`) usam
  `server/scripts/run-local.js`, que define `ALLOW_PLAINTEXT_DEV=1` de propósito
  e imprime aviso no console. `npm run start:api` — o caminho de produção —
  **não** define essa variável e continua fechado.

  > A versão anterior só falhava com `NODE_ENV=production`, e nada no projeto
  > definia `NODE_ENV`: um deploy que não conhecesse a variável gravava documento
  > em claro com o fallback silenciosamente ligado. Um controle que se desliga
  > sozinho porque alguém esqueceu de exportar outra coisa não é um controle.

  ### 3) Frontend e subir tudo junto

  Na raiz do projeto, `npm run dev` sobe **a API (:4000) e o front (:8080)** ao
  mesmo tempo. Para subir separados:

  ```bash
  npm run dev:api    # só a API (scripts/run-local.js: carrega o .env e libera texto puro)
  npm run dev:web    # só o front estático
  ```

  O `dev:api` **não** tem auto-reload: ele roda `node` direto. Para recarregar
  ao editar, use `npm --prefix server run dev`, que é o `nodemon src/server.js`
  — mas ele não passa pelo `run-local.js`, então só funciona depois de
  `npm run db:setup` e com `ALLOW_PLAINTEXT_DEV` no ambiente (veja abaixo).

  O front é servido por `scripts/serve-web.js`, que só entrega as seis páginas e
  `assets/` — qualquer outro caminho responde 404. **Não troque por `npx serve .`**
  nem por `http-server`: servido a partir da raiz do repositório, exporia
  `server/.env` (senha do MySQL, `JWT_SECRET`, `DATA_ENCRYPTION_KEY`) e
  `server/backups/`.

  Acesse **`http://localhost:8080`** — e só essa. O endereço importa porque é
  ele que o navegador manda no cabeçalho `Origin`, e é contra ele que a API
  compara com `CORS_ORIGIN`. Abrir por `127.0.0.1:8080` faz cada chamada
  returning 403: o navegador mostra "Failed to fetch", o terminal não mostra
  nada, e o painel fica vazio. Por isso `npm run dev` anuncia `localhost` e o
  `npm run doctor` avisa quando as duas URLs não batem.

  Se mudar a porta, ajuste as duas pontas: `WEB_PORT` e `CORS_ORIGIN`.

  #### Produção: uma origem só (front React + API no Express)

  Em produção não há segundo servidor nem CORS: o Express entrega o build do
  React (`web/dist`) e a API passa a responder **só em `/api`**.

  ```bash
  npm run build:web          # gera web/dist
  # server/.env: SERVE_WEB=1  e  APP_BASE_URL=https://seu-dominio
  npm run start:api          # um processo: site em / e API em /api
  ```

  `SERVE_WEB` — `1` liga, `0` desliga, vazio liga só com `NODE_ENV=production` e
  build presente. Sem build, o servidor avisa e segue só com a API. Ligado, a
  raiz é do React (`/auth` e `/admin` são páginas dele); `/health` e `/ready`
  continuam na raiz. `assets/` do build cacheia por 1 ano (nome com hash) e o
  `index.html` nunca. O CSP do helmet libera só o próprio site e o ViaCEP
  (consulta de CEP no cadastro). `APP_BASE_URL` é o endereço público usado no
  link do e-mail de redefinição de senha (`/auth?tab=reset&token=…`).

  ### Rota antiga sem extensão

  O navegador pode ter `localhost:8080/admin` salvo no histórico (a URL antiga,
  de quando as páginas eram rotas e não arquivos). O servidor responde **301**
  para `/admin.html` — o mesmo vale para `/auth`, `/dashboard`, `/atendente`,
  `/index` e `/privacy`. Qualquer outro caminho continua 404.

  Acesse `http://localhost:8080`.

  Fluxo de verificação rápida:

  1. `auth.html` → Criar conta (paciente fictício) → login → cai em `dashboard.html`.
  2. Agendar consulta + exame → aparecem em Minha agenda / Próximos eventos.
  3. Login com `ADMIN_EMAIL` → cai em `admin.html` → Visão geral lista dados de todos.
  4. Admin cadastra alerta em Doenças → paciente vê em Alertas após recarregar.

  ## Scripts disponíveis

  ### Na raiz do projeto (o que você deve usar)

  | Script | Para quê |
  | ------ | -------- |
  | `npm run setup` | Instala as dependências, cria o banco, aplica todas as migrations e cria o admin. Idempotente. |
  | `npm run doctor` | Diagnóstico do ambiente: Node, `.env`, MySQL, migrations pendentes, porta 4000/8080 livre, e se falta `DATA_ENCRYPTION_KEY`. |
  | `npm run dev` | Sobe a API (:4000) e o front **React** (`web/`, Vite, :8080) juntos. As páginas ainda não migradas (atendente, dashboard, admin) **não abrem** neste modo. |
  | `npm run dev:legacy` | API (:4000) + front antigo em HTML (:8080, `serve-web.js`). É o que o `npm run test:e2e` usa até a migração terminar. |
  | `npm run dev:api` / `npm run dev:web` | Sobe um lado só (`dev:web` = Vite). O `dev:api` libera texto puro de propósito (modo local). |
  | `npm run build:web` / `npm run test:web` | Build de produção e testes (Vitest) do app React. |
| `npm run start:api` | Sobe **só a API**, no modo fechado: sem `DATA_ENCRYPTION_KEY` ela recusa iniciar. É o caminho de produção. |
  | `npm test` | Suíte completa (`node:test`): contratos HTTP, RBAC, auditoria, cripto, front e banco. |
  | `npm run test:race` | Só o teste de concorrência do booking — precisa de duas conexões MySQL simultâneas. |
  | `npm run test:all` | `npm test` + `npm run test:race`. |
| `npm run smoke-test` | Verificação curta (segundos): saúde, headers, CORS, 17 asserts de RBAC e os validadores. |
| `npm run test:e2e` | Testes de ponta a ponta com navegador real (Playwright). Sobe o `dev` sozinho. Precisa do Chromium: `npm run test:e2e:install` (uma vez). |
| `npm run lint` | ESLint: erro de digitação, variável morta, sintaxe. Segundos, sem MySQL. |
| `npm run check` | `lint` + `test:all` — o portão local completo. |
| `npm run db:setup` / `db:migrate` / `db:seed` | Criar o banco / aplicar migrations / semear admin e dados demo. |
  | `npm run backup` | Dump do banco (gzip + SHA-256 + manifesto), com retenção. |

  O `npm test` roda contra o banco de desenvolvimento e é seguro: usa usuários
  de teste com UUID fixo e limpa o que cria.

  O `npm run test:e2e` **também** roda contra o banco de desenvolvimento e
  precisa de `npm run db:seed` semeado: ele faz login de verdade, no navegador,
  com a conta do `.env`. Sem o seed, os testes que dependem do demo são pulados
  (aparecem como `skipped`) em vez de falharem. Ele sobe o `npm run dev` por
  conta própria e derruba no fim; com o `dev` já rodando, reaproveita.

  ### Continuous Integration

`.github/workflows/ci.yml` roda em cada push e pull request, em três jobs
que saem na ordem mais barata para a mais cara:

| Job | O que roda | Precisa de |
|---|---|---|
| **Lint** | `npm run lint` | nada |
| **Suíte + E2E** | `db:setup` → `db:seed` → `doctor` → `test:all` → `test:e2e` | MySQL 8.4 |
| **Auditoria** | `npm audit --audit-level=critical` | nada |

O job de testes sobe o MySQL como *service container*, com segredos de teste
versionados no próprio workflow (que não servem para nada fora do CI). O
`SMTP_HOST` fica **vazio** de propósito: é a mesma política de "sem
credencial, o sistema funciona mas não finge" que vale em produção.

A auditoria falha só em severidade **crítica**. As 3 `high` restantes são de
`nodemon → chokidar → braces`, que não têm correção upstream e só existem na
máquina do desenvolvedor — descritas em
[`docs/tecnico/TECHNICAL_DEBT.md`](docs/tecnico/TECHNICAL_DEBT.md). Um portão que falha todo
dia por algo que ninguém pode corrigir é um portão que ninguém lê.

### Dentro de `server/` (`npm run <script>`)

  | Script             | Comando                                             | Para quê                                                                                                                                                                   |
  | ------------------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `start`            | `node src/server.js`                                | Sobe a API + inicia job de lembretes. Antes do `listen`, valida `DATA_ENCRYPTION_KEY`, `JWT_SECRET` e se as colunas de migration existem — config inválida impede o boot. |
| `start:local`      | `node scripts/run-local.js`                         | Igual ao `start`, mas com `ALLOW_PLAINTEXT_DEV=1` — desenvolvimento local sem chave de cripto |
  | `dev`              | `nodemon src/server.js`                             | Dev com auto-reload                                                                                                                                                        |
  | `seed:admin`       | `node scripts/seed-admin.js`                        | Cria (ou promove a `superadmin`) o admin do `.env` com `bcryptjs`                                                                                                          |
  | `seed:demo` | `node scripts/seed-v3-demo.js [--reset]` | Popula agenda demo em 4 unidades (serviços, 6 profissionais, horários + 3 vagas ocupadas p/ testar conflito; idempotente) |
| `migrate:all` | roda todas em ordem | `v3` → `professional-user` → `security` → `privacy` → `interop` → `audit` → `audit:details` → `mfa:replay` → `booking:duration` → `reminder:delivery` → `password:reset` → `waitlist` → `agenda`. Idempotente. **É o que o `setup` usa.** |
| `migrate` | importa `migration_001.sql` | Só para bancos muito antigos (perfil estendido). O `schema.sql` já é a união de tudo, então banco novo não precisa. |
  | `migrate:v3` | `node scripts/migrate-v3.js` | Cria `social_name/cns/priority/guardian`, `unit_id/professional_id` e tabelas `professionals/unit_offers/professional_offers/work_schedules/schedule_blocks` (idempotente) |
  | `migrate:professional-user` | `node scripts/migrate-professional-user-link.js` | Adiciona `professionals.user_id` e o índice único que vincula a agenda ao atendente (idempotente; deve rodar antes de `migrate:security`) |
  | `migrate:security` | `node scripts/migrate-security.js` | **Fase 0:** cria `refresh_tokens` + triggers append-only em `audit_log` (idempotente; rode após `migrate:professional-user`) |
  | `migrate:privacy` | `node scripts/migrate-privacy.js` | **Fase 1:** consentimento (`privacy_version`, `consent_at/ip`, `deleted_at`) + `cpf/rg/cns` → TEXT + normaliza CPF + cifra legado (exige `DATA_ENCRYPTION_KEY`) |
  | `migrate:interop` | `node scripts/migrate-interop.js` | **Fase 2:** `health_units.cnes_code/phone/address`, `users.govbr_sub`, `diseases.source/external_ref` |
  | `migrate:audit` | `node scripts/migrate-audit.js` | **Aulas 1/6:** hash encadeado (`prev_hash`/`entry_hash`/`seq`) + MFA (`totp_*`) + FK do log `CASCADE→RESTRICT` |
  | `migrate:reminder:delivery` | `node scripts/migrate-reminder-delivery.js` | **Fase 7:** `reminders.sent_at/send_channel/send_error` — o job passou a enviar e-mail, e sem essas colunas um envio recusado seria indistinguível de um enviado |
| `migrate:password:reset` | `node scripts/migrate-password-reset.js` | **Fase 7:** tabela `password_reset_tokens` (só o SHA-256 do token, `used_at` para uso único, `ON DELETE CASCADE` para respeitar a anonimização LGPD) |
| `migrate:waitlist` | `node scripts/migrate-waitlist.js` | **NV03:** tabela `waitlist` (fila por serviço, prioridade legal primeiro, `record_id` do agendamento convertido; idempotente) |
| `migrate:agenda` | `node scripts/migrate-agenda.js` | **Agenda operacional:** `para_remarcar`, `outcome`, `reschedule_reason`, duração por serviço, índices e `booking_events` (idempotente) |
  | `backup` | `node scripts/backup.js [--dir] [--keep=7]` | **Aulas 1/6:** dump `mysqldump` → gzip → SHA-256 + manifesto, com retenção |
  | `purge:retention` | `node scripts/purge-retention.js [--apply]` | **Fase 1:** sem `--apply` só lista contas inativas +5 anos; com `--apply` anonimiza + limpa refresh tokens +90 dias |
  | `sync:cnes` | `node scripts/sync-cnes.js [--apply]` | **Fase 2:** CNES → `health_units` (dry-run default; `CNES_MUNICIPIO_CODE=260850`) |
  | `sync:alerts` | `node scripts/sync-alerts.js [--apply]` | **Fase 2:** InfoDengue → `diseases` (só `source='infodengue'`) |
  | `test:rnds` | `node scripts/test-rnds.js` | **Fase 2:** builders/validador FHIR offline (sem rede) |
  | `smoke-test`       | `node scripts/smoke-test.js`                        | Verificação curta: `GET /health 200`, headers do helmet, CORS, os 4×401 sem token e a matriz RBAC de `rbac-matrix.js` (mesma que a suíte roda) |
  | `test`             | `node --test "test/*.test.js"`                      | Suíte completa: contratos HTTP, RBAC, auditoria encadeada, cripto fail-closed, front e banco. O teste de corrida fica fora (precisa de 2 conexões) — use `test:race`. |
  | `migrate:supabase` | `node scripts/migrate-supabase.js`                  | Migração opcional a partir do Supabase                                                                                                                                     |
  | (avulsos)          | `diagnose-db.js`, `build-pdf.js` | Diagnóstico de DB, geração de PDFs de `docs/` |

  Engines: `node >= 18`. Deps: `express`, `cors`, `dotenv`, `jsonwebtoken`, `mysql2`, `bcryptjs`,
  `helmet`, `express-rate-limit`, `cookie-parser`, `zod` (+ `nodemon` em dev).

  ## Autenticação, papéis e segurança

  - **Sessão curta + refresh rotativo (Fase 0):** access JWT de 15 min (`saude_token`) como `Bearer` em toda chamada; refresh de 30 dias (`saude_refresh` + cookie `httpOnly`) rotacionado a cada uso em `POST /auth/refresh`, com detecção de reuso (revoga a família) e revogação em `POST /auth/logout` (o `signOut()` do front já chama). Tokens antigos de 7 dias continuam aceitos até expirar — a migração é transparente. Para dados reais de saúde, falta ainda: `httpOnly` total no access, HTTPS/HSTS em produção.
  - **Headers + abuso:** `helmet()` (sem `X-Powered-By`), CORS por allowlist explícita (sem `*`; múltiplas origens via vírgula em `CORS_ORIGIN`), `express.json({limit:'100kb'})`, rate-limit global (300 req/15 min) + estrito em `/auth` (somado ao bloqueio por IP já existente no login: 5 erros/5 min → 429).
  - **`bcryptjs` em vez de `bcrypt`:** mesma API, JS puro, sem toolchain de compilação nem binário pré-compilado — evita falha silenciosa de `npm install` em máquina Windows de aluno ou rede restrita.
  - **Isolamento por usuário no servidor** (não só no front): toda rota `/me/*` filtra por `WHERE user_id = ?`; `password_hash` nunca é serializado; rota de atendente omite `cpf/rg`; `verifyToken` em tudo que é privado, `requireStaff`/`requireAdmin` onde cabe.
  - **Papéis:** `paciente` (só o próprio), `atendente` (`pendente` até ativação; busca só paciente `ativo`; confirma/cancela/reagendar com auditoria; agenda/exames fail-closed sem vínculo profissional; **sem** acesso a RNDS/CPF/CNS), `admin` (via seed ou criado por quem tem a capability `admins`; `admin_level` com efeito real: `superadmin`/`gestor` tudo, `atendimento` só agendamentos, `alertas` só doenças — via `requireCapability`; escalonamento lateral bloqueado — painel ainda unificado).
  - **Conta:** `account_status` (`ativo`/`inativo`/`pendente`); login bloqueia `inativo` e `pendente`; exclusão é soft delete e não retorna em listagens, stats, histórico nem CSV.
  - **Recuperação de senha:** `POST /auth/password/forgot` responde sempre igual (não revela e-mail), grava apenas o SHA-256 do token de uso único; sem SMTP a pendência fica registrada em vez de fingir envio. `POST /auth/password/reset` consome o token e revoga sessões antigas.
  - **Medidas administrativas:** desativar, excluir, trocar papel/senha ou rebaixar um admin revoga refresh tokens e resets pendentes; promover a `admin` exige capability `admins`.
  - **LGPD — Fase 1:** CPF/RG/CNS cifrados no banco (AES-256-GCM, `utils/crypto.js`; chave em `DATA_ENCRYPTION_KEY`, futuro KMS/Vault); consentimento registrado no signup (`privacy_version`, `consent_at`, `consent_ip`); direitos exercíveis pelo titular — portabilidade (`GET /auth/me/export` + botão no dashboard), eliminação via anonimização (`DELETE /auth/me` com senha + botão no dashboard); visualização de documentos pelo admin auditada (`admin_view_user_docs`); expurgo automático de inativas +5 anos (`purge:retention`); DPO público (`GET /public/dpo` + `privacy.html` com bases legais art. 11). Governança em `docs/governanca/ROPA.md`, `docs/governanca/RIPD.md`, `docs/governanca/RESPOSTA_INCIDENTES.md`. Antes de uso com população ainda faltam: HTTPS/HSTS, DPO nomeado de verdade (`DPO_NAME/DPO_EMAIL` ainda vazios), revisão jurídica da `privacy.html` pela Procuradoria e KMS/Vault.

  ## Segurança da informação (Aulas 1–8 de auditoria)

  Cada fundamento virou controle no código:

  | Fundamento | Controle implementado |
  |---|---|
  | **Confidencialidade** | AES-256-GCM em CPF/RG/CNS · bcrypt · TLS (produção) · CORS allowlist · `WHERE user_id` |
  | **Integridade** | `audit_log` **hash encadeado** (`prev_hash`+`entry_hash`) · triggers append-only · FK `RESTRICT` (excluir usuário com trilha é barrado) · verificável em `GET /admin/audit-log/verify` |
  | **Disponibilidade** | `npm run backup` (gzip + SHA-256 + retenção) · `GET /ready` (503 se o banco cair) · job de lembretes tolerante a falha |
  | **Autenticidade** | **MFA TOTP** (RFC 6238, sem dependências) para admin/atendente · Gov.br (Fase 2.3) |
  | **Não repúdio** | Trilha verificável + `audit_view_user_docs` + log sanitizado (CPF parcial, sem token) |

  **Trilha tamper-evident:** cada linha carrega `entry_hash = SHA-256(prev_hash|ator|ação|entidade|detalhes|momento)`. Adulterar, remover ou reinserir uma linha quebra o elo seguinte — e a verificação aponta **qual** linha. Botão **Verificar integridade** em `admin.html → Auditoria`.

  - Ativar MFA: `dashboard.html → Início → Verificação em duas etapas` → cadastre o segredo no Google/Microsoft Authenticator → digite o código.
  - docs: `docs/governanca/PSI.md` (política/normas/procedimentos), `docs/governanca/GOVERNANCA.md` (três linhas, RACI, matriz de risco, PDCA), `docs/governanca/SOA_27001.md` (93 controles mapeados), `docs/governanca/TRILHA_AUDITORIA.md` (tipos, abordagens, kit SQL do auditor), `docs/governanca/DIREITO_TI.md` (LGPD, Marco Civil, art. 154-A CP).

  ## Lembretes automáticos e auditoria

  - **Job de lembretes** (`server/src/jobs/reminders.js`): roda no boot da API + a cada 24h. Busca `appointments/exams` com status `pendente|confirmado` para amanhã e cria `reminders` na véspera (dedupe por `user_id + title + remind_at`). Paciente só lê (`GET /me/reminders`).
  - **Auditoria** (`server/src/utils/audit.js` + tabela `audit_log`): registra confirmar/cancelar/reagendar (staff e admin), CRUD de doenças, gestão de usuários. Visível em `admin.html → Auditoria` e `GET /admin/audit-log`.

  ## Teste em sala de aula

  Guia passo a passo com dados fictícios em **`ROTEIRO_TESTE_ALUNOS.md`**:

  0. Checklist (MySQL, `.env`, `npm run setup`, `npm run doctor`, `npm run dev`, `CORS_ORIGIN`).
  1. Papel aluno (conta → login → `dashboard.html` → consulta + exame → Próximos eventos → Sair).
  2. Papel admin (login seed → `admin.html` → Visão geral com dados de todos → Histórico por e-mail → cadastrar alerta → aluno vê em Alertas).
  3. Teste de segurança (A não vê B; aluno digitando `admin.html` cai em `dashboard.html` com aviso; DevTools mostra `Authorization: Bearer`; deslogado digitando `dashboard.html` cai em `auth.html`).

  > Use sempre nomes/e-mails inventados — nunca dado real de saúde em ambiente de dev.

  ## Documentação extra

  `docs/` é organizado por assunto. Dentro de cada pasta, os documentos se
  cross-referenciam por caminho relativo — ao mover um arquivo, atualize os
  links que apontam para ele.

  ### `docs/governanca/` — segurança da informação, LGPD e auditoria (Aulas 1–8)

  | Doc | Conteúdo |
  | --- | --- |
  | `GOVERNANCA.md` | Três linhas de defesa, RACI, matriz de risco, PDCA do SGSI |
  | `PSI.md` | Política de Segurança da Informação: política/normas/procedimentos/diretrizes |
  | `SOA_27001.md` | Statement of Applicability — 93 controles ISO 27001/27002:2022 mapeados |
  | `TRILHA_AUDITORIA.md` | Manual da trilha: tipos de auditoria, abordagens, kit SQL do auditor |
  | `DIREITO_TI.md` | LGPD, Marco Civil, Lei Carolina Dieckmann (art. 154-A CP) → controle implementado |
  | `ROPA.md` | Registro de Operações de Tratamento + temporalidade/expurgo |
  | `RIPD.md` | Relatório de Impacto à Proteção de Dados (minuta Fase 1) |
  | `RESPOSTA_INCIDENTES.md` | Playbook (contenção, ANPD 3 dias úteis, modelo de aviso ao titular) |

  ### `docs/planos/` — planejamento e backlog

  | Doc | Conteúdo |
  | --- | --- |
  | `PLANO_RNDS_LGPD.md` | Plano Fases 0–2 (hardening, LGPD, RNDS/FHIR) — o mais atualizado dos planos |
  | `PLANO_MELHORIAS.md` | Diagnóstico backend/segurança/dado + plano em fases (atualizado 2026-10-26) |
  | `PLANO_UIUX.md` | Diagnóstico visual/UX/acessibilidade + refactor do admin/dashboard |
  | `PLANO_AGENDA_OPERACIONAL.md` | Plano da agenda operacional (recepção/admin) — Fases 0–3 implementadas |
  | `PROJETO_DO_ZERO.md` | Visão de produto e roadmap de Sprints Scrum; apêndice aponta para `REQUISITOS_REFERENCIA.md` para o estado atual |
  | `TAREFAS_SIMPLES_V3.md` (+ `.html`/`.pdf` gerados por `build-pdf.js`) | Checklist vivo para o time, com painel de status V2→V3 |
  | `TAREFAS_SIMPLES_V2.md` (+ `.pdf`) | **Substituído pela V3** — mantido só como histórico do pedido original |
  | `PROJETO_DO_ZERO.pdf` | PDF gerado de `PROJETO_DO_ZERO.md` |

  ### `docs/tecnico/` — referência técnica

  | Doc | Conteúdo |
  | --- | --- |
  | `PROJETO_COMPLETO.md` | Documentação técnica consolidada (camadas, papéis, 14 tabelas, endpoints, fluxos, scripts, lacunas) |
  | `INTEROPERABILIDADE.md` | Arquitetura de interoperabilidade SUS: modelo FHIR R4, contrato de adaptador, gates G1–G7 |
  | `REQUISITOS_INTEGRACAO_EXTERNA.md` | O que falta pra cada API (RNDS, CNS, Gov.br, e-SUS) funcionar de verdade — credencial, onde pedir, ordem de ação |
  | `DESCOBERTA_SAUDE_DIGITAL.md` | Discovery institucional em andamento: qual sistema o município usa de fato (e-SUS CDS/PEC?) |
  | `REQUISITOS_REFERENCIA.md` | Matriz requisito → código → veredito, comparando o TCC de referência com o Saúde+ atual |
  | `TECHNICAL_DEBT.md` | Dívida técnica conhecida: o que foi corrigido, falso positivo, ou aceito conscientemente |

  ### `docs/referencia/` — documentos-fonte externos (não editar)

  | Doc | Conteúdo |
  | --- | --- |
  | `app_saude_referencia.pdf` | TCC (FATEC Lins) que originou o levantamento de requisitos |
  | `Conectados para o Sucesso 2.0.pdf` | Proposta original da equipe/Programa Passaporte Digital |

  ### `docs/superpowers/plans/` — registro histórico de execução

  Planos de implementação já executados (plan-mode do agente), preservados como
  auditoria do que foi decidido e por quê — não são documentação viva e não devem
  ser editados retroativamente.

  ### Scripts relacionados

  | Script | Para quê |
  | --- | --- |
  | `server/scripts/build-pdf.js` | Gera o HTML/PDF de `docs/planos/TAREFAS_SIMPLES_V3.md` |

  ## Decisões técnicas

  - **Sem libs externas por padrão no front:** a fonte Inter é autohospedada em `assets/fonts/` (sem Google Fonts); mapas, SMS/WhatsApp ficam como próximo passo deliberado, não dependência do dia 1.
  - **Validação de agenda no servidor** (`booking.js`), não só no `<select>`: impede agendar no passado, fora da grade, em slot ocupado ou bloqueado — front sozinho não protege nada.
  - **Validação de documentos padronizada (Fase 0, `utils/validators.js` + `zod`):** CPF com dígito verificador e CNS com checksum oficial DEF-CNS (antes só checava 15 dígitos); `audit_log` sanitizado (CPF/senha/token viram `[redigido]`) e append-only via triggers da `migration_002`; listagens admin/staff aceitam `?page=&pageSize=` com envelope `{data,page,pageSize,total}` (sem query, mantêm o array legado).
  - **Ordem de montagem no `app.js`** é intencional: `/admin/professionals` antes do `PATCH /admin/:kind/:id` genérico, senão o genérico captura a rota e devolve 404.
  - **`PUT /me/:id` vs `PATCH /:id/cancel`:** `PUT` reagenda (revalida disponibilidade, com `excludeId` do próprio registro); `PATCH …/cancel` só troca status — ambos auditados quando via staff/admin.
  - **Datas como string** (`dateStrings: true` no pool) + `fmtDate()` no front para `pt-BR` consistente.

  ## Pendências e próximos passos

  Ordenados por prioridade (nenhum bloqueia o funcionamento atual):

  1. ~~Lembretes automáticos~~ — **parcialmente feito** (job da véspera existe); falta: envio real (e-mail/SMS/WhatsApp), preferências do paciente, retry.
  2. ~~Recuperação de senha~~ — **feita:** forgot/reset com token de uso único e revogação de sessões; falta SMTP real configurado em produção.
  3. ~~Rate limiting / helmet / CORS~~ — **feito na Fase 0** (global + `/auth`, allowlist sem `*`).
  4. Validação server-side ainda parcial (`job_role`, `region` texto livre, reagendar usa `prompt()` no front) — CPF/CNS/datas cobertos (Fases 0–1).
  5. ~~Paginação~~ — **feita** (envelope opt-in); lint/CI e E2E automatizado já existem; falta manter o pipeline verde e ampliar cobertura.
  6. ~~`admin_level` granular no backend~~ — **feito (P0.4):** `requireCapability` aplicado de verdade (`users`, `appointments`, `diseases`, `audit`, `reports`, `admins`); painel admin ainda unificado — separar visões por nível.
  7. ~~Retenção/expurgo~~ — **feito** (temporalidade + `purge:retention`); falta antes de dados reais: HTTPS/HSTS, DPO nomeado, revisão jurídica, KMS/Vault, Fase 2 (RNDS).

  Ver detalhes em `docs/planos/PLANO_MELHORIAS.md`. Os achados da auditoria que
  ficaram **fora** desta rodada estão em
  [`docs/tecnico/TECHNICAL_DEBT.md`](docs/tecnico/TECHNICAL_DEBT.md), com gravidade, local e
  risco de cada um.

  ## Problemas comuns

| Sintoma                           | Causa provável / solução                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `Failed to fetch` no console      | API fora do ar, ou `CORS_ORIGIN` no `.env` ≠ URL do front (inclui porta). Rode `npm run doctor` — ele verifica os dois lados |
| `GET /server/.env` devolve 404    | **Comportamento correto.** O front é servido por allowlist (`scripts/serve-web.js`); `server/` nunca é servido. Foi assim que a auditoria provou que o `.env` não está exposto |
| Login dá **"Failed to fetch"**     | A URL do front não bate com `CORS_ORIGIN`: abra em `http://localhost:8080` (não `127.0.0.1:8080`). `npm run doctor` compara as duas e diz qual está errada |
| Página abre mas fica vazia         | Mesma causa do item acima — o 403 do CORS não aparece no terminal. Confira `npm run doctor` → linha `cors` |
| Abro `/admin` e dá "Rota não encontrada" | É uma URL antiga salva no histórico do navegador. O servidor responde 301 para `/admin.html`; se persistir, limpe o histórico ou digite a URL completa |
| Login não pede o segundo fator    | `migrate:interop` não rodou (sem `users.totp_enabled`, o MFA desliga em silêncio). Rode `npm run db:migrate` |
| "Muitos intentos de login"        | Lockout por conta: 5 tentativas por `ip|email` travam por 15 min. Espere ou ajuste `TRUST_PROXY_HOPS` se está atrás de proxy |
| `Token inválido ou expirado`      | Access expira em 15 min — o front renova sozinho; se persistir, logar de novo                         |
| Erro ao instalar deps             | Confirme `bcryptjs` (não `bcrypt`) — já vem assim no `package.json`                                     |
| Porta 4000 ocupada                | Mude `PORT` no `.env` **e** `window.API_BASE` no front antes de `assets/api.js`                         |
| Alerta não aparece p/ paciente    | Só `active = 1` lista em `GET /diseases?active=true` — confira no admin                                 |
| Acentos corrompidos no Local      | Faltou `--default-character-set=utf8mb4` ao importar o SQL no Windows                                   |
| Atendente não consegue logar      | Conta ainda `pendente` — admin ativa em Usuários e Histórico                                            |
| `404` em `/admin/professionals/*` | Cheque ordem de montagem em `src/app.js` (específica antes da genérica)                                 |
| API não sobe e imprime erro de config | É o fail-closed: `DATA_ENCRYPTION_KEY` ausente/inválida ou `JWT_SECRET` com menos de 32 chars. Em desenvolvimento a falta da chave só avisa; em produção impede o boot |
