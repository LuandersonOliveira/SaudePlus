# Plano de Agenda Operacional (SIGMA) - Saúde+

> Documento de planejamento criado em 2026-10-29 a partir da análise da proposta
> SIGMA e do código atual do Saúde+. Status (2026-10-31, verificado contra o
> código): **Fases 0–3 implementadas** — `assets/agenda.js`, `GET /staff/agenda`,
> `/staff/agenda/month`, `/staff/agenda/reports`, `server/src/services/booking-events.js`,
> `e2e/agenda.spec.js` + `agenda-responsive.spec.js` e os testes de
> `server/test/agenda-*.test.js` existem e cobrem o escopo abaixo. Seção 7 marcada
> de acordo; Fase 4 permanece fora de escopo por decisão (seção 7).

**Objetivo:** transformar a agenda atual em uma agenda operacional completa para
recepção e administração, sem reescrever o motor de disponibilidade existente.

**Arquitetura:** manter `work_schedules`, `schedule_blocks`, `unit_offers` e
`professional_offers` como fonte de verdade; adicionar duração por serviço,
validação de sobreposição por utente, criação de agendamento pela recepção,
histórico de remarcação, fila “Para remarcar” e uma UI compartilhada entre
`admin.html` e `atendente.html`.

**Stack:** Node/Express, MySQL (`mysql2/promise`), HTML/CSS/JS sem build step,
testes `node:test`, Playwright para E2E.

**Referências:** [`REQUISITOS_REFERENCIA.md`](../tecnico/REQUISITOS_REFERENCIA.md),
[`PLANO_UIUX.md`](./PLANO_UIUX.md),
[`INTEROPERABILIDADE.md`](../tecnico/INTEROPERABILIDADE.md).

## 1. Decisões aprovadas

1. **UI compartilhada:** a agenda será uma aba/página operacional compartilhada
   por `admin.html` e `atendente.html`, renderizada por um módulo comum
   (`assets/agenda.js`). Não haverá reescrita do painel administrativo nem um
   “painel ADM” paralelo.
2. **Sem “Turma” nesta fase:** turmas exigem modelo próprio de grupo,
   capacidade, inscrição e presença. Ficam para um épico separado.
3. **Sem limite semanal nesta fase:** a regra “normal 2 / teto 2” não existe no
   código nem nos requisitos. Se for necessária, será configurável por serviço,
   unidade e utente, com exceções explícitas.
4. **Agendamento pela recepção apenas para utente cadastrado:** o modal começa
   com busca por nome/e-mail/telefone. Cadastro rápido de paciente fica fora
   desta fase por exigir definição de consentimento e minimização de dados.
5. **Histórico no mesmo registro:** reagendamento continua atualizando o mesmo
   `appointment`/`exam` e grava eventos em `booking_events`. Isso preserva o
   comportamento atual do NV01 e cria histórico consultável.
6. **Desativação de profissional move pendentes automaticamente:** registros
   futuros `pendente`/`confirmado` passam para `para_remarcar`, o horário é
   liberado, um evento é gravado e o paciente é avisado por e-mail em modo
   best-effort.
7. **Sem exclusão física de atendimentos:** “Excluir” na UI significa cancelar
   ou arquivar com motivo, preservando histórico e auditoria.
8. **RF17 primeiro:** filtros server-side em `/admin/appointments` e
   `/admin/exams` são pré-requisito para a agenda operacional e para NV07.

## 2. O que será adotado, adaptado ou descartado

| Proposta SIGMA | Estado atual verificado | Decisão |
|---|---|---|
| Calendário dinâmico no lugar de vagas fixas | Já é dinâmico: `work_schedules` + `schedule_blocks` + slots reais (`server/src/utils/booking.js:361`) | Adotar apenas a UI; não alterar o modelo |
| Visão mensal/diária com manhã/tarde | Admin tem tabela “Atendimentos”; atendente tem lista “Fila do dia” (`atendente.html:519`) | Implementar agenda compartilhada; turnos são agrupamento visual |
| Grade de slots com status | Paciente vê slots; staff não vê grade operacional | Implementar endpoint e componente de grade |
| Modal “Novo agendamento” pela recepção | Não existe `POST` de criação em `staff.routes.js` nem `admin.routes.js`; só o paciente cria (`me.booking.routes.js:55`) | Implementar com busca de utente e transação/lock |
| Nome/Telefone/E-mail digitados livremente | `appointments.user_id` é obrigatório; utente precisa existir | Adaptar para busca de cadastro; sem cadastro rápido nesta fase |
| Aba Pessoa/Turma | Não existe conceito de turma no schema | Adiar Turma |
| Limite semanal “normal 2 / teto 2” | Não existe regra nem campo | Adiar; se necessário, tornar configurável |
| Ações Confirmar, Registrar atendimento, Remarcar depois, Recusou, Editar, Excluir | Status atuais: `pendente`, `confirmado`, `cancelado`, `concluido` (`server/schema.sql:178`) | Adaptar com `para_remarcar`, `outcome`/motivo e sem exclusão física |
| Duração por especialidade | Hoje é `work_schedules.slot_minutes`; `duracaoMinutos` usa o slot (`booking.js:274`) | Implementar duração por serviço com fallback para o slot |
| Bloquear utente em dois horários simultâneos | Só há conflito por profissional (`validateBooking`, `booking.js:282`) | Implementar validação cruzada consultas + exames |
| Todas as especialidades/exames com agenda | Serviço ativo sem profissional/escala não aparece | Implementar auditoria administrativa; não criar escala automática |
| Motivo obrigatório ao remarcar | `applyBookingChange` só aceita `status` e `scheduled_at` (`booking.js:675`) | Implementar motivo + histórico |
| Médico desativado move pendentes para “Para remarcar” | `professionals.active=0` só esconde o profissional (`admin.professionals.routes.js:105`) | Implementar movimentação automática, auditoria e aviso |
| Isolamento/duplicação de modais do painel ADM | `assets/ui.js:185` centraliza comportamento, mas o markup é repetido em `admin.html` | Extrair componente de agenda; não criar shell paralelo |
| Excluir atendimento | Não há delete; histórico é auditado | Rejeitar exclusão física; usar cancelamento/arquivamento |

## 3. Regras de negócio

### 3.1 Ocupação e status

- Status que ocupam horário: `pendente` e `confirmado`.
- `para_remarcar` **não** ocupa o horário antigo; é uma pendência operacional.
- `cancelado` e `concluido` não ocupam horário.
- `outcome` registra o desfecho operacional: `compareceu`, `faltou`, `recusou`,
  `desistiu`, `erro_agendamento`, `profissional_indisponivel`.
- “Recusou” na UI grava `cancelado` + `outcome='recusou'`; não cria um status
  novo para cada motivo.
- “Registrar atendimento” grava `concluido` + `outcome='compareceu'`.
- “Excluir” grava cancelamento/arquivamento com motivo; nunca `DELETE` físico.

### 3.2 Duração

- `unit_offers.duration_minutes` define a duração padrão do serviço.
- Se nulo, a duração continua sendo `work_schedules.slot_minutes` (fallback
  histórico).
- O valor é gravado em `appointments.duration_minutes`/`exams.duration_minutes`
  no momento da marcação, como já ocorre hoje.
- Um atendimento mais longo pode consumir vários slots consecutivos da grade.
- A cota de prioridade NV02 continua calculada sobre os slots da grade; um
  atendimento de 60 minutos consome dois slots de 30.

### 3.3 Conflito por utente

- O mesmo utente não pode ter dois registros ativos sobrepostos, somando
  consultas e exames.
- A validação considera `pendente` e `confirmado`.
- A checagem deve ocorrer dentro da mesma transação da gravação.
- A transação deve travar a linha do profissional e a linha do utente, em ordem
  determinística, para evitar corrida e deadlock.

### 3.4 Remarcação

- Staff/admin devem informar `reschedule_reason`.
- O paciente pode reagendar com motivo automático
  `solicitado_pelo_paciente`.
- Toda remarcação grava um evento com horário/profissional anterior e novo.
- O mesmo registro é atualizado; não há duplicação de linha.

### 3.5 Desativação de profissional

- Ao definir `professionals.active=0`, o sistema busca registros futuros
  `pendente`/`confirmado` do profissional.
- Cada registro passa para `para_remarcar` com motivo
  `profissional_inativado`.
- O horário antigo é liberado; a fila de espera NV03 pode ocupá-lo.
- Um evento é gravado e o paciente recebe aviso best-effort.
- Não há cancelamento automático nem exclusão.

### 3.6 Fila do dia

- Ordem: prioridade legal NV02 primeiro, depois horário.
- A fila inclui `pendente` e `confirmado`, não apenas `pendente` como hoje
  (`atendente.html:532`).
- Check-in e chamada são ações operacionais; não alteram a regra de ocupação.

## 4. Modelo de dados

### 4.1 Migração `migrate:agenda`

Criar `server/scripts/migrate-agenda.js`, idempotente, e adicionar ao
`migrate:all` em `server/package.json` e ao `README.md`.

Alterações:

| Tabela | Alteração |
|---|---|
| `unit_offers` | `duration_minutes INT NULL DEFAULT NULL` |
| `appointments` | `status ENUM` com `para_remarcar`; `outcome VARCHAR(40) NULL`; `reschedule_reason VARCHAR(255) NULL` |
| `exams` | mesmas alterações de `appointments` |
| `appointments`/`exams` | índices compostos `(user_id, scheduled_at)`, `(professional_id, scheduled_at)`, `(status, scheduled_at)` |
| nova `booking_events` | histórico operacional append-only |

`booking_events`:

```sql
CREATE TABLE IF NOT EXISTS booking_events (
    id CHAR(36) NOT NULL PRIMARY KEY,
    kind ENUM('consulta', 'exame') NOT NULL,
    booking_id CHAR(36) NOT NULL,
    event_type ENUM(
        'created',
        'status_changed',
        'rescheduled',
        'professional_deactivated',
        'canceled'
    ) NOT NULL,
    from_scheduled_at DATETIME NULL,
    to_scheduled_at DATETIME NULL,
    from_professional_id CHAR(36) NULL,
    to_professional_id CHAR(36) NULL,
    reason VARCHAR(255) NULL,
    actor_user_id CHAR(36) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_booking_events_booking (kind, booking_id, created_at),
    CONSTRAINT fk_booking_events_actor
        FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB;
```

Justificativa: `audit_log` continua sendo a trilha inviolável do sistema, mas
não é acessível ao atendente. `booking_events` é o histórico operacional que a
UI da agenda e os relatórios podem consultar sem expor auditoria administrativa.

### 4.2 Compatibilidade

- `duration_minutes` nulo em `unit_offers` mantém o comportamento atual.
- Status antigos continuam válidos.
- Registros antigos com `duration_minutes` nulo continuam usando 30 minutos no
  cálculo de conflito (`duracaoDe`, `booking.js:147`).
- A migração não altera dados existentes.

## 5. Backend

### 5.1 Serviços e arquivos

- `server/src/utils/booking.js`: evoluir `schedulePara`, `duracaoMinutos`,
  `validateBooking`, `getAvailability` e `findAvailabilityByService` para
  aceitar duração de serviço.
- `server/src/services/agenda.js`: novo serviço para montar a grade do dia
  (livre, ocupado, bloqueado, reservado, passado) e a visão mensal.
- `server/src/services/booking-events.js`: registrar e consultar eventos.
- `server/src/routes/staff.routes.js`: endpoints de agenda e criação, ou um
  router dedicado `server/src/routes/staff.agenda.routes.js` montado antes das
  rotas genéricas.
- `server/src/routes/admin.routes.js`: RF17 e extensão do `PATCH`.
- `server/src/routes/admin.professionals.routes.js`: hook de desativação.
- `server/src/routes/me.booking.routes.js`: manter o fluxo do paciente,
  reutilizando a validação de sobreposição por utente.

### 5.2 Endpoints

| Método | Rota | Permissão | Função |
|---|---|---|---|
| GET | `/admin/appointments` | `appointments` | RF17: `status`, `unit_id`, `date_from`, `date_to`, paginação |
| GET | `/admin/exams` | `appointments` | RF17 para exames |
| GET | `/staff/agenda` | staff/admin | Grade do dia por data, unidade, profissional e tipo |
| GET | `/staff/agenda/month` | staff/admin | Contagens/visão mensal para o calendário |
| POST | `/staff/appointments` | staff/admin | Criar consulta para utente cadastrado |
| POST | `/staff/exams` | staff/admin | Criar exame para utente cadastrado |
| PATCH | `/staff/:kind/:id` | staff/admin | Estender para unidade, profissional, serviço, duração, motivo e `outcome` |
| GET | `/staff/booking-events` | staff/admin | Histórico operacional de um registro |
| GET | `/admin/catalog-health` | `units` | Serviços ativos sem profissional ativo ou sem escala |

O admin pode usar as rotas `/staff` porque `requireStaff` já aceita
`atendente` e `admin` (`server/src/middleware/auth.js:26`). Evitar duplicar a
mesma lógica em `/admin`.

### 5.3 Criação pela recepção

Fluxo:

1. Buscar utente por nome/e-mail/telefone.
2. Selecionar serviço, unidade, profissional, data/hora e observação.
3. Validar janela de 1 ano, oferta, vínculo profissional/serviço, escala,
   bloqueios, prioridade NV02, duração e sobreposição por utente.
4. Abrir transação, travar profissional e utente, revalidar e inserir.
5. Gravar `duration_minutes`, `booking_events` tipo `created` e auditoria.
6. Em caso de cancelamento posterior, liberar a vaga NV03 como hoje.

A criação não deve permitir utente inexistente nem texto livre de nome/e-mail.

### 5.4 Desativação de profissional

No `PATCH /admin/professionals/:id`, quando `active` mudar de 1 para 0:

1. Buscar registros futuros `pendente`/`confirmado`.
2. Em transação, mover para `para_remarcar`.
3. Gravar `reschedule_reason='profissional_inativado'` e evento.
4. Liberar a vaga (o status `para_remarcar` não ocupa horário).
5. Após o commit, disparar aviso por e-mail best-effort.
6. Auditar a quantidade de registros afetados.

## 6. UI/UX

### 6.1 Componente compartilhado

- Criar `assets/agenda.js`.
- `admin.html` e `atendente.html` carregam o módulo e montam a agenda em um
  container próprio.
- Não criar `agenda.html` nesta fase: isso duplicaria shell, autenticação,
  navegação e tratamento de sessão.
- Reutilizar `openModal`, `confirmDialog`, `toast`, `statusClass` e utilitários
  de `assets/ui.js`/`assets/api.js`.
- O modal de detalhes/novo agendamento deve ser único e reutilizado pelas duas
  páginas.

### 6.2 Tela

- Abas **Dia** e **Para remarcar**.
- Navegação mensal e diária.
- Filtros por unidade, profissional e tipo.
- Grade com legenda: livre, ocupado, bloqueado, reservado, passado.
- Cards de resumo: total do dia, confirmados, pendentes, para remarcar,
  vagas livres.
- Ações por item: confirmar presença, registrar atendimento, remarcar,
  recusar/cancelar com motivo, ver histórico.
- “Novo agendamento” abre busca de utente; não exibe campos livres de
  telefone/e-mail.
- Mobile: tabela vira cards; alvos de toque mínimos de 44px.

### 6.3 Acessibilidade

- `aria-label` único por ação (evitar N botões “Editar” iguais).
- Foco preso e devolvido nos modais via `openModal`.
- Navegação por teclado nas abas e na grade.
- Status não depende só de cor; usar texto e ícone.
- A auditoria WCAG 2.1 AA completa continua no NV08, mas os componentes novos
  já nascem semânticos.

## 7. Fases e tarefas

### Fase 0 - Fundação

- [x] **0.1 RF17:** adicionar filtros server-side em `/admin/appointments` e
  `/admin/exams`, com paginação e testes.
  - Teste: `server/test/admin-appointments-filter.test.js`.
- [x] **0.2 Contrato de status:** documentar e implementar `para_remarcar`,
  `outcome`, `reschedule_reason` e `booking_events`.
  - Teste: `server/test/booking-status.test.js`.
- [x] **0.3 Tempo local:** centralizar helpers de data local para agenda e
  relatórios, evitando regressão de fuso.

### Fase 1 - Backend da agenda

- [x] **1.1 Migração:** `migrate:agenda`, schema parity e rollback documentado.
  - Teste: `server/test/schema-parity.test.js` atualizado.
- [x] **1.2 Duração por serviço:** `unit_offers.duration_minutes`, fallback para
  `slot_minutes`, validação e disponibilidade.
  - Teste: `server/test/service-duration.test.js`.
- [x] **1.3 Sobreposição por utente:** validação cruzada consultas + exames,
  com lock de utente e profissional.
  - Teste: `server/test/booking-user-overlap.test.js`.
- [x] **1.4 Criação pela recepção:** `POST /staff/appointments` e
  `POST /staff/exams`.
  - Teste: `server/test/staff-booking-create.test.js`.
- [x] **1.5 Agenda do dia:** `GET /staff/agenda` e `GET /staff/agenda/month`.
  - Teste: `server/test/agenda-day.test.js`.
- [x] **1.6 Remarcação com motivo:** estender `applyBookingChange` e gravar
  eventos.
  - Teste: `server/test/reschedule-reason.test.js`.
- [x] **1.7 Desativação de profissional:** mover pendentes, liberar horário,
  gravar evento e avisar.
  - Teste: `server/test/professional-deactivation.test.js`.
- [x] **1.8 Saúde do catálogo:** serviço ativo sem profissional ativo ou sem
  escala.
  - Teste: `server/test/catalog-health.test.js`.

### Fase 2 - UI compartilhada

- [x] **2.1 `assets/agenda.js`:** abas Dia/Para remarcar, calendário, filtros e
  grade.
  - Teste: `e2e/agenda.spec.js`.
- [x] **2.2 Modal único:** detalhes, novo agendamento e remarcação.
  - Teste E2E: criar consulta para utente cadastrado; utente inexistente não
  aparece.
- [x] **2.3 Ações operacionais:** confirmar, registrar, remarcar, recusar e
  cancelar com motivo.
  - Teste E2E: cada ação grava o status/outcome esperado.
- [x] **2.4 Responsividade e acessibilidade:** 360/820/1440, teclado, foco,
  nomes acessíveis.
  - Teste: `e2e/agenda-responsive.spec.js`.

### Fase 3 - Operação e gestão

- [x] **3.1 Fila “Para remarcar”:** listar, filtrar, reabrir e reagendar.
  - Teste: `server/test/agenda-remarcar.test.js` + E2E.
- [x] **3.2 Base NV07:** ocupação, absenteísmo, cancelamentos por motivo e tempo
  até reagendamento.
  - Teste: `server/test/agenda-reports.test.js`.
- [x] **3.3 Fila do dia:** incluir confirmados, ordenar por prioridade legal e
  horário, check-in e chamada.
  - Teste: `server/test/agenda-queue.test.js` + E2E.
- [x] **3.4 NV08 parcial:** auditoria de acessibilidade dos novos componentes.

### Fase 4 - Fora de escopo imediato

- Turma/grupo com capacidade e presença.
- Limite semanal configurável.
- NV06 confirmação ativa por canal.
- Integração RNDS/e-SUS.
- Reescrita do painel administrativo.

## 8. Testes e verificação

Comandos:

```bash
npm run test:all
npm run test:e2e
npm run lint
```

Critérios:

- Nenhum teste existente quebra (NV01, NV02, NV03, duração, prioridade,
  waitlist).
- Corrida de dois agendamentos simultâneos para o mesmo utente não cria
  sobreposição.
- Corrida de dois agendamentos simultâneos para o mesmo profissional continua
  bloqueada.
- Migração é idempotente em banco vazio e em banco com dados.
- `migrate:all` continua funcionando.
- Nenhum `DELETE` físico de atendimento é introduzido.
- Logs/auditoria registram criação, remarcação, cancelamento e desativação.

## 9. Riscos e cuidados

1. **Deadlock:** travar utente e profissional em ordem determinística.
2. **Fuso horário:** usar data local, não `toISOString()`, como já corrigido em
   `atendente.html:527`.
3. **Duração longa:** um atendimento de 60 minutos precisa bloquear todos os
   slots consecutivos e respeitar o fim da escala.
4. **Cota NV02:** a reserva continua por slot de grade; atendimentos longos
   consomem mais de um slot.
5. **`para_remarcar`:** não pode bloquear o horário antigo, mas também não pode
   sumir dos relatórios.
6. **Desativação em lote:** pode afetar muitos registros; usar transação e
   limitar o aviso por e-mail para não derrubar a operação.
7. **LGPD:** a busca de utente deve retornar o mínimo necessário; não expor CPF
   na agenda; leituras sensíveis continuam auditadas.
8. **Modais:** não criar markup duplicado em admin/atendente; a agenda deve usar
   um único componente e um único modal.

## 10. Critérios de aceite

- RF17 funciona no servidor, com filtros combináveis e paginação.
- Recepção cria consulta/exame para utente cadastrado, com validação completa.
- Agenda mostra dia/mês, filtros, slots livres/ocupados/bloqueados e ações.
- O mesmo utente não consegue dois registros sobrepostos.
- Duração por serviço é respeitada na disponibilidade, na criação e no
  reagendamento.
- Remarcação exige motivo e aparece no histórico.
- Desativar profissional move pendentes para “Para remarcar” e libera horário.
- Fila “Para remarcar” permite reagendar sem perder histórico.
- Nenhum atendimento é excluído fisicamente.
- `npm run test:all`, `npm run test:e2e` e `npm run lint` passam.

## 11. Rastreabilidade

| Requisito | Onde entra |
|---|---|
| RF15/RF17 | Fase 0.1 e endpoints de agenda |
| NV01 | Preservado e estendido na Fase 1.6 |
| NV02 | Preservado; cota por slots na Fase 1.2/1.3 |
| NV03 | Preservado; vaga liberada na desativação e cancelamento |
| NV04 | Fora deste plano; segue como próximo item independente |
| NV05 | Fase 3.1/3.3 |
| NV06 | Fora deste plano |
| NV07 | Fase 3.2 |
| NV08 | Fase 2.4 e 3.4 (parcial) |
| RNF03 | Recepção e admin operam a mesma agenda |
| RNF04 | Busca mínima de utente e sem exposição de CPF |
| RNF08 | Paginação e visão mensal |
| RNF10 | Testes por fase |
