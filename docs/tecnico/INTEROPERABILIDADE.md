# Saúde+ — Arquitetura de interoperabilidade

> Define como o Saúde+ conversa com sistemas externos de saúde **sem depender
> de um fornecedor específico**. O alvo concreto de integração é decidido na
> descoberta institucional (ver [`DESCOBERTA_SAUDE_DIGITAL.md`](./DESCOBERTA_SAUDE_DIGITAL.md)).
>
> Status: **especificação condicionada**. Nenhum código de integração deve ser
> escrito antes de todos os gates da seção 7 estarem fechados.
> Complementa [`PLANO_RNDS_LGPD.md`](../planos/PLANO_RNDS_LGPD.md) §3.

## 1. Princípio

O Saúde+ tem um **contrato interno canônico** (FHIR R4) e **adaptadores
plugáveis** para cada destino. O núcleo do produto (agenda, fila, catálogo,
auditoria) nunca conhece detalhes do sistema externo.

Consequências:

- Trocar de fornecedor não reescreve a agenda.
- Um destino indisponível não derruba o produto.
- O mesmo agendamento pode alimentar RNDS, e-SUS ou um sistema terceiro sem
  duplicar regra de negócio.
- Nenhuma credencial ou endpoint de terceiro entra no código-fonte.

## 2. Alvos possíveis

| Cenário | Alvo | Integração | Observação |
|---|---|---|---|
| **A** | e-SUS PEC + RNDS | FHIR R4 sobre mTLS, envio de `Bundle` | Rota preferencial; depende de credenciamento |
| **B** | e-SUS APS em CDS | Sem API; exportação/importação assistida | Provável hoje; Saúde+ assume a agenda local |
| **C** | Fornecedor terceiro com API | Adaptador dedicado | Exige contrato, documentação e sandbox |
| **D** | Nenhum sistema | Sem integração | Saúde+ é o sistema principal |

O cenário escolhido deve ser registrado no diário de decisões da descoberta.
Enquanto não houver escolha, o Saúde+ opera em **modo D** (autônomo) — que já é
o comportamento atual.

## 3. Modelo canônico (FHIR R4)

### 3.1 Mapa de recursos

| Recurso FHIR | Origem no Saúde+ | Campos relevantes |
|---|---|---|
| `Patient` | `users` (role `paciente`) | `id`, `full_name`, `social_name`, `cpf`, `cns`, `birth_date`, `gender`, `race`, `phone`, `mobile`, endereço |
| `RelatedPerson` | `users.guardian_name` | Responsável legal de menor de 18 anos |
| `Practitioner` | `professionals` | `id`, `name`, `registry`, `job_title`, `active` |
| `PractitionerRole` | `professional_offers` | profissional × unidade × especialidade |
| `HealthcareService` | `unit_offers` | `kind` (`consulta`/`exame`), `name` |
| `Location` | `health_units` | `id`, `name`, `type`, `cnes_code`, `address`, `phone`, `neighborhood` |
| `Schedule` | `work_schedules` | `weekday`, `start_time`, `end_time`, `slot_minutes`, `active` |
| `Slot` | calculado por `server/src/utils/booking.js` | janela livre por profissional/unidade/serviço |
| `Appointment` | `appointments` e `exams` | `scheduled_at`, `duration_minutes`, `status`, `unit_id`, `professional_id`, `specialty`/`exam_type` |
| `AuditEvent` | `audit_log` | `action`, `entity_type`, `entity_id`, `created_at`, `entry_hash` |
| `Encounter` | — | **Fora de escopo**: o Saúde+ não faz prontuário |

### 3.2 Identificadores

| Sistema | Uso | Formato |
|---|---|---|
| CNS | Identidade principal no SUS | 15 dígitos, checksum validado em `server/src/utils/validators.js` |
| CPF | Identidade civil | 11 dígitos, dígito verificador |
| CNES | Estabelecimento | 7 dígitos em `health_units.cnes_code` |
| `appointments.id` | Idempotência interna | UUID v4 |
| `external_ref` | Correlação com o destino | string opaca, única por adaptador |

Regras:

- CNS e CPF são **dado sensível**: trafegam cifrados em repouso e nunca em log.
- Deduplicação por CNS quando existir; senão por CPF + data de nascimento;
  senão cadastro manual assistido.
- Divergência de identidade **nunca** é resolvida por sobrescrita automática:
  gera fila de revisão para o atendente.

### 3.3 Status

| Saúde+ | FHIR `Appointment.status` |
|---|---|
| `pendente` | `pending` |
| `confirmado` | `booked` |
| `cancelado` | `cancelled` |
| `concluido` | `fulfilled` |

### 3.4 Fuso e tempo

- Todo horário é armazenado em `DATETIME` local de **America/Recife** (UTC-3,
  sem horário de verão desde 2019).
- Na borda FHIR, converter para ISO 8601 com offset explícito (`-03:00`).
- `duration_minutes` nulo é tratado como 30 no cálculo de conflito — regra já
  existente e deve ser preservada no adaptador.

## 4. Contrato do adaptador

Todo adaptador implementa a mesma interface. O núcleo chama a interface; nunca
o HTTP do fornecedor.

```js
// server/src/services/interop/<adapter>.js  (a criar somente após os gates)
module.exports = {
  name: 'string',
  capabilities(),                          // { read, write, hold, cancel, reschedule }
  health(),                                // { ok, latencyMs, version }
  pullUnits({ since }),
  pullProfessionals({ since }),
  pullServices({ unitId }),
  pullAvailability({ unitId, professionalId, serviceName, from, to }),
  hold({ slot, patient, idempotencyKey }),  // reserva temporária
  confirm({ holdId, idempotencyKey }),
  release({ holdId }),
  cancel({ appointmentId, reason, idempotencyKey }),
  reschedule({ appointmentId, slot, idempotencyKey }),
  getAppointment({ appointmentId }),
};
```

### 4.1 Regras obrigatórias

1. **Idempotência**: toda escrita carrega `idempotencyKey`; repetição devolve o
   mesmo resultado, não duplica agendamento.
2. **Toda chamada tem timeout** e orçamento máximo (ex.: 5 s leitura, 10 s
   escrita); sem timeout, um parceiro lento derruba a API.
3. **Nenhuma escrita em cascata**: uma falha de confirmação não cancela a
   reserva local sem registro.
4. **Nenhum dado sensível em log**: `cpf`, `cns`, `password`, tokens e corpos
   completos de `Patient` são redigidos.
5. **Erros tipados**, não strings: o núcleo decide o que fazer por tipo.

### 4.2 Taxonomia de erro

| Tipo | Exemplo | Ação do núcleo |
|---|---|---|
| `TRANSIENT` | timeout, 502, conexão recusada | Retry com backoff; manter estado local |
| `RATE_LIMIT` | 429 | Respeitar `Retry-After`; enfileirar |
| `AUTH` | 401/403 | Abrir incidente; não repetir em loop |
| `VALIDATION` | 400, campo inválido | Devolver ao usuário com mensagem clara |
| `CONFLICT` | vaga já ocupada | Reofertar horários; nunca sobrescrever |
| `NOT_FOUND` | recurso removido no destino | Marcar como órfão e reconciliar |
| `UNSUPPORTED` | operação não existe no destino | Degradar para modo assistido |

## 5. Fluxos

### 5.1 Agendamento (write-through com reserva)

```text
paciente escolhe slot
  → Saúde+ valida regra local (janela, conflito, prioridade)
  → adaptador.hold()                       (se o destino suportar)
  → grava appointments (pendente) + audit_log
  → adaptador.confirm()
  → appointments.status = confirmado
```

Se `hold()` não existir no destino:

```text
  → grava local (pendente)
  → adaptador.confirm()
  → em caso de CONFLICT, cancela local e reoferta
```

### 5.2 Cancelamento

```text
  → adaptador.cancel()
  → se TRANSIENT: marca cancelamento pendente em outbox
  → job de reconciliação reprocessa
```

### 5.3 Indisponibilidade do destino

- Leitura: servir cache local com selo "atualizado em".
- Escrita: aceitar e enfileirar (outbox), com aviso explícito ao atendente.
- Se o destino ficar fora por mais de X horas, a UI passa a **modo autônomo**
  declarado, nunca silencioso.

### 5.4 Reconciliação

Job periódico compara agendamentos locais com o destino:

- presente só no local → tentar criar novamente;
- presente só no destino → importar como "externo" e sinalizar;
- divergência de horário/status → fila de revisão humana.

## 6. Padrões de segurança

| Item | Regra |
|---|---|
| Transporte | TLS 1.2+; mTLS quando o destino exigir |
| Autenticação | OAuth 2.0 client credentials ou certificado; nunca chave em query string |
| Segredos | Variáveis de ambiente; nunca no repositório; rotação documentada |
| Escopo | Menor privilégio; um cliente por finalidade |
| Logs | Sem PII; correlação por `idempotencyKey` e `external_ref` |
| Retenção | Mensagens de outbox expurgadas após sucesso + janela de auditoria |
| LGPD | Base legal registrada por finalidade; RIPD antes de dado real |

## 7. Gates

Nenhum código de integração antes de **todos** fechados. Cada gate tem
evidência arquivada.

| Gate | Critério | Evidência |
|---|---|---|
| **G1 Institucional** | Secretaria confirma o sistema-alvo e o responsável técnico | Resposta de LAI/ofício |
| **G2 Jurídico** | Contrato/convênio com papéis de controlador e operador; DPA assinado | Minuta assinada |
| **G3 Técnico** | API documentada + sandbox acessível + versão identificada | Documento e acesso de teste |
| **G4 Segurança** | Auth, mTLS/OAuth, gestão de segredos e plano de revogação aprovados | Checklist assinado |
| **G5 Dados** | Mapa de campos validado com amostra no sandbox; identidade e dedup definidos | Relatório de teste |
| **G6 Operação** | SLA, horário de suporte, contato de escalonamento e rollback definidos | Anexo operacional |
| **G7 Produto** | Feature flag, kill switch, modo degradado e textos de UI aprovados | Demo em homologação |

## 8. Rollout

1. **Shadow mode** — ler do destino e comparar com o local, sem escrever.
2. **Piloto** — 1 unidade, 1 especialidade, write habilitado, kill switch pronto.
3. **Expansão** — 10% das unidades, depois todas, com métricas por etapa.

Critérios de saída de cada etapa:

- erro de escrita < 1%;
- nenhuma duplicidade de agendamento em 7 dias;
- tempo de resposta p95 < 2 s;
- nenhum incidente de dado sensível;
- atendimento treinado e runbook validado.

## 9. Observabilidade

| Métrica | Descrição |
|---|---|
| `interop_requests_total{adapter,op,result}` | Volume e resultado por operação |
| `interop_latency_seconds{adapter,op}` | Latência p50/p95/p99 |
| `interop_outbox_pending{adapter}` | Itens aguardando envio |
| `interop_reconcile_diff{adapter}` | Divergências encontradas |
| `interop_circuit_open{adapter}` | Estado do disjuntor |

Alertas:

- `AUTH` repetido → incidente imediato;
- outbox acima do limite por 30 min → degradação declarada;
- divergência de reconciliação acima de 0,5% → pausar escrita.

## 10. Fora de escopo

- Prontuário eletrônico e registro clínico (o Saúde+ agenda, não documenta
  atendimento).
- Faturamento SUS, APAC, BPA e produção ambulatorial.
- Estoque e dispensação de medicamentos.
- Substituir o e-SUS ou qualquer sistema oficial.

Essas funções pertencem ao sistema oficial; duplicá-las cria prontuário
paralelo e risco regulatório.

## 11. Referências

- RNDS — Guia de Implementação FHIR R4 (`rnds-fhir.saude.gov.br`).
- e-SUS APS — documentação de CDS e PEC.
- HL7 FHIR R4 — recursos `Patient`, `Practitioner`, `Location`, `Schedule`,
  `Slot`, `Appointment`.
- [`PLANO_RNDS_LGPD.md`](../planos/PLANO_RNDS_LGPD.md) — fases de RNDS e LGPD.
- [`DESCOBERTA_SAUDE_DIGITAL.md`](./DESCOBERTA_SAUDE_DIGITAL.md) — evidências e
  decisão do cenário.
