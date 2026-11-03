# Saúde+: registro de achados do *system design* (etapas 7.3 e 7.5)

| | |
|---|---|
| **Status** | Concluído (7.3 a 7.5). Execução em PLANO_FASE_8_EXECUCAO_POS_SYSTEM_DESIGN.md |
| **Criado em** | 2026-11-01 |
| **Commit de referência** | `2459db0` |
| **Régua** | 4 pilares da POO e SOLID (`PLANO_FASE_7_SYSTEM_DESIGN.md`, seção 2.1) |
| **Regra** | Esta fase só analisa e propõe. **Nenhum item vira mudança de código sem aprovação item a item.** |

## 1. Como cada achado foi obtido

| Análise | Método | Evidência |
|---|---|---|
| Por entidade | Leitura de `server/schema.sql` e busca de `INSERT`/`UPDATE`/`DELETE` em `server/src` e `server/scripts` | `SYSTEM_DESIGN.md`, seção 8 |
| Código sem uso | Grafo (`graphify-out/graph.json`): funções de `server/src` sem aresta de entrada, confirmadas por busca de nome em `src`, `scripts` e `test`; mais exports que nenhum outro arquivo importa | Seção 3 |
| Violações de camada | Mapa de `require` entre pastas (busca), contagem de `pool.query` em rotas | Seção 4 |
| Duplicação | Busca de literais e de `INSERT` repetidos | Seção 5 |

**Limite do grafo, a registrar:** das 20 funções que o grafo mostra sem chamada de entrada, as 15 de `server/src` que ele lista eram usadas dentro do próprio arquivo (por exemplo `buscarDia` e `resumoDia` em `staff.routes.js`). O grafo não registra bem chamadas dentro do mesmo arquivo, então "sem aresta" **não** significa "sem uso". Toda conclusão de remoção abaixo foi conferida por busca de texto.

## 2. Classes de decisão

| Classe | Critério |
|---|---|
| **Remover** | Sem uso em produção, fora da documentação, sem requisito que dependa |
| **Editar** | Existe, mas viola camada, duplica lógica, ou não atende ao requisito |
| **Criar** | Falta componente ou capacidade transversal |
| **Manter** | Atende; fica registrado o porquê para não ser reaberto |

Severidade é **proposta** do analista: alta (dado pessoal, integridade ou segurança), média (consistência, manutenção com risco), baixa (higiene).

## 3. Código sem uso (classe Remover)

| ID | Item | Evidência | Situação | Sev. |
|---|---|---|---|---|
| R-01 | `somarCounts` em `utils/stats.js` | Definida e exportada, 0 chamadas em `src`, `scripts` e `test` | Sem uso nenhum | Baixa |
| R-02 | `FHIR_VERSION` em `services/rnds.js` | Definida e exportada, 0 usos em todo o `server` | Sem uso nenhum | Baixa |
| R-03 | `acharPorCpf` em `utils/cpf.js` | Só `server/test/cpf-match.test.js` a chama; a busca real é `acharContaGovbr` em `services/auth.js` | Só teste; remover com o teste | Baixa |
| R-04 | Exports só para teste: `totpNow`, `mailerStatus`, `resetTransporte`, `isBookingStatus`, `isOccupyingStatus`, `RESCHEDULE_REASONS`, `localDateTimeStr`, `localDateRange`, `resetAuditLockStats` | Nenhum arquivo de produção os importa | **Editar**, não remover: são ganchos de teste legítimos; vale só marcar como tal | Baixa |
| R-05 | Exports sem consumidor externo e sem teste (`nextDayWindow`, `entregarPorEmail`, `EVENT_TYPES`, helpers de `cnes.js`, `infodengue.js`, `rnds.js`, `distDir` etc.) | Usados só dentro do próprio arquivo | **Editar**: reduz a superfície pública (encapsulamento) | Baixa |
| R-06 | Coluna `reminders.read` (**resolvido** em `1192ce4`: criada a rota) | Nenhum código do servidor a lê ou grava; não há rota para marcar como lida | **Decidir**: remover a coluna ou **criar** a rota (depende de o front querer "marcar como lida") | Baixa |
| R-07 | Caminhos de compatibilidade em `utils/audit.js` (`ER_BAD_FIELD_ERROR`, `ER_DATA_TOO_LONG`, `ORDER BY created_at` sem `seq`) | Existem para bancos anteriores às migrations 005 e 005b | Remover quando todo banco estiver na 0006; tem teste de cadeia | Baixa |

Fora desta lista, mas já conhecidos: `server/scripts/temp_marked.js` e `.superpowers/` (item A6 do backlog).

## 4. Violações de camada e princípios (classe Editar)

| ID | Achado | Princípio | Evidência | Sev. |
|---|---|---|---|---|
| E-01 | 10 rotas têm SQL direto (82 chamadas a `pool.query`, `conn.query` ou `getConnection`): `admin` 22, `staff` 20, `me.booking` 11, `units` 9, `me.waitlist` 7, `interop` 4, `catalog` 4, `public` 3, `reminders` 1, `diseases` 1 | **S**, **encapsulamento**, **D** | Contagem em `server/src/routes`. As 3 rotas finas (`auth`, `admin.users`, `admin.professionals`) têm 0 | Alta |
| E-02 | 7 serviços importam `pool` direto (`auth`, `mfa`, `passwordReset`, `profile`, `session`, `adminUsers`, `adminProfessionals`). Os repositórios, ao contrário, recebem `db` por parâmetro | **D**, **L** | `require('../db')` em `services/*.js` | Média |
| E-03 | `utils/booking.js` é util que reexporta serviços (`bookingRules`, `bookingChange`); `services/waitlist` o importa, então serviço depende de util que depende de serviço | **D**, **I** | `utils/booking.js:16-17`, `services/waitlist.js:9` | Baixa |
| E-04 | `process.env` lido em ~15 módulos, sem ponto único de configuração nem validação centralizada | **Encapsulamento**, **D** | Busca de `process.env` em `server/src` | Média |
| E-05 | Estado em memória espalhado: `loginAttempts` (`services/auth`), tentativas de MFA (`utils/mfaAttempts`), limitadores de requisição (`middleware/rateLimit`) | **Encapsulamento**; risco com mais de uma réplica | `services/auth.js`, `utils/mfaAttempts.js`, `middleware/rateLimit.js` | Média |

## 5. Duplicação (classe Editar)

| ID | Achado | Princípio | Evidência | Sev. |
|---|---|---|---|---|
| E-06 | O `INSERT` de agendamento está montado à mão em **3 lugares**: paciente, recepção e fila. Adicionar uma coluna exige 3 edições | **Abstração**, **O** | `routes/me.booking.routes.js:132`, `routes/staff.routes.js:276`, `services/waitlist.js:125` | Alta |
| E-07 | A regra de prioridade legal (`idoso`, `gestante`, `pcd`, `lactante`) existe em 4 lugares com texto copiado: a origem (`PRIORITY_GROUPS`) e três cópias | **Abstração**, **O** | `utils/booking-priority.js:12`; cópias em `routes/admin.routes.js:299`, `routes/staff.routes.js:74` e `:383` | Média |
| E-08 | Rota do paciente (`me.booking`) e rota de staff (`applyBookingChange`) implementam remarcação e cancelamento por caminhos diferentes: o do staff registra evento e auditoria, o do paciente não | **Abstração**, **polimorfismo** (mesmo contrato, comportamento divergente) | `routes/me.booking.routes.js:149-304` × `services/bookingChange.js` | Alta |
| E-09 | `appointments` e `exams` são tratados por fábrica (`createBookingRouter(tipo)`), mas `staff.routes.js` repete listagens separadas para os dois | **Herança por composição** | `staff.routes.js` `GET /appointments` e `GET /exams` (linhas 307 e 340) | Média |

## 6. Achados de entidade, dados e LGPD (classes Editar e Criar)

Vêm da seção 8 do `SYSTEM_DESIGN.md`. Aqui só a classificação.

| ID | Classe | Achado | Princípio | Evidência | Sev. |
|---|---|---|---|---|---|
| E-10 | Editar (**resolvido** em `cf4c26b`) | `anonymizeUser` não zera `govbr_sub`, `consent_ip`, `totp_secret` e `totp_enabled`. O `govbr_sub` e o IP continuam identificando a pessoa | **Encapsulamento** da regra de eliminação | `utils/privacy.js:46-56` | Alta |
| E-11 | Editar (**resolvido** em `cf4c26b`) | Há dois "apagar" com efeitos diferentes: o do admin só preenche `deleted_at` e mantém todos os dados pessoais | **Abstração** (um conceito, duas implementações) | `repositories/usuarios.js:114`; `utils/privacy.js` | Alta |
| E-12 | Editar | O paciente cria, cancela e reagenda sem linha no `audit_log`, e criar e cancelar também não geram `booking_events` | **S** (a rota decide e executa) | `routes/me.booking.routes.js` (sem `audit`; evento só na linha 276) | Alta |
| E-13 | Editar | `appointments.location` vem do corpo da requisição do paciente e não é conferido contra `unit_id` | **Encapsulamento** (dado derivado tratado como entrada) | `routes/me.booking.routes.js:64` e `:116` | Média |
| E-14 | Editar | `audit_log.actor_id` e `entity_id` são `NOT NULL`: auditoria sem ator ou sem id falha no `INSERT`, e a ação fica sem registro (só `console.error`) | **Abstração** | `utils/audit.js:96-192`, `schema.sql:473-476` | Média |
| E-15 | Editar (**resolvido** em `07a87d8`) | `details` da auditoria leva dado pessoal (nome do paciente em `staff_create`); a trilha é imutável e a anonimização a preserva | **Encapsulamento** | `routes/staff.routes.js:291` | Alta |
| E-16 | Editar | Textos sem teto em `diseases`, `health_units`, `professionals` (nome, cargo, registro): erro de tamanho tende a virar 500 | Validação | `routes/admin.routes.js:260`, `routes/units.routes.js:36`, `schemas/adminProfessionals.js:44` | Média |
| E-17 | Editar | Desativar unidade só muda `active`; atendimentos futuros e fila ficam como estão (a desativação de profissional trata os dois) | **Polimorfismo** (regra análoga com comportamento diferente) | `routes/units.routes.js:55-85` × `services/adminProfessionals.js:83` | Média |
| E-18 | Editar | Fila de espera: duplicidade checada com `SELECT` antes do `INSERT`, sem `UNIQUE`; duas requisições simultâneas criam duas entradas | Consistência | `routes/me.waitlist.routes.js:54-70` | Baixa |
| E-19 | Editar | `PATCH /me/.../cancel` do paciente não usa transação (`UPDATE` e liberação de vaga separados, erro engolido no log) | **S**, consistência | `routes/me.booking.routes.js:149-176` | Baixa |
| E-20 | Editar | `booking_events` é append-only só por convenção (sem trigger) e `booking_id` não tem FK; `waitlist.record_id` também não | Integridade | `schema.sql:325`, `:355` | Baixa |
| E-21 | Editar | Front guarda JWT e refresh em `localStorage`, e o servidor devolve o refresh também no corpo | Segurança | `web/src/lib/session.ts:26-52`, `routes/auth.routes.js:47` | Alta |
| E-22 | Editar | `GET /auth/me` devolve CPF, RG e CNS sem máscara | **Encapsulamento** | `services/profile.js:26` | Média |
| C-01 | Criar | Agendador para `purge-retention` e limpeza de `password_reset_tokens` (hoje manuais; a segunda nunca roda) | Operação | `scripts/purge-retention.js:44-49` | Média |
| C-02 | Criar | Ponto único de configuração (resolve E-04) | **D**, **encapsulamento** | — | Média |
| C-03 | Criar | Teste que prove o comportamento com texto acima do `VARCHAR` (resolve a incerteza de E-16) | Testabilidade | — | Baixa |

## 7. O que está certo e fica (classe Manter)

| ID | Item | Por que fica | Princípio |
|---|---|---|---|
| M-01 | Repositórios recebem `db` por parâmetro (pool ou conexão da transação) | Permite validar e gravar sob o mesmo lock; é o que torna a agenda testável sem HTTP | **L**, **D** |
| M-02 | Mapa de capacidades com falha fechada (`middleware/capabilities.js`) e espelho no front com teste | Adicionar nível ou capacidade é uma linha; nível desconhecido é negado | **O** |
| M-03 | `createBookingRouter(tipo)` e `TIPOS` | Consulta e exame compartilham uma implementação, sem `if` por toda parte | **Herança por composição**, **polimorfismo** |
| M-04 | Três defesas contra horário duplo (travas ordenadas, validação na transação, `UNIQUE (professional_id, active_slot)`) | A falha de uma camada não duplica o horário | Consistência |
| M-05 | Cadeia de hash do `audit_log` com triggers e `GET_LOCK` | Imutável até para quem acessa o MySQL; verificável | Segurança |
| M-06 | Serviços recebem `{encrypt, decrypt}` e não `req` (`services/profile`, `adminUsers`) | O serviço não conhece a chave nem o HTTP | **I**, **encapsulamento** |
| M-07 | Schemas puros em `schemas/` e regras puras em `utils/booking-*` | Testáveis sem banco; a equivalência do gerador de horários foi provada em 20 mil casos | **S**, **abstração** |

## 8. Comunidades e nós centrais do grafo (7.3)

**Comunidades de `server/src`.** O grafo agrupa o código quase exatamente nos módulos pretendidos:

| Comunidade do grafo | Arquivos | Leitura |
|---|---|---|
| Agendamento: núcleo e regras (7) | `bookingRules`, `booking-time`, `booking-priority`, `booking-slots` | Coesa, como a A1 desenhou |
| Repositórios (27, 45) | `profissionais`, `agenda` | Coesa |
| Serviço e schema de usuários do admin (23), de profissionais (30), de auth (28, 37), de MFA (54) | um serviço com seu schema | Coesa: cada serviço refatorado vira uma comunidade |
| Auditoria (26) | `utils/audit`, `middleware/audit` | Coesa |
| Reserva do paciente (56) | `me.booking.routes`, `booking-events`, `appointments.routes`, `exams.routes` | Coesa, mas é rota com SQL (E-01) |
| Staff (29) | só `staff.routes.js` (24 nós) | Isolada: não se mistura com admin nem com booking no grafo |
| Unidades e autorização (57) | `units.routes`, `middleware/auth`, `capabilities` | Acoplamento por uso, não mistura de domínio |

**A hipótese do plano não se confirmou para `server/src`:** o grafo não mostra `staff`, `admin` e `booking` misturados. O problema deles não é mistura entre domínios, e sim **tamanho e SQL dentro da rota** (E-01), o que o grafo não mede. A baixa coesão (0,06 a 0,25) está no front (`web/src/features/*`), a olhar na 7.4 (evolução).

**Nós mais chamados em `server/src` (hubs):**

| Nó | Entradas | Leitura |
|---|---|---|
| `db.js` (pool) | 34 (19 módulos de `src`, mais testes e scripts) | Dependência concreta importada por todos: evidência de E-02 |
| `utils/booking.js` (fachada) | 14 | Hub de uma fachada que reexporta tudo: interface larga (**I**), E-03 |
| `utils/validators.js` | 10 (`digitsOnly` sozinho, 9) | Utilitário genuinamente compartilhado |
| `utils/booking-time.js` | 8 (`parseDateTime`) | Núcleo puro compartilhado, como deve ser |
| `utils/audit.js` | 8 | Esperado |
| `services/session.js`, `utils/cpf.js`, `utils/totp.js` | 8 a 9 | Esperado |

**Ajuste ao registro:** E-02 passa a citar 19 módulos de `src` importando `db.js`, não só os 7 serviços (as rotas e os jobs também). Achado novo:

| ID | Achado | Princípio | Evidência | Sev. |
|---|---|---|---|---|
| E-23 | O helper de resultado `falha(status, erro)` (e `recusa`) está **copiado em 9 arquivos** com pequenas variações (`status` presente ou não, `body`, `extra`) | **Abstração**, **I** | `services/auth.js:23`, `adminUsers.js:27`, `adminProfessionals.js:22`, `profile.js:18`, `mfa.js:18`, `bookingChange.js:36` (como `recusa`), `schemas/profile.js:66`, `schemas/adminProfessionals.js:15`, `utils/adminHierarchy.js:42` | Baixa |

## 9. Caminhos do requisito até o código (7.3)

| Requisito | Componente que garante | Teste que prova | Lacuna |
|---|---|---|---|
| Sem dupla marcação | `repositories/agenda.travarEnvolvidos`, `services/bookingRules.validateBooking`, `UNIQUE (professional_id, active_slot)`, `utils/dbErrors` (409) | `race/booking-race`, `horario-unico`, `user-overlap`, `booking-duration` | Atendimento **sem profissional** tem `professional_id` nulo e escapa do `UNIQUE`; `applyBookingChange` só revalida quando há profissional e unidade. A confirmar se isso é aceito (legado) ou falha (7.4) |
| Prioridade legal na fila e na agenda | `utils/booking-priority`, `services/waitlist.tentarPreencher` | `priority-booking`, `priority-quota`, `waitlist` | Regra copiada em 3 lugares (E-07) |
| Fila de espera | `services/waitlist`, `routes/me.waitlist.routes` | `waitlist` | Duplicidade não atômica (E-18) |
| Desativar profissional sem perder paciente | `services/adminProfessionals.atualizarProfissional` (transação, evento, aviso) | `professional-deactivation`, `admin-professionals-service` | Unidade não tem o mesmo tratamento (E-17) |
| Sessão segura e MFA | `services/session`, `services/mfa`, `utils/totp`, `mfaAttempts`, `loginThrottle` | `session-service`, `refresh-prazo`, `mfa-service`, `mfa-replay*`, `login-throttle`, `race/mfa-replay-race` | Tokens em `localStorage` (E-21); contadores em memória (E-05) |
| RBAC e hierarquia de admins | `middleware/capabilities`, `utils/adminHierarchy`, `services/adminUsers` | `capabilities`, `admin-hierarchy`, `admin-user-safety`, `admin-users-service` | Escopo do atendente ausente em `/staff/agenda/reports` e `/staff/booking-events` (já pendente no 3B) |
| Trilha de auditoria íntegra | `utils/audit`, `middleware/audit`, triggers do `audit_log` | `audit-chain-gaps`, `audit-orphan`, `audit-lock-sinal`, `audit-details`, `race/audit-chain-race` | Paciente não audita (E-12); falha silenciosa sem ator (E-14); PII no `details` (E-15) |
| LGPD: eliminação | `utils/privacy.anonymizeUser`, `services/profile.excluirConta` | `lgpd-anonymization`, `lgpd-delete-http` | Campos que sobram (E-10); dois "apagar" (E-11) |
| LGPD: portabilidade e acesso | `services/profile.exportarDados`, `obterPerfil` | `profile-service`, `profile-update` | Exportação não é auditada; `GET /auth/me` sem máscara (E-22) |
| LGPD: retenção | `scripts/purge-retention` | **nenhum teste encontrado** | Manual e incompleto (C-01) |
| Lembretes | `jobs/reminders`, `utils/jobLock`, `services/mailer` | `reminders`, `reminder-delivery`, `job-lock`, `mailer` | Ciclo de 24 h contado da subida; coluna `read` sem uso (R-06) |
| Interoperabilidade (RNDS, CNES, InfoDengue, CNS) | `services/rnds`, `cnes`, `infodengue`, `cns`, `routes/interop.routes` | **Nenhum arquivo em `server/test`**; só scripts manuais (`test-rnds.js`, `test-cns.js`, `sync-*.js`) | Sem teste automatizado: a camada "pronta, sem credenciamento" não tem rede de segurança |
| Operação: prontidão, migrations, backup | `/health`, `/ready`, `scripts/migrate`, `scripts/backup` | `readiness-rate-limit`, `migrate-runner`, `boot-schema-guard`, `db-setup` | Restauração do backup sem teste automático |
| Cobertura ponta a ponta | Playwright (`e2e/`: `login`, `patient`, `staff`, `admin`) | 28 casos | Nenhum caso de remarcação, fila ou desativação de profissional (a conferir na 7.4) |

**Resposta à pergunta da 7.3:** a estrutura atual atende aos requisitos críticos de consistência, sessão, RBAC e auditoria, com prova por teste. Os requisitos **sem prova automática** são três: retenção LGPD, interoperabilidade e restauração de backup. As falhas de requisito (não só de estilo) estão em E-10, E-11, E-12, E-15 e E-21.

## 10. Matriz de atributos de qualidade (7.4)

Nota: **Atende**, **Parcial**, **Não atende**, **Não medido** (sem evidência para afirmar). Cada linha aponta o achado.

| Atributo | Aspecto | Nota | Evidência | Achado |
|---|---|---|---|---|
| **Consistência e concorrência** | Escrita de agenda passa pelas travas e validação | Atende | Todo caminho que grava atendimento (paciente, recepção, fila, `applyBookingChange`) chama `lockBookingActors` e `validateBooking` | M-04 |
| | Atendimento sem profissional | Parcial | `UNIQUE` não vale com `professional_id` nulo; revalidação exige profissional e unidade | Seção 9 |
| | Cancelamento do paciente e fila de espera | Parcial | Sem transação (E-19); duplicidade sem `UNIQUE` (E-18) | E-18, E-19 |
| **Segurança e privacidade** | RBAC e hierarquia | Atende | `capabilities` falha fechada, `adminHierarchy`, testes | M-02 |
| | Escopo do atendente | Parcial | Falta em `/staff/agenda/reports` e `/staff/booking-events` | 3B |
| | Segredos em repouso | Atende | CPF, RG, CNS e `totp_secret` cifrados; senha em bcrypt; tokens só como hash | — |
| | Dados pessoais fora dos 4 campos cifrados | Parcial | Nome, endereço, raça, filiação e `notes` em texto | Seção 8 do `SYSTEM_DESIGN.md` |
| | Sessão no navegador | Não atende | JWT e refresh em `localStorage` (E-21) | E-21 |
| | Segundo fator | Parcial | Opcional para todos; nada o exige de atendente ou admin | **E-24** |
| | Auditoria completa | Parcial | Paciente, login por senha, cadastro e exportação não geram linha (E-12, E-26) | E-12, E-26 |
| | Eliminação LGPD | Parcial | Campos que sobram (E-10), dois "apagar" (E-11), PII em `details` (E-15) | E-10, E-11, E-15 |
| **Interfaces e contratos** | Formato de erro | Atende | `{ error }` em todas as rotas, `code` nas integrações; tratamento central em `app.js` | — |
| | Validação por esquema | Parcial | Esquemas puros só em `auth`, `profile`, `adminUsers`, `adminProfessionals`; o resto inline | E-01 |
| | Contrato documentado | Não atende | Nenhuma ocorrência de OpenAPI ou swagger; tipos do front escritos à mão | **C-05** |
| | Versionamento | Parcial | Rota única `/api` sem versão; a raiz (`/auth`, `/admin`…) ainda responde sem `SERVE_WEB`; listagens com envelope de paginação só "com query" e array legado sem ela | **E-29** |
| **Desempenho e escala** | Índices | Atende | `appointments` e `exams` têm 6 índices cada, cobrindo usuário, profissional, unidade, status e horário | B6 (2 redundantes) |
| | Agregações | Não medido | Relatórios da recepção leem as linhas e contam em JavaScript (`staff.routes.js:493-510`) em vez de `GROUP BY`; o custo depende do intervalo | **E-28** |
| | Paginação | Parcial | `staff` e `admin` paginam sob demanda; `GET /me/appointments`, `/me/exams` e `/diseases` devolvem tudo | E-28 |
| | Busca textual | Não medido | `LIKE '%q%'` em pacientes e em `admin/users`, sem índice que ajude (limite de 20 só na recepção) | E-28 |
| **Disponibilidade e operação** | Prontidão e partida | Atende | `/health`, `/ready`, recusa de subir sem chaves, `JWT_SECRET` curto ou coluna ausente | — |
| | Réplicas | Parcial | Job com `GET_LOCK` ok; limitadores e contadores de login em memória por processo (E-05) | E-05 |
| | Backup e restauração | Parcial | `backup.js` existe e gera SHA-256; sem agendamento no código, sem teste de restauração (o `TRILHA_AUDITORIA` prevê restore mensal) | C-01, C-06 |
| | Configuração | Parcial | `process.env` em ~15 módulos, sem validação central (E-04) | E-04, C-02 |
| **Observabilidade (A5)** | Request id, log estruturado, métricas | Não atende | Nenhuma ocorrência de `requestId`, `pino`, `winston`, `morgan` ou `prom-client`; 35 `console.*` em 15 arquivos; erro 500 vai a `console.error(err)` sem rota nem usuário | **C-04** |
| **Testabilidade** | Regra testável sem HTTP | Atende | `booking-*`, `adminHierarchy`, `schemas/*` e serviços refatorados têm teste direto | M-07 |
| | Cobertura dos fluxos críticos | Parcial | 75 arquivos em `server/test` mais 3 de corrida; sem teste para interop, retenção e restauração; e2e com 28 casos em 4 fluxos | C-06 |
| | Rotas gordas | Parcial | `staff` e `admin` só se testam por HTTP com banco | E-01 |
| **Evolução** | Nova capacidade ou nível | Atende | Uma linha em `LEVEL_PERMISSIONS` (mais o espelho do front, protegido por teste) | M-02 |
| | Novo tipo de atendimento | Parcial | `TIPOS` ajuda, mas o `INSERT` está em 3 lugares (E-06) e a prioridade em 4 (E-07) | E-06, E-07 |
| | Nova unidade | Atende | É dado (`health_units` e ofertas), sem código | — |
| | Front por papel | Não medido | Coesão baixa nas pastas de feature no grafo (0,06 a 0,25); a olhar com leitura do código | — |

### Achados novos da 7.4

| ID | Classe | Achado | Princípio | Evidência | Sev. |
|---|---|---|---|---|---|
| E-24 | Editar | O segundo fator é opcional para todos: nenhum middleware o exige de `atendente` ou `admin`, embora o ROPA (§4) o descreva "(staff/admin)" e o RIPD o use como mitigação do roubo de sessão | **Abstração** (regra de negócio ausente do código) | `services/mfa.js` (`setup`/`enable` livres), `middleware/auth.js` (não consulta `totp_enabled`) | Alta |
| E-26 | Editar (**resolvido** em `843149e`) | O login por senha não grava auditoria; por isso o kit do auditor ("MFA vs sem MFA") não consegue contar os logins **sem** MFA | **Abstração** | `routes/auth.routes.js:40-51` × `docs/governanca/TRILHA_AUDITORIA.md` §3 | Média |
| E-28 | Editar | Relatórios agregam em JavaScript sobre todas as linhas do intervalo; listagens do paciente e de doenças sem paginação | Desempenho | `routes/staff.routes.js:493-510`, `routes/me.booking.routes.js:47`, `routes/diseases.routes.js` | Média |
| E-29 | Editar | Contrato de listagem duplo (array legado sem query, envelope com query) e rota legada na raiz | **I**, versionamento | `routes/staff.routes.js:20-29`, `app.js:123-124` | Baixa |
| C-04 | Criar | Observabilidade mínima: request id, log estruturado com rota, status e usuário, e erro 500 com contexto (item A5) | Operação | — | Alta |
| C-05 | Criar | Contrato da API (OpenAPI gerado ou mantido) para o front e para a interoperabilidade | **I** | — | Média |
| C-06 | Criar | Testes para retenção (`purge-retention`), restauração de backup e a camada de interoperabilidade | Testabilidade | — | Média |

## 11. Conferência contra ROPA, RIPD e manual de auditoria (7.4)

Documentos lidos inteiros: `ROPA.md`, `RIPD.md`, `TRILHA_AUDITORIA.md`.

| Item | O documento diz | O código faz | Situação |
|---|---|---|---|
| ROPA T1 e T2: quem acessa | Atendente sem CPF/RG; documentos só para admin, com auditoria | Rotas de staff e listas não selecionam documentos; o detalhe do admin os decifra e é auditado (`admin_view_user_docs`) | **Confere**; falta citar que o titular os lê em `GET /auth/me` e que `POST /interop/rnds/send` os decifra (auditado) |
| ROPA T2: `cpf_hmac` zerado na anonimização | Sim | `privacy.js:49` zera | **Confere** |
| ROPA T2: segredo do MFA cifrado | Sim | Migration 0006 | **Confere** |
| ROPA T8: consentimento visível ao admin | `privacy_version`, `consent_at`, `consent_ip` acessados pelo admin | Gravados no cadastro; **nenhuma rota do admin os lê**; só a exportação do titular os inclui | **Diverge** (E-25) |
| ROPA §3: `password_reset_tokens` apagados 24 h depois | DELETE físico no expurgo | `purge-retention.js` só apaga `refresh_tokens` | **Diverge** (C-01) |
| ROPA §3 e RIPD: expurgo "automático" de 5 anos | Anonimização automática | Script manual (`--apply`), sem agendador | **Diverge** (C-01) |
| ROPA §3: consultas passadas "anonimizadas" | Mantidas anonimizadas | O vínculo some, mas `notes` e `doctor` ficam no registro | **Parcial** (seção 8 do `SYSTEM_DESIGN.md`) |
| ROPA §3: backups com "restore testado" | Restore testado | Sem teste automático; não há evidência no repositório | **Sem evidência** (C-06) |
| ROPA §4: MFA "(staff/admin)" | Aplicado a staff e admin | Opcional para todos | **Diverge** (E-24) |
| ROPA §4: "14 tabelas" | 14 | 16 (`waitlist` e `booking_events` não contadas) | **Desatualizado** |
| ROPA §1: inventário completo | T1 a T9 | **Faltam** `waitlist` (serviço que o titular espera), `booking_events` (motivo e ator), `professionals` (nome e registro profissional são dado pessoal), `health_units` (sem titular) | **Incompleto** (E-27) |
| ROPA "Compartilha com" | RNDS, CNS | Também **SMTP** (nome e dados do atendimento em lembretes e avisos) e **ViaCEP** (o navegador envia o CEP) | **Incompleto** (E-27) |
| ROPA T1: dado sensível | "perfil saúde" | `race` (origem racial) é dado sensível pela LGPD, art. 5º, II, e `priority` revela condição de saúde | **A explicitar** (E-27) |
| ROPA/RIPD: eliminação | Tudo que identifica o titular é removido | `govbr_sub`, `consent_ip`, `totp_secret` permanecem (E-10) | **Diverge** |
| RIPD: acesso indevido por staff | Documentos ocultos e visualização auditada | Confere, e o histórico do paciente por staff também é auditado (`staff_view_history`) | **Confere** |
| RIPD: roubo de sessão, risco residual "Baixo" | Medidas: 15 min, refresh rotativo, logout revogatório, MFA | Os dois tokens ficam em `localStorage`, e o MFA é opcional | **Residual subestimado** (E-21, E-24) |
| RIPD: força bruta | Bloqueio 5 tentativas em 5 min | `loginThrottle`: `MAX_TENTATIVAS = 5`, `JANELA_MS = 5 min`, em memória | **Confere** (por processo, E-05) |
| RIPD: perda de trilha | Append-only, hash encadeado, verificação | Triggers e `verifyChain` | **Confere** (ressalva: PII em `details`, E-15) |
| TRILHA §3: ações citadas | `admin_view_user_docs`, `admin_update_user`, `mfa_login`, `govbr_login` | Todas existem no código | **Confere** |
| TRILHA §3: "logins sem MFA" | Contar logins sem MFA | Login por senha não gera linha | **Não mensurável** (E-26) |
| TRILHA §5: restore mensal | Backup restore-teste | Sem ferramenta no repositório | **Sem evidência** (C-06) |

| ID | Classe | Achado | Evidência | Sev. |
|---|---|---|---|---|
| E-25 | Editar | Não há como o admin ver o consentimento (T8): ou se cria a consulta, ou o ROPA deixa de dizer que o admin acessa | `repositories/usuarios.js:46-62` (`detalhe` não seleciona as colunas) | Baixa |
| E-27 | Editar (documentos) | Atualizar o ROPA e o RIPD: tabelas faltantes, SMTP e ViaCEP, `race` e `priority` como dado sensível, campos que a eliminação não zera, número de tabelas, MFA, risco residual da sessão | Linhas da tabela acima | Média |

## 12. Decisões do responsável (7.5, 2026-11-01)

| Achado | Decisão | ADR |
|---|---|---|
| E-10, E-11 | Admin anonimiza; um só caminho de eliminação; `anonymizeUser` zera `govbr_sub`, `consent_ip`, `totp_secret`, `totp_enabled` | 0009 |
| E-24 | MFA obrigatório para atendente e admin, bloqueando até configurar | 0010 |
| E-21 | Refresh só em cookie HttpOnly; access token só em memória | 0011 |
| E-15, R-06 | `details` da auditoria sem dado pessoal; criar "marcar como lido" | 0012 |

Os demais achados seguem as recomendações do plano de execução e dependem de aprovação item a item. Decisões ainda abertas: Gov.br como segundo fator e recuperação do MFA (ADR-0010), desativação de unidade (E-17), atendimento sem profissional (seção 9) e estado em memória (E-05).

## 13. Próximos passos

A execução está em `docs/planos/PLANO_FASE_8_EXECUCAO_POS_SYSTEM_DESIGN.md`, em cinco ondas: LGPD e segurança, agenda sem duplicação, estrutura (o antigo 3B), operação, higiene e documentos.