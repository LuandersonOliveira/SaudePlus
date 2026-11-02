# Fase 8: execução do que a análise de *system design* decidiu

| | |
|---|---|
| **Status** | Proposta para aprovação item a item (nenhum item iniciado) |
| **Criada em** | 2026-11-01 |
| **Origem** | Fase 7 (`SYSTEM_DESIGN.md`, `SYSTEM_DESIGN_ACHADOS.md`) |
| **Substitui** | A ordem antiga dos itens pendentes da Fase 6: 3B (`staff.routes.js`), `admin.routes.js`, A5, B4 e demais pequenos |
| **Régua** | 4 pilares da POO e SOLID (`PLANO_FASE_7_SYSTEM_DESIGN.md`, seção 2.1) |
| **Regra** | Cada item só começa com o "ok" do responsável. Todo item termina com testes verdes (servidor em banco descartável, web, e2e) e commit próprio |

Esforço: **P** (pequeno, um arquivo ou uma regra), **M** (médio, vários arquivos com testes), **G** (grande, cruza servidor, front e e2e). É estimativa de tamanho, não de prazo.

## Decisões já tomadas (2026-11-01)

| Tema | Decisão | ADR |
|---|---|---|
| Excluir conta | Admin anonimiza; um só caminho de eliminação; `anonymizeUser` zera também `govbr_sub`, `consent_ip`, `totp_secret`, `totp_enabled` | 0009 |
| MFA | Obrigatório para atendente e admin: bloqueia até configurar | 0010 |
| Tokens | Refresh só em cookie HttpOnly; access token só em memória | 0011 |
| Auditoria e lembrete | `details` sem dado pessoal; criar "marcar como lido" | 0012 |

## Onda 1: LGPD e segurança

Prioridade máxima: são falhas de requisito, não de estilo.

| # | Item | Achado | Esforço | Depende de | Prova |
|---|---|---|---|---|---|
| 1.1 | `anonymizeUser` completo e `DELETE /admin/users/:id` anonimiza; script único para anonimizar contas já "excluídas" pelo admin | E-10, E-11 | M | — | `lgpd-anonymization`, `admin-user-update`, teste novo do script |
| 1.2 | `details` da auditoria sem dado pessoal e verificação em `sanitizeDetails` | E-15 | P | — | `audit-details` ampliado com varredura das ações |
| 1.3 | `PATCH /me/reminders/:id/read` e uso no front | R-06 | P | — | teste de rota e do front |
| 1.4 | Auditar login por senha, cadastro, exportação e edição de perfil (sem dado pessoal, ator informado pela rota) | E-26 | M | 1.2 | testes de rota; o kit do auditor passa a contar logins sem MFA |
| 1.5 | Refresh só em cookie HttpOnly; access em memória; `POST /auth/refresh` ao abrir a página; checagem de `Origin` | E-21 | G | — | `session-service`, `api.test.ts`, `AuthPage.test.tsx`, e2e |
| 1.6 | MFA obrigatório para atendente e admin (middleware `exigirMfaConfigurado`, sessão restrita, tela de configuração) | E-24 | G | 1.5 (os dois mudam `global-setup` do e2e) | testes de rota, e2e com TOTP |
| 1.7 | ROPA e RIPD atualizados com o que as ondas 1 a 2 mudaram | E-27 | P | 1.1 a 1.6 | revisão documental |

Ordem: 1.1, 1.2, 1.3 (independentes e pequenos), 1.4, depois 1.5 e 1.6.

**Perguntas abertas da 1.6 (precisam de resposta antes de começar):** o login pelo Gov.br conta como segundo fator? Quem restaura o acesso de um admin que perdeu o aparelho?

## Onda 2: agenda sem duplicação

| # | Item | Achado | Esforço | Depende de | Prova |
|---|---|---|---|---|---|
| 2.1 | Escrita única: `repositories/atendimentos.inserir` e um serviço `criarAtendimento` usado por paciente, recepção e fila | E-06 | M | — | `race/booking-race`, `horario-unico`, `staff-booking-create`, `waitlist`, `booking-duration` |
| 2.2 | Paciente cancela e remarca pelo mesmo caminho de staff e admin (`applyBookingChange`), com evento e auditoria, e cancelamento transacional | E-08, E-12, E-19 | G | 2.1 | `patient-reschedule`, `booking-change`, novos casos de auditoria e evento |
| 2.3 | `location` derivada da unidade, não do corpo da requisição | E-13 | P | 2.1 | teste novo; ajuste de contrato no front |
| 2.4 | Regra de prioridade em um só lugar (função que gera a ordenação em SQL e a regra em JavaScript) | E-07 | P | — | `priority-booking`, `priority-quota`, `agenda-queue` |
| 2.5 | Migration 0007: `UNIQUE` para entrada ativa da fila; `booking_events` com trigger append-only | E-18, E-20 | M | — | `waitlist`, `migrate-runner`, teste de trigger |
| 2.6 | Desativar unidade trata atendimentos futuros e fila como a desativação de profissional | E-17 | M | decisão | `professional-deactivation` como modelo |
| 2.7 | Atendimento sem profissional: aceitar como legado ou fechar o furo | seção 9 | P a M | decisão | teste de corrida sem profissional |

**Decisões abertas:** 2.6 (o que acontece com os atendimentos de uma unidade desativada) e 2.7.

## Onda 3: estrutura (o antigo 3B e `admin.routes.js`)

Só começa depois da 2.1 e 2.2, porque a criação e a mudança de atendimento passam a viver em serviço, e o corte de `staff.routes.js` muda.

| # | Item | Achado | Esforço | Depende de | Prova |
|---|---|---|---|---|---|
| 3.1 | `staff.routes.js` (590 linhas) em núcleo puro, repositório e serviço, rota fina; listagens de consulta e exame unificadas; corrige `getLinkedProfessionalId` fora do `try` | E-01, E-09 | G | 2.1, 2.2 | `agenda-*`, `staff-booking-create`, e2e de staff |
| 3.2 | Escopo do atendente em `/staff/agenda/reports` e `/staff/booking-events`; ocupação correta com filtro | decisões do 3B | M | 3.1 | testes novos de escopo |
| 3.3 | Relatórios com `GROUP BY` no banco em vez de contar em JavaScript | E-28 | M | 3.1 | `agenda-reports` |
| 3.4 | `admin.routes.js` (427 linhas), `units.routes.js`, `catalog.routes.js`, `me.waitlist.routes.js`, `interop.routes.js` com a mesma separação | E-01 | G | 3.1 | testes existentes de cada rota |
| 3.5 | Utilitário único de resultado (`falha`) no lugar das 9 cópias | E-23 | P | 3.1 a 3.4 | testes existentes |
| 3.6 | Serviços recebem `db` por parâmetro (com o pool como padrão) e a fachada `utils/booking.js` deixa de apontar para serviços | E-02, E-03 | M | 3.4 | testes existentes |

## Onda 4: operação

| # | Item | Achado | Esforço | Depende de | Prova |
|---|---|---|---|---|---|
| 4.1 | Observabilidade (item A5): request id, log estruturado com rota, status e usuário, erro 500 com contexto | C-04 | M | — | teste de middleware e de formato |
| 4.2 | Agendador de retenção (`purge-retention`) e limpeza de `password_reset_tokens` | C-01 | M | — | teste de retenção (novo) |
| 4.3 | Testes de retenção, de restauração de backup e da camada de interoperabilidade (com servidor falso) | C-06 | M | 4.2 | os próprios testes |
| 4.4 | Configuração em um só módulo, validada na partida | E-04, C-02 | M | — | `doctor`, `crypto-config` |
| 4.5 | Contadores de login e MFA fora da memória (ou decisão registrada de aceitar o limite de instância única) | E-05 | M | decisão | `login-throttle`, `mfa-service` |

## Onda 5: higiene e documentos

| # | Item | Achado | Esforço |
|---|---|---|---|
| 5.1 | Remover `somarCounts`, `FHIR_VERSION`, `acharPorCpf` (e seu teste), caminhos de compatibilidade do `audit` | R-01 a R-03, R-07 | P |
| 5.2 | Reduzir a superfície pública: exports só de teste marcados e os sem consumidor removidos | R-04, R-05 | P |
| 5.3 | Limites de tamanho de texto em `diseases`, `health_units`, `professionals`, com teste | E-16, C-03 | M |
| 5.4 | Contrato da API (OpenAPI) e contrato de paginação único | C-05, E-29 | M |
| 5.5 | Consentimento visível ao admin, ou ajuste do ROPA | E-25 | P |
| 5.6 | `GET /auth/me` sem CPF, RG e CNS completos (máscara), com o valor inteiro só na tela de edição | E-22 | P a M |
| 5.7 | Itens A6 e demais do backlog: `temp_marked.js`, `.superpowers`, PDFs em `docs/`, `ROTEIRO_TESTE_ALUNOS.md`, `PRODUCT.md` desatualizado frente ao ADR-0001, BOM nos commits, reiniciar a API local | backlog | P |

## ADRs que faltam

Escritos ao iniciar a onda correspondente, com a decisão em aberto:

| ADR | Tema | Onda |
|---|---|---|
| 0013 | Escrita única de agendamento (serviço `criarAtendimento` e pipeline de mudança para todos os papéis) | 2 |
| 0014 | Camada de serviço e repositório para todas as rotas; regra de dependência (rota, serviço, repositório, núcleo puro) | 3 |
| 0015 | Observabilidade: request id e log estruturado | 4 |
| 0016 | Retenção e expurgo agendados, e contrato da API | 4 e 5 |

## Como cada item é executado

1. O responsável aprova o item.
2. Antes de mexer, um teste que falha descreve o comportamento desejado (quando o item muda comportamento).
3. A mudança é feita no menor recorte que passe nos testes.
4. Rodam: testes do servidor e de corrida em banco descartável, `vitest` do `web/` (nunca na raiz), `tsc`, lint e e2e em banco descartável.
5. Commit próprio, com a mensagem apontando o achado (por exemplo `E-10`).
6. O registro `SYSTEM_DESIGN_ACHADOS.md` marca o achado como resolvido, com o commit.

## Critérios de pronto da fase

- Todas as falhas de requisito (E-10, E-11, E-15, E-21, E-24, E-26) corrigidas e provadas por teste.
- Os três caminhos de escrita de agendamento reduzidos a um, com paciente, recepção e fila passando pelas mesmas travas, eventos e auditoria.
- Nenhuma rota com SQL direto.
- ROPA e RIPD coerentes com o código.
- Servidor, web e e2e verdes ao fim de cada onda.
