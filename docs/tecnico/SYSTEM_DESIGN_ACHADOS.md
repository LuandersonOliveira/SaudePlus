# Saúde+: registro de achados do *system design* (etapas 7.3 e 7.5)

| | |
|---|---|
| **Status** | Rascunho, em construção (7.3 parcial; 7.4 ainda não feita) |
| **Criado em** | 2026-11-01 |
| **Commit de referência** | `6428928` |
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
| R-06 | Coluna `reminders.read` | Nenhum código do servidor a lê ou grava; não há rota para marcar como lida | **Decidir**: remover a coluna ou **criar** a rota (depende de o front querer "marcar como lida") | Baixa |
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
| E-10 | Editar | `anonymizeUser` não zera `govbr_sub`, `consent_ip`, `totp_secret` e `totp_enabled`. O `govbr_sub` e o IP continuam identificando a pessoa | **Encapsulamento** da regra de eliminação | `utils/privacy.js:46-56` | Alta |
| E-11 | Editar | Há dois "apagar" com efeitos diferentes: o do admin só preenche `deleted_at` e mantém todos os dados pessoais | **Abstração** (um conceito, duas implementações) | `repositories/usuarios.js:114`; `utils/privacy.js` | Alta |
| E-12 | Editar | O paciente cria, cancela e reagenda sem linha no `audit_log`, e criar e cancelar também não geram `booking_events` | **S** (a rota decide e executa) | `routes/me.booking.routes.js` (sem `audit`; evento só na linha 276) | Alta |
| E-13 | Editar | `appointments.location` vem do corpo da requisição do paciente e não é conferido contra `unit_id` | **Encapsulamento** (dado derivado tratado como entrada) | `routes/me.booking.routes.js:64` e `:116` | Média |
| E-14 | Editar | `audit_log.actor_id` e `entity_id` são `NOT NULL`: auditoria sem ator ou sem id falha no `INSERT`, e a ação fica sem registro (só `console.error`) | **Abstração** | `utils/audit.js:96-192`, `schema.sql:473-476` | Média |
| E-15 | Editar | `details` da auditoria leva dado pessoal (nome do paciente em `staff_create`); a trilha é imutável e a anonimização a preserva | **Encapsulamento** | `routes/staff.routes.js:291` | Alta |
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

## 10. Próximos passos da fase

1. **7.3:** concluída (entidades, código sem uso, camadas, duplicações, comunidades, hubs e caminhos requisito → código). Falta apenas a aprovação deste registro.
2. **7.4:** matriz de atributos de qualidade (consistência, segurança, contratos, desempenho, operação, observabilidade, testabilidade, evolução), incluindo a conferência contra `ROPA.md` e `RIPD.md`.
3. **7.5:** fechar este registro, escrever os ADRs das decisões estruturais e entregar o plano de execução revisado para aprovação item a item.
