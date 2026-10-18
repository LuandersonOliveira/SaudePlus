# SDD ledger — plan: docs/superpowers/plans/2026-10-16-saudeplus-estabilizacao.md

Branch: `stabilize/fase-0-1` (base `main` @ 0a7d863)
Ambiente verificado: Node v24.18.0 · MySQL80 rodando · banco `saude` existe e está migrado · 52/52 JS passam `node --check`

## Pre-flight: interfaces compartilhadas entre tasks

| Tasks | Produz | Consome | Achado |
|---|---|---|---|
| 1 → 3, 13, 19, 20, 23 | scripts raiz (`dev`, `doctor`, `db:setup`, `test`) | `concurrently`, `dotenv`/`mysql2` resolvidos de `server/node_modules` | a raiz não tem `node_modules`; os scripts raiz precisam resolver deps do `server/` via `require.resolve(..., { paths: [serverDir] })` |
| 1 → 25 | `server/test/web-server.test.js` | `npm test` da raiz = `npm --prefix server test` | o teste do front mora em `server/test/` e já entra na suíte — não duplicar |
| 2, 19 → 5, 19 | `doctor.js` ganha checks (`frontend-escaping`, `dpo`) | — | ambos editam `scripts/doctor.js`; as edições são cumulativas e não conflitam |
| 5, 6, 22 | contrato `PUT /auth/me` partial update | admin/atendente/dashboard | Task 6 muda o contrato do back; Tasks 5 e 22 editam os mesmos HTMLs mas em linhas distintas |
| 8 → 9 | `audit_log.details` → `TEXT` em `schema.sql` | Task 9 regenera `schema.sql` | Task 9 re-altera a mesma linha; sem conflito, mesmo valor |
| 12 → 16 | `app.js` reordenação de middleware | Task 16 edita `db.js` e `.env.example` | Task 16 adiciona `TRUST_PROXY_HOPS` ao `.env.example` que Task 12 também edita |

Pre-flight: 6 filas, todos resolvidos sem conflito. Ruling: ordem de execução 1→2→3→4…→26 conforme o plano.

Estado atual: **Fases 0, 1, 2 e 4 concluídas**, Fase 5 em andamento, e a
**revisão do trabalho das fases feita e corrigida** (`e11d3e8`, `e4068d3`,
`60728b5`).
Suíte: **248 testes + 7 de corrida**, `smoke-test` verde, doctor pronto.

## Revisão das fases — o que ela encontrou

A revisão cruzou 30 commits / 73 arquivos procurando bug, não estilo. O padrão
dos achados sérios foi **um só**: duas fontes de verdade para a mesma
informação.

- `db-setup.js` tinha uma lista de migrations e `package.json:migrate:all`
  tinha outra. Divergiram quando a Fase 5 criou duas migrations — e
  `npm run db:setup` passou a anunciar "Pronto." numa base sem as colunas.
- `doctor.js` tinha uma lista de colunas, e a Fase 5 criou colunas que não
  entraram nela: o doctor ficou verde justamente onde a API quebrava.
- `doctor.js` ainda consultava o banco pelo valor do `.env` enquanto o pool
  conectava pelo valor do ambiente — dois bancos ao mesmo tempo.
- `validators.js` copiava os ENUMs do schema à mão, com um pedido de
  sincronia em comentário.

**Prova de que a correção é a causa, e não a coincidência:** cada teste novo
foi rodado contra o código antigo antes de ser aceito — o replay sem mutex
falha com "escrita 3 não encadeia na 2", o `db:setup` antigo deixava as colunas
de fora numa base real, e o `doctor` antigo aprovava essa mesma base.

## Fase 5 — o que já saiu

| Lote | Commit | Conteúdo |
|---|---|---|
| "respondeu sucesso e não fez nada" | `f10b638` | `INSERT IGNORE` devolvendo 201 com id fantasma (2 rotas), `TIME_RE` aceitando `99:99`/`12:99` (dava **500**, não 400), `SUM()` vazio devolvendo `null` no painel e no CSV, rota `/admin/users` duplicada (código morto) |
| segundo fator | `c9a0271` | replay de TOTP barrado (`totp_last_step`), teto de 5 tentativas por conta, migration 006 |
| trilha de auditoria | `1c928bd` | mutex `GET_LOCK` na escrita da auditoria + `verifyChain` seguindo o encadeamento em vez da numeração |
| exclusão LGPD | `3cb8c92` | anonimização dentro de transação; a função agora **recusa** pool sem `getConnection` em vez de degradar para "sem transação" |
| duração do atendimento | `70c05db` | `duration_minutes` gravado no agendamento (migration 007); atendimento de 60 min passou a bloquear 60 min |
| dívida que não era dívida | `cc26cca` | o "XSS residual em onclick" é falso positivo — testado e fechado sem tocar em código |

## Bugs encontrados verificando (e não só lendo)

Estes só apareceram porque os testes foram **executados** — inclusive nos dois
sentidos:

- **`npm run setup` não instalava as dependências da raiz** (`concurrently`),
  então num clone novo o setup "terminava" e o `dev` morria.
- **`test:race` deixava 9 bancos `saude_race_*` órfãos** quando o processo morria.
- **A trilha de auditoria não era válida sob concorrência.** `SELECT ... ORDER BY
  seq DESC LIMIT 1 FOR UPDATE` não serializa: no fim do índice não há linha
  seguinte para travar em gap lock. Duas requisições liam a mesma cabeça e as
  duas gravavam. Isso vale em produção, não só na suíte.
- **`verifyChain` acusava "cadeia quebrada" em trilha intacta**: `seq` é
  AUTO_INCREMENT e queima número em transação que rolou back, então salto de
  sequência é normal — mas o verificador exigia adjacência por `seq`.
- O teste de replay foi verificado **sem o mutex** e falha com "escrita 3 não
  encadeia na 2 — duas requisições leram a mesma cabeça". Teste que só passa
  com a correção não prova que a correção é a causa.

## Pendência que precisa de decisão do usuário

**RESOLVIDA.** A bifurcação na linha 156 da `audit_log` existia porque a trilha
anterior tinha sido escrita sem mutex. Com a autorização do usuário, a base foi
reconstruída (`npm run db:setup -- --fresh saude`), o dump antigo ficou em
`server/backups/saude-2026-10-17.sql.gz`, e a cadeia nova foi verificada:
71 linhas, começando em `GENESIS`, sem bifurcação. Nada de dado real foi
perdido — era base de desenvolvimento.

## Decisões que o usuário tomou no caminho

- **Reconstruir sem restaurar backup.** O backup de 6 dias (`saude-2026-10-10.sql.gz`,
  SHA-256 conferido) foi deixado de fora: o conteúdo era estado de desenvolvimento,
  não dado de produção. A causa raiz foi corrigida e coberta por teste.
- **Reconstruir a base de desenvolvimento** quando a trilha de auditoria ficou
  com uma bifurcação que só a trigger append-only impede de reparar. Backup do
  estado anterior tirado antes, mesmo sendo dado descartável.
- **Escopo:** só CRITICAL e HIGH entram nesta rodada. Os MEDIUM/LOW ficaram
  registrados em `docs/TECHNICAL_DEBT.md` com gravidade, local e risco.
- **`node:test`** como runner, sem dependência nova de framework de teste.
- **Teste de corrida isolado** em `server/test/race/`, rodado por
  `npm run test:race` — exige duas conexões MySQL reais simultâneas, então não
  faz parte da suíte padrão.

## Bugs encontrados verificando a documentação (e não só lendo o código)

Estas coisas só apareceram porque o caminho documentado foi **executado de ponta a
ponta** num clone limpo, não inspecionado:

- **`npm run setup` não instalava as dependências da raiz.** Ele rodava
  `npm --prefix server install`, mas `npm run dev` usa `concurrently`, que é
  devDependency da raiz. Num clone novo o setup terminava com sucesso, o doctor
  dizia "Ambiente pronto", e o `dev` morria com *"'concurrently' não é
  reconhecido"*. Corrigido + teste de regressão em `doctor.test.js`.
- **`test:race` deixava bancos `saude_race_*` para trás** — 9 acumulados na
  máquina, porque o teardown não roda quando o processo morre. Agora o `before`
  varre os órfãos antes de criar o seu.
- **Teste de contrato passando errado:** a primeira versão de `api.test.js`
  assumiu que `/catalog/slots` recebia `professionalId`+`date` (não recebe — é
  `tipo`+`name`), e quando a suíte foi interrompida antes do resumo a saída
  parcial mostrou ✔. Contrato que só olha status 200 passa mentira.

## Rulings de setup

- **Ruling: branch `stabilize/fase-0-1` no diretório de trabalho, não worktree.** A skill
  sugere worktree, mas o objetivo declarado do usuário é rodar o projeto localmente
  neste diretório; um worktree colocaria as correções fora do caminho que ele usa.
  Branch nova em vez de `main` cumpre a exigência de não implementar na branch principal.
  Custo se errado: um `merge` extra no fim.

- **Ruling: `scripts/serve-web.js` próprio em vez da devDependency `serve`.** `serve`
  na raiz do repositório serve `server/.env` (DB_PASSWORD + JWT_SECRET +
  DATA_ENCRYPTION_KEY) e `server/backups/`. Um servidor de allowlist de ~40 linhas
  elimina a classe do problema e remove uma dependência. O plano já previa isso.
  Custo se errado: ~40 linhas a mais de código para manter.

## Tasks

Task 1: complete (commits 0a7d863..9d70da3, tests: `node --test test/web-server.test.js` → 7/7 pass)
  - Verificado com curl: `/index.html` 200, `/server/.env` 404, `/.gitignore` 404, `/package.json` 404.

Task 2: complete (commits 9d70da3..587053f, tests: `node --test server/test/doctor.test.js` → 10/10 pass)
  - `npm run doctor` verde contra o ambiente real (exit 0).
  - Ruling: `frontend-escaping` saiu como **aviso**, não falha — é defeito de código (Task 5), não de ambiente, e imprimir `[FALHA]` sem afetar o exit era saída enganosa.

Task 3: complete (commits 587053f..509dde1, tests: `node --test server/test/db-setup.test.js` → 18/18 pass)
  - Bootstrap real validado em `saude_doctest`: 6 migrations aplicadas, idempotente na 2ª rodada, doctest removido.
  - `saude` reconstruído do zero por decisão do usuário (sem restaurar o backup de 10/10).

Task 3b: complete (commit e7c5d6a, tests: `node --test server/test/schema-seed.test.js` → 3/3; suíte 38/38; smoke-test verde)
  - Defeito achado no teste de aceitação de `npm run dev`: `/admin/stats` devolvia
    `units.total = 30`. Causa: `schema.sql:204` semeava health_units com `UUID()` como
    id, então a PK nunca colidia e o `INSERT IGNORE` duplicava as 10 unidades a cada
    `db:setup`. Ids fixos no seed; `saude` limpa para 10 unidades / 10 nomes.
  - Contradizia a promessa de idempotência do próprio db-setup e do README.

**FASE 0 COMPLETA.** `npm run dev` sobe API (:4000) e front (:8080) num comando.
  - `/health` → `{"ok":true}` · `/ready` → `{"ok":true,"db":true}` · login admin OK (superadmin)
  - `/server/.env` → 404 (allowlist) · `npm run doctor` → exit 0 · `npm test` → 38/38 · smoke-test → verde

Task 4: complete (commit 7a85098, tests: `node --test server/test/stylesheet.test.js` → 8/8; suíte 46/46)
  - `assets/styles.css:11-14` tinha texto solto + terminador de comentário órfão.
    O parser de CSS consome lixo de nível superior até a próxima `{` — que era a
    `.sr-only`. 14 rótulos de leitor de tela e 4 skip-links apareciam como texto.
  - Ruling: o teste "`.sr-only` presente" **passava** mesmo com o bug (a regra
    existe no arquivo, só não chega ao parser). Os testes estruturais é que pegam,
    e um auto-teste no fim do arquivo prova isso com o CSS quebrado original.

Task 5: complete (commit 827a2e8, tests: `node --test server/test/escaping.test.js` → 14/14; suíte 60/60)
  - `esc()` escapava só `/[&<>"]/`. Nome com apóstrofo → SyntaxError no onclick.
  - Converti **7** sítios (não os 2 do plano): histórico+perfil (admin),
    histórico (atendente), rebook/cancel/edit (dashboard). Elimina a classe
    inteira em vez de só os dois CRITICAL.
  - Ruling: `esc()` ficou autocontido (mapa de entidades dentro da função) para
    não depender de contexto externo e poder ser extraído/testado isoladamente.
  - Ruling: `frontend-escaping` saiu como AVISO no doctor, não FALHA — é defeito
    de código, não de ambiente. Agora reporta `[ok]`.

Task 6: complete (commit 5802110, tests: `node --test server/test/profile-update.test.js` → 16/16; suíte 76/76; smoke verde)
  - `PUT /auth/me` era replace total com `|| null` em 22 colunas. Cada painel
    manda corpo parcial → toda coluna ausente era apagada.
  - O RED expôs 3 bugs extras: gender/blood_type inválidos davam **500**
    (MySQL não-estrito emite WARN_DATA_TRUNCATED e o driver tratava como erro),
    `priority: 'vip'` era aceito com 200 e virava NULL, e `birth_date` em
    formato br dava 500.
  - Ruling: `cpf`/`rg`/`cns` são **exceção** — os inputs não são preenchidos
    (Privacy), então campo vazio = "não me mexa". Mandar `''` apagaria o
    documento salvo a cada gravação. Dois testes travam a decisão.

Task 7: complete (commit 29a1cc7, tests: `node --test server/test/mfa-setup.test.js` → 8/8; suíte 84/84)
  - `mfa/setup` gerava e devolvia o segredo TOTP sem exigir a senha. Com um
    Bearer vazado, o atacante lia o segredo e assumia o segundo fator.
  - Ruling: a tela passou a usar o modal `askPassword` já existente em vez de
    `prompt()` nativo (o DESIGN.md proíbe). Teste trava o contrato no front.

Task 8: complete (commit a5311eb, tests: `node --test server/test/audit-details.test.js` → 11/11; suíte 95/95)
  - `audit_log.details` era VARCHAR(255) e o `reason` não tinha teto: motivo de
    300 chars executava a ação **sem** registro nenhum (ER_DATA_TOO_LONG engolido).
  - Três camadas: `schema.sql` vira TEXT; `reason` limitado a 1000 nas duas rotas;
    `logAction` trata ER_DATA_TOO_LONG truncando **e recalculando o hash** (sem
    recalcular, `verifyChain` acusaria "conteúdo alterado" numa linha intacta).
  - Ruling: o teste lê o `schema.sql`, não só o banco vivo. A migration 005b já
    tinha consertado o banco de desenvolvimento — checar só ele mascarava que a
    instalação limpa continuava quebrada.

Task 9: complete (commit f65ffea, tests: `node --test server/test/schema-parity.test.js` → 7/7; suíte 102/102)
  - 17 colunas + 1 tabela faltando no `schema.sql`. Sem `users.totp_enabled`, o
    login nunca pede o segundo fator — sem erro nenhum.
  - Bug extra só visível no teste de aceitação: `cpf/rg/cns` eram VARCHAR(14/15)
    no schema, mas o app guarda `enc:v1:…` (~70 chars) → **ERROR 1406 no primeiro
    cadastro com CPF**, depois de o usuário ter digitado tudo.
  - Aceitação executada: banco novo só com `schema.sql`, sem migration nenhuma,
    API sobe e responde 200 em health/ready/login/PUT com CPF cifrado/stats/CSV/audit.

Task 10: complete (commit c72764c, tests: `node --test server/test/catalog-slots.test.js` → 5/5; suíte 107/107)
  - **Correção da auditoria original:** eu descrevi o filtro como "cruzo de produto
    sem checar a oferta". O efeito é o mesmo, mas o mecanismo era o filtro
    indireto por `profIds`. O defeito real é a ausência do filtro pelo **par**
    (profissional, unidade) — profissional que atende na unidade A e tem horário
    na B entrava na grade com nome vazio e o POST dava 409.
  - Ruling: converti o par em `EXISTS` sobre `professional_offers` e removi o
    fallback `{ name: '' }`. O último teste exige que `validateBooking` aceite todo
    slot que o catálogo oferece, e falha por vacuidade se não houver vaga.

Task 11: complete (commit ffbfb99, tests: `npm run test:race` → 3/3; suíte 107/107; smoke verde)
  - Corrida reproduzia **deterministicamente**: primeira rodada já dava `201 e 201`.
  - Correção: transação + `SELECT … FOR UPDATE` na linha do profissional. 12
    rodadas → exatamente um 201 e um 409 por horário.
  - Ruling: teste isolado em `server/test/race/` com comando próprio
    (`npm run test:race`), **por decisão do usuário** ("depois isolamos os que não
    funcionaram"). Motivo técnico: precisa de conexões MySQL reais em
    simultaneidade, e o `pool.end()` do mysql2 segura o processo quando há
    transação em voo. `npm test` fica limpo e rápido; `npm run test:all` roda os dois.
  - Ruling: o teste **verifica que o app devolve toda conexão**. Uma conexão
    esquecida segura o lock do `FOR UPDATE` e trava as rodadas seguintes — o
    vazamento apareceria como travamento, não como vazamento. Pegou um `release()`
    faltando que eu mesmo tinha escrito na correção.
  - Ruling: `dateStrings: true` é load-bearing. `parseDateTime()` só aceita
    string; com um Date cru os intervalos ocupados são silenciosamente ignorados
    e o teste acusa um bug inexistente.

## INCIDENTE — banco `saude` de desenvolvimento destruído

Durante o Step 3 da Task 3 eu rodei `DB_NAME=saude_doctest node scripts/db-setup.js --fresh`.
A 1ª versão do script usava `dotenv.parse()`, que lê **só o arquivo** e ignora o ambiente.
Resultado: o `DROP DATABASE IF EXISTS` atingiu **`saude`** (o banco de desenvolvimento), não
`saude_doctest`. As migrations seguintes falharam por connectarem em `saude_doctest`, que nunca
foi criado.

Estado de `saude` agora: só o `schema.sql` (13 tabelas + 10 unidades de seed).
`users`, `appointments`, `professionals` vazios. As migrations NÃO foram aplicadas —
ou seja, o app está com MFA/govbr_sub/refresh_tokens ausentes até rodar `npm run db:setup`.

Causa raiz e correção, ambas com teste de regressão (`server/test/db-setup.test.js`):
- `resolveConfig` — ambiente vence o `.env` (7 testes).
- `parseFreshArg` — `--fresh` exige o nome explícito do banco e o confere contra `DB_NAME`.
- `rewriteSchemaForDb` — `schema.sql:7,9` tinha `saude` hardcoded; as tabelas iam parar no
  schema antigo quando o alvo era outro nome (5 testes).

Backup disponível e íntegro: `server/backups/saude-2026-10-10.sql.gz` (8.4 KB),
SHA-256 `bf2fa7defd9ef24d4ee4e98a20561d735c13f508182be2f90fb53b024ff0baa4` confere com o
manifesto. 6 dias de idade. **Aguardando decisão do usuário sobre restaurar.**

## Rulings de execução

- **Ruling: eu errei ao usar `--replace` do PowerShell para editar `scripts/db-setup.js`.**
  O comando removeu todas as quebras de linha e corrompeu a codificação do arquivo. Reescrito
  com a ferramenta de escrita. Custo: um arquivo reescrito do zero, nenhuma perda de conteúdo.
  Regra: editar arquivo com a ferramenta de edit/write, nunca com PowerShell.
## Fase 6 - MEDIUMs de seguranca (2026-10-18)

Fechados os dois itens que restavam da secao "MEDIUM - endurecimento de seguranca" do
docs/TECHNICAL_DEBT.md. Os tres MEDIUMs de correcao funcional tinham saido antes
(df9f06b booking, 7bd8673 CPF, 8d6be81 auditoria).

### 7cda47d - refresh token nao estende mais a vida da sessao

A divida sugeria "teto de tentativas por familia" com mfaAttempts. **A recomendacao
estava errada.** O access token expira em 15 min, entao um usuario ativo rotaciona
~2.900 vezes em 30 dias: qualquer teto por contagem derrubaria sessoes legítimas.

O defeito real era o **prazo deslizante**: cada rotacao emitia 
ow + 30d, entao a
familia nunca expirava, e o cookie httpOnly repetia maxAge: 30d. Um par roubado
vivia para sempre e o titular legitimo nunca percebia.

Corrigido conforme OAuth 2.0 BCP 4.14.2: a rotacao preserva o prazo absoluto da
familia (MIN(expires_at) da familia = prazo do token original), e o cookie usa o
restante desse prazo. A deteccao de reuso que ja existia continua valendo e agora tem
teto de tempo.

### 47176b8 - falha do GET_LOCK da auditoria vira metrica

/ready passou a expor udit_lock: { ok, falhas, ultimaFalhaEm }. Antes o unico sinal
era um console.warn, invisivel para alerta. AUDIT_LOCK ganhou override por
AUDIT_LOCK_NAME, so para os testes.

### O que estes dois testes custaram

Tres testes novos que provocam condicoes de falha de proposito (banco descartavel e
lock proprio) revelaram um padrao que vale registrar: **todo teste que escreve na
udit_log de desenvolvimento corrompe a cadeia de hash**, e udit-details.test.js
verifica essa cadeia. O projeto ja tinha ids isolados para os testes de corrida; o
mesmo isolamento era necessario aqui.

Ordem de descoberta: udit-orphan (linhas orfas) -> corrige com banco descartavel;
udit-lock-sinal -> falha na suite com "linha 649 nao encadeia na 648" porque
provocava escrita fora de ordem de proposito; e o lock, por ser nomeado no SERVIDOR,
atrapalhava os arquivos que rodam em paralelo. Duas isolacoes, nao uma.

### Estado

290/290 + 7/7 em tres execucoes seguidas, smoke e doctor verdes. Arvore limpa.

### Proximo

LOW / divida de produto, em docs/TECHNICAL_DEBT.md: recuperacao de senha, envio real
dos lembretes, lint/CI e E2E automatizado. Nao ha ordem definida entre eles - cada um e
uma decisao de produto, nao uma correcao.