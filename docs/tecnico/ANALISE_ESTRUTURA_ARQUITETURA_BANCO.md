# Análise de estrutura, arquitetura e banco de dados (Fase 6)

Data: 2026-11-01 · Branch `stabilize/fase-0-1` · Base: leitura do código, `schema.sql`, suíte de testes e execução real (e2e com banco descartável).
Complementa `TECHNICAL_DEBT.md` (que lista defeitos já fechados) com a visão estrutural. Cada achado traz **evidência** (arquivo/linha ou medição) e **ação sugerida**. Nada aqui foi alterado no código, exceto o que está marcado como *feito*.

## 1. Retrato do projeto

| Parte | Tecnologia | Tamanho | Testes |
|---|---|---|---|
| `server/` API | Node 24, Express 4, mysql2, Zod (1 arquivo), Nodemailer | ~7,6 mil linhas em `src/` | 62 arquivos / ~11 mil linhas (425 casos, `node --test`) |
| `web/` front novo | React 19, Vite 8, TypeScript, Tailwind v4, shadcn/ui, React Query | ~160 arquivos | 336 casos (Vitest) |
| `e2e/` | Playwright (Chromium) contra `npm run dev` | 4 specs / 28 testes | — |
| raiz | (front HTML legado **removido** em 2026-11-01, ADR-0003); restam a demo `event-manager` e `assets/styles.css` | — | — |
| Banco | MySQL, 16 tabelas | `schema.sql` 542 linhas + 14 scripts `migrate-*.js` | `schema-parity`, `boot-schema-guard`, `db-setup` |

Pontos fortes (preservar): auditoria encadeada por hash; documentos (CPF/RG/CNS) cifrados em repouso; MFA TOTP com anti-replay; RBAC por capability testado; rate limit com teto próprio no `/ready`; testes de corrida de agendamento; dívida técnica documentada; paridade `schema.sql` × migrations testada.

## 2. Estrutura e arquitetura do backend

### A1 — Rotas "gordas", SQL direto na camada HTTP (média) — **EM ANDAMENTO**
**Plano em passos** (cada um com suíte verde e commit próprio): (1) sessão/refresh → `services/session.js` **feito**; (2) `middleware/validate.js` + esquemas Zod de `auth` (A2) **feito** (cadastro, login, MFA verify/setup, exclusão de conta; `schemas/auth.js`; a partir daqui, rota nova valida por esquema); (3) `services/mfa.js` **feito** (`mfa-service.test.js`, 5; `auth.routes.js` 744 linhas; `payloadDoUsuario` único em `session.js`); (4) `services/passwordReset.js` **feito** (`password-reset-service.test.js`, 6; `auth.routes.js` 618 linhas); (5) `services/profile.js` + `schemas/profile.js` (GET/PUT/DELETE `/me`, export) **feito** (`profile-service.test.js`, 10; `auth.routes.js` 445 linhas); (6) `services/auth.js` (cadastro, login, Gov.br) **feito** (`auth-service.test.js`, 13; `auth.routes.js` 254 linhas, de 1.067; cookie de refresh agora usa o ponto de montagem — `/auth` ou `/api/auth`); (7) `utils/booking.js`: regra × SQL, em 4 sub-passos — **7a feito** (núcleo puro: `booking-time.js`, `booking-priority.js`, `booking-slots.js` com `gerarSlotsDoDia`, que substitui duas cópias do laço de vagas; equivalência comprovada em 20 mil agendas aleatórias; `booking-pure.test.js`, 18; `booking.js` 995 → 821 linhas e vira fachada), **7b feito** (`repositories/agenda.js` com todo o SQL de leitura da agenda; `booking.js` 821 → 654 linhas e sem `pool.query`; `agenda-repository.test.js`, 9), **7c feito** (`services/bookingChange.js`: `normalizarMudanca` pura + `applyBookingChange` transacional; `repositories/atendimentos.js` com `lerETravar`/`atualizar`; `booking.js` 654 → 448 linhas; `booking-change.test.js`, 13), **7d feito** (`services/bookingRules.js` com validação e disponibilidade; `utils/booking.js` virou fachada de reexportação, sem ciclo — `applyBookingChange` voltou a ser reexportado; **passo 7 concluído**: 995 linhas → fachada + 3 módulos puros + repositórios + 2 serviços); (8) `admin.users` e `admin.professionals`, em 4 sub-passos — **8a feito** (`utils/adminHierarchy.js`: as decisões de privilégio P0.4 como funções puras; `admin-hierarchy.test.js`, 13, com a matriz completa de níveis), **8b feito** (`schemas/adminUsers.js`, `repositories/usuarios.js` + `profissionais.js`, `services/adminUsers.js`; `admin.users.routes.js` 413 → 96 linhas; PATCH e POST agora em transação, com o vínculo conferido ANTES de gravar; `admin-users-service.test.js`, 15). Achados para decisão, sem mudar o comportamento: (a) `bloqueioDeNivel` recusa definir nível ABAIXO do próprio — nem o superadmin consegue atribuir `gestor` pelo PATCH (a regra parece invertida: o risco de escalonamento é nível ACIMA); (b) as mensagens "própria conta" do PATCH são inalcançáveis por admin, porque a hierarquia (nível igual) responde 403 antes; 8c profissionais CRUD, 8d desativação de profissional. Passo 1: `auth.routes.js` 1.067 → 936 linhas; `rotacionarSessao` agora é testável sem HTTP (`session-service.test.js`, 5). Observação: o cookie de refresh usava `path: '/auth'`, mas na origem única a API vive em `/api/auth` e o navegador não o devolvia (o front React enviava o refresh no corpo, então nada quebrava). **Corrigido no passo 6:** o `Path` segue o ponto de montagem (`req.baseUrl`).
`routes/auth.routes.js` tem 1.051 linhas e 43 consultas; `admin.users` 27; `admin.professionals` 26; `utils/booking.js` (995 linhas) mistura regra de agenda e SQL. Só integrações externas vivem em `services/`. Consequência: regra de negócio só é testável subindo HTTP + banco; reaproveitar uma regra (ex.: "desativar profissional remarca atendimentos") exige copiar a rota.
**Ação:** extrair serviços por domínio (`auth`, `users`, `professionals`, `booking`) com a consulta dentro, deixando a rota com validação + resposta. Começar por `auth.routes.js` (maior) e `booking.js`. Sem reescrever: mover função a função, com a suíte atual como rede de segurança.

### A2 — Validação de entrada heterogênea (média) — **EM ANDAMENTO**
**Feito:** `middleware/validate.js` (`validate(schema)` → 400 `{ error: <1ª mensagem> }`, dado normalizado em `req.valid`) e `schemas/auth.js` com as mesmas mensagens e ordem de antes; campos ausentes agora respondem em português (antes o cadastro sem senha devolvia o texto padrão do Zod em inglês). Falta migrar as demais rotas, uma família por vez junto dos passos 3–8 do A1. Testes: `validate-auth.test.js` (11).
Zod aparece em um arquivo (`utils/validators.js`); o resto valida à mão em cada rota (`if (!name…)`). Mensagens e limites divergem entre rotas; o front React valida com Zod, o servidor não compartilha o contrato.
**Ação:** esquemas Zod por rota (ou por domínio) com um `validate(schema)` de middleware; devolver o mesmo formato de erro. Beneficia o front (tipos gerados dos mesmos esquemas se um dia o servidor virar TypeScript).

### A3 — Migrations sem versionamento (média) — **FEITO em 2026-11-01**
**Implementado (ADR-0008):** auditoria provou que `schema.sql` já era a união de tudo (só faltavam os 2 triggers de `audit_log`, agora nele); as 13 migrations de estrutura, `migration_001/002.sql` e `migrate-supabase.js` foram removidos; ficaram 4 migrations de DADOS em `server/migrations/NNNN_*.js`, aplicadas por `scripts/migrate.js` com registro em `schema_migrations` (checksum, para na falha). `doctor` avisa pendências. Testes: `migrate-runner.test.js` (7). Texto original abaixo.

14 scripts idempotentes rodam todos, em ordem fixa, a cada `db:setup`; `schema.sql` é a "união". Não há tabela de controle (`schema_migrations`), então não se sabe qual versão um banco já está nem se pode reverter. A paridade é guardada por teste (`schema-parity`), o que reduz o risco, mas só enquanto alguém lembra de atualizar os dois lados.
**Ação:** migrations numeradas (`001_…sql`) + tabela de controle (ferramenta pronta, ex. `umzug`/`node-pg-migrate` equivalente MySQL, ou um runner de 50 linhas). Migrar os 14 scripts para a numeração sem mudar o resultado; manter o teste de paridade.

### A4 — Job de lembretes dentro do processo da API (média)
`jobs/reminders.js:227` usa `setInterval(…, DAY_MS)`. Com duas instâncias da API (ou reinício a cada deploy) o envio duplica ou se perde; não há trava distribuída nem registro de "última execução".
**Ação:** `GET_LOCK` do MySQL (ou coluna `last_run`) em volta da execução; ou processo separado (`node server/src/jobs/run.js` por cron do sistema). O teste `reminder-delivery` já cobre o envio, falta cobrir a exclusão mútua.

### A5 — Observabilidade mínima (baixa/média)
Erros vão para `console.error` sem id de requisição, nível ou formato estruturado; `/ready` só diz se o banco responde. Difícil correlacionar "Erro interno" do usuário com a linha de log.
**Ação:** id por requisição (header `X-Request-Id`, devolvido no JSON de 5xx) e log em JSON (ex. `pino`). Custo baixo, ganho alto em produção.

### A6 — Higiene do repositório (baixa)
Versionados sem necessidade: `server/scripts/temp_marked.js` (arquivo temporário), `migrate-supabase.js` (vestígio de outra plataforma), `.superpowers/…/progress.md`, `ROTEIRO_TESTE_ALUNOS.md` na raiz, ~2,7 MB de PDFs em `docs/` (binários no git incham o histórico). `graphify-out/` (3 MB gerado) ficou fora do commit.
**Ação:** remover os dois scripts e o `.superpowers`; mover PDFs para um release/armazenamento de documentos; `graphify-out/` no `.gitignore`.

### A7 — Dois front-ends no mesmo repositório (**resolvido**, ADR-0003)
O front legado (6 HTMLs + `assets/` + `scripts/serve-web.js`) sustentava ~200 casos de teste estáticos em `server/test`. Com o React cobrindo todas as áreas e o e2e novo passando, foi removido no commit `d5b799c` (reversível com `git revert`). Os testes de XSS/escape do legado perderam o objeto; o React escapa por padrão (JSX) e `dangerouslySetInnerHTML` aparece só em `components/ui/chart.tsx` (CSS de tema do gráfico, sem dado de usuário). Sugestão: lint que proíba novo uso.

### A8 — Bundle do front (baixa)
Chunk principal 555 kB (aviso do Vite acima de 500 kB); rotas por papel já são `lazy`. Candidatos: separar `recharts` e `react-day-picker` em chunks próprios (`manualChunks`) e carregar o gráfico de Alertas sob demanda.

## 3. Banco de dados

Resumo do modelo: `users` (40 colunas) concentra perfil, credenciais, MFA, consentimento e Gov.br; agendamento em `appointments`/`exams` (+ `booking_events`, `waitlist`); oferta em `health_units` → `unit_offers`, `professionals` → `professional_offers`/`work_schedules`/`schedule_blocks`; segurança em `refresh_tokens`, `password_reset_tokens`, `audit_log` (cadeia de hash).

### B1 — Agendamentos sem integridade referencial para unidade e profissional (alta) — **FEITO em 2026-11-01**
**Implementado:** `migrate:booking:refs` (entra no `migrate:all`) + FKs/índices no `schema.sql` (4 FKs `ON DELETE SET NULL`, índice `(unit_id, scheduled_at)` nas duas tabelas); o `doctor` passou a conferir as FKs. Com órfãos a migração **para sem alterar nada** e lista os registros; `--fix-orphans` zera só o vínculo. Auditoria no banco de desenvolvimento: 0 órfãos (tabelas vazias). Testes: `server/test/booking-refs.test.js` (9) + suíte do servidor 370/372 e corrida 7/7. Texto original do achado abaixo.

`appointments`/`exams` têm `unit_id` e `professional_id`, mas **só `user_id` tem FK** (`schema.sql`). Não há índice em `unit_id`. Também guardam `location`, `doctor`, `specialty` como texto livre copiado no momento do agendamento. Consequências: ids órfãos possíveis; renomear uma unidade não reflete nos agendamentos antigos (pode ser desejado como "foto", mas hoje não é decisão documentada); consultas por unidade fazem varredura.
**Ação:** (1) auditar órfãos (`SELECT … WHERE unit_id IS NOT NULL AND unit_id NOT IN (SELECT id FROM health_units)`); (2) adicionar FKs `ON DELETE SET NULL` + `INDEX (unit_id, scheduled_at)`; (3) documentar que `location/doctor` são a "foto" do momento.

### B2 — Exclusividade de horário só na aplicação (média) — **FEITO em 2026-11-01**
**Implementado:** `active_slot` (coluna gerada `STORED`) + `UNIQUE (professional_id, active_slot)` em `appointments` e `exams` (no `schema.sql` e na migration `0005_horario_unico`, que PARA e lista ids se houver horário ativo duplicado). O erro `ER_DUP_ENTRY` do banco vira 409 "Horário já ocupado" no handler global (`utils/dbErrors.js`), a mesma resposta do conflito detectado pelo `FOR UPDATE`. Cancelado/concluído/para_remarcar liberam o horário. Limites mantidos: `professional_id` NULL não é protegido e a sobreposição por duração fica na aplicação. Testes: `horario-unico.test.js` (18, inclui 20 conexões simultâneas → 1 vence). Texto original abaixo.

Não há restrição no banco contra dois agendamentos no mesmo (profissional, horário); a garantia vem de `SELECT … FOR UPDATE` dentro de transação (`utils/booking.js:321/849/950`) e dos testes de corrida. Funciona e está testado, mas depende de todo novo caminho de escrita lembrar do padrão.
**Ação:** rede de proteção no banco: coluna gerada `active_slot = IF(status IN ('pendente','confirmado'), scheduled_at, NULL)` + `UNIQUE (professional_id, active_slot)`. Cobre o caso exato; sobreposição por duração continua na aplicação.

### B3 — CPF cifrado sem índice cego: duplicidade e busca O(N) (média) — **FEITO em 2026-11-01**
**Implementado:** `users.cpf_hmac CHAR(64)` + `UNIQUE uq_users_cpf_hmac` (HMAC-SHA256 com `CPF_HMAC_KEY`, chave separada e exigida no boot); `migrate:cpf:hmac` (backfill idempotente; com CPF duplicado PARA e lista só ids; `--rehash` após trocar a chave); cadastro e `PUT /auth/me` gravam o índice e devolvem 409 em duplicata; Gov.br busca por `cpf_hmac` e confere o dado cifrado; anonimização zera o índice; `doctor` confere coluna e chave. Testes: `server/test/cpf-hmac.test.js` (21, inclui 5 cadastros simultâneos → 1 vence). No banco de desenvolvimento: 1 CPF indexado, 0 duplicatas. Texto original do achado abaixo.

CPF/RG/CNS usam AES-256-GCM (correto), mas sem um *blind index* (HMAC do CPF). Efeitos verificados: o vínculo Gov.br faz `SELECT id, cpf FROM users WHERE cpf IS NOT NULL` e decifra tudo na aplicação (`auth.routes.js:745`); **o cadastro não checa CPF repetido** (só o e-mail é `UNIQUE`), então a mesma pessoa pode ter duas contas, com fila e histórico divididos.
**Ação:** coluna `cpf_hmac CHAR(64)` (HMAC-SHA256 com chave separada da de cifra) + `UNIQUE`; preencher por migração (decifra uma vez); trocar a varredura por `WHERE cpf_hmac = ?`. Mantém a comparação em tempo constante já implementada em `utils/cpf.js`.

### B4 — Alertas ligados a bairros por texto (baixa)
`diseases.region` é texto igual a `health_units.neighborhood`. Renomear um bairro numa unidade deixa o alerta apontando para um nome que ninguém mais usa, e nada avisa.
**Ação:** tabela `regions` (ou validar a região contra os bairros existentes ao salvar, que o React já faz na criação).

### B5 — Datas sem fuso (baixa, documentar)
`DATETIME` + `dateStrings: true` guardam e devolvem hora "de parede" do servidor. Funciona em um município/fuso único; quebra com servidor em UTC e usuários em outro fuso, ou mudança de horário.
**Ação:** fixar `TZ` no deploy e registrar a premissa em `PRODUCT.md`; revisitar se houver mais de um fuso.

### B6 — Pontos menores
- `idx_appointments_user` é prefixo de `idx_appointments_user_scheduled` (e o mesmo em `exams`): o primeiro é redundante.
- `audit_log.actor_id` `ON DELETE RESTRICT` impede apagar usuário com trilha — coerente com a LGPD (exclusão é anonimização), manter.
- `users` com 40 colunas é larga; separar `user_security` (MFA, Gov.br, tentativas) só vale se a tabela virar gargalo.
- `connectionLimit: 10` fixo em `db.js`: expor em variável de ambiente.

## 4. Segurança e dependências

- `npm audit --omit=dev` no servidor acusava 4 vulnerabilidades (body-parser, qs, ip-address, **zod** — DoS por memória/laço). **Feito:** `npm audit fix` (somente `package-lock.json`, versões compatíveis); agora 0 em produção. Sobram 2 moderadas em `nodemon` (só desenvolvimento). Suíte do servidor: 362/363 após a remoção do legado (a única falha é o teste do `doctor` ao rodar com banco descartável, artefato do ambiente de teste, não do código).
- Front: `npm audit` = 0.
- **Feito (Fase 5):** o link do e-mail de redefinição apontava para `/auth.html`, que não existe no front React; agora usa `/auth?tab=reset&token=…` (teste cobre).
- Achados registrados nas fases anteriores (ainda abertos):
  1. ~~**MFA:** segredo em base64url, não cadastrável em app autenticador.~~ **FEITO em 2026-11-01:** `randomSecret()` gera base32 (32 caracteres, 20 bytes); `migrate:mfa:base32` recodifica os segredos já gravados mantendo os mesmos bytes (códigos não mudam, ninguém perde o 2º fator); o servidor aceita os dois formatos até a migração rodar. Testes: `totp-base32.test.js` (vetor oficial RFC 6238, equivalência legado/novo, migração). Pendente à parte: o `totp_secret` ainda é gravado sem cifra em coluna (risco menor; avaliar cifrar com `DATA_ENCRYPTION_KEY`) e o painel admin ainda não tem o cartão de MFA (o do paciente serve de base).
  2. `GET /auth/me` devolve CPF/CNS/RG sem máscara ao próprio titular; menos exposição se devolver mascarado e expor o completo só em "Minha conta" sob demanda.
  3. `seed:demo` cria agendamentos para outro usuário, não para o paciente de teste (atrapalha demonstração).
  4. Servidor rejeita agendar sem profissional (409) quando há profissionais para o serviço; o React já exige a escolha, o legado não.

## 5. Ordem sugerida

| Prioridade | Item | Esforço | Por quê primeiro |
|---|---|---|---|
| 1 | ~~B1 FKs + índice em `unit_id`~~ **feito** | S | integridade de dados clínicos |
| 2 | ~~B3 `cpf_hmac` único + busca indexada~~ **feito** | M | duplicidade de pacientes + varredura O(N) |
| 3 | ~~MFA base32 com migração de segredos~~ **feito** | M | 2º fator inutilizável em app real |
| 4 | ~~A4 trava no job de lembretes~~ **feito** (`utils/jobLock.js`, `GET_LOCK`; `job-lock.test.js`, 7) | S | duplicação de e-mails/SMS ao escalar |
| 5 | ~~A3 migrations numeradas~~ **feito** (ADR-0008; 13 migrations de estrutura removidas, 4 de dados numeradas) | M | habilita todas as mudanças de banco acima com segurança |
| 6 | A1/A2 serviços + validação Zod, começando por `auth` | L | manutenção; faça junto de cada mudança, não como projeto à parte |
| 7 | A7 aposentar legado, A6 higiene, A8 bundle | S–M | redução de superfície |
| 8 | ~~B2 índice único de horário~~ **feito**, A5 request id/logs | S | defesa em profundidade e operação |

S ≤ 1 dia · M 2–4 dias · L > 1 semana (estimativas de ordem de grandeza).

## 6. Documentos derivados desta análise

A análise gerou os instrumentos abaixo, todos em docs/tecnico/:

| Tipo | Documento | Cobre |
|---|---|---|
| Request for Comments | [fc/RFC-0001-integridade-de-agendamento-e-identidade.md](rfc/RFC-0001-integridade-de-agendamento-e-identidade.md) | B1, B2, B3: proposta, alternativas, riscos, perguntas abertas |
| Architecture Decision Records | [dr/](adr/README.md) (ADR-0001 a 0008) | 5 decisões já tomadas (front React, origem única, aposentar legado, e2e por API, credenciais de admin) e 3 propostas (CPF HMAC, integridade no banco, migrations numeradas) |
| Especificação técnica | [especificacao/ESPEC-001-integridade-agendamento-e-cpf.md](especificacao/ESPEC-001-integridade-agendamento-e-cpf.md) | Modelo de dados, algoritmo, mudanças por arquivo, migração expand→backfill→contract, testes |
| Proof of Concept | [poc/POC-001-integridade-agendamento-e-cpf.md](poc/POC-001-integridade-agendamento-e-cpf.md) + `server/scripts/poc-integridade.js` | 18/18 verificações em MySQL 8.0.42; busca por CPF 8,4 s → 11 ms |
| Prós e contras | [PROS_E_CONTRAS.md](PROS_E_CONTRAS.md) | 6 decisões comparadas + quando usar RFC, ADR, especificação e PoC |
