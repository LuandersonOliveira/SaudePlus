# RFC-0001 — Integridade de dados de agendamento e identidade do paciente

| | |
|---|---|
| **Status** | Em discussão (pedido de comentários) |
| **Data** | 2026-11-01 |
| **Origem** | Fase 6 — achados B1, B2, B3 de `ANALISE_ESTRUTURA_ARQUITETURA_BANCO.md` |
| **Evidência** | `poc/POC-001-integridade-agendamento-e-cpf.md` (18/18 verificações) |
| **Detalhamento técnico** | `especificacao/ESPEC-001-integridade-agendamento-e-cpf.md` |
| **Decisões derivadas** | ADR-0006, ADR-0007 (propostas) e ADR-0008 (migrations) |
| **Revisores sugeridos** | responsável pelo backend, responsável pelo banco, DPO/LGPD, quem opera a agenda (atendimento) |

## 1. Resumo

Três garantias que hoje dependem de disciplina da aplicação passariam a ser garantidas pelo banco:

1. **Unidade e profissional de um agendamento existem de verdade** (chaves estrangeiras).
2. **Um profissional não tem dois atendimentos ativos no mesmo horário** (índice único sobre coluna gerada).
3. **Um CPF identifica um único paciente** (índice cego HMAC, que também troca uma busca que decifra a tabela inteira por uma consulta indexada).

Nada muda na interface do usuário, exceto mensagens de erro mais claras em dois casos (horário ocupado, CPF já cadastrado).

## 2. Motivação

- `appointments` e `exams` só têm FK para `user_id`; `unit_id` e `professional_id` aceitam qualquer texto, sem índice em `unit_id`.
- O horário único só é garantido por `SELECT … FOR UPDATE` dentro de transação (`utils/booking.js`). Funciona e tem teste de corrida, mas todo caminho novo de escrita precisa lembrar do padrão.
- O cadastro não verifica CPF repetido (só o e-mail é `UNIQUE`): a mesma pessoa pode ter duas contas, com fila e histórico divididos. O vínculo Gov.br decifra todos os usuários para achar um CPF (`auth.routes.js:745`).

## 3. Proposta

### 3.1 FKs e índice em `unit_id` (B1)
Auditar órfãos, zerá-los, e então `ADD CONSTRAINT … FOREIGN KEY (unit_id) REFERENCES health_units(id) ON DELETE SET NULL` (idem `professional_id`) + `INDEX (unit_id, scheduled_at)`. `location`, `doctor` e `specialty` continuam gravados como "foto" do momento.

### 3.2 Horário único no banco (B2)
Coluna gerada `active_slot = IF(status IN ('pendente','confirmado'), scheduled_at, NULL)` e `UNIQUE (professional_id, active_slot)` em ambas as tabelas. O `FOR UPDATE` continua (é ele que cobre sobreposição por duração); o índice é a rede de proteção. A aplicação passa a tratar `ER_DUP_ENTRY` como 409 "horário já ocupado".

### 3.3 Identidade por CPF (B3)
Coluna `cpf_hmac CHAR(64)` com `UNIQUE`, calculada com HMAC-SHA256 sobre os 11 dígitos, usando uma chave **separada** da chave de cifra. Preenchida por migração (decifra uma vez) e mantida no signup e na atualização de perfil. A busca do Gov.br vira `WHERE cpf_hmac = ?`.

## 4. Alternativas consideradas

| Tema | Alternativa | Por que não |
|---|---|---|
| CPF | Cifra determinística (mesmo CPF → mesmo texto) | Vaza igualdade entre registros e enfraquece a cifra de coluna inteira; HMAC separado limita o vazamento à igualdade do CPF |
| CPF | Manter tudo na aplicação (status quo) | Não impede duplicidade sob concorrência e a busca é O(N) |
| Horário | Só `GET_LOCK`/`FOR UPDATE` (status quo) | Sem rede de proteção para novo código |
| Horário | Índice único em `(professional_id, scheduled_at)` simples | Cancelados e remarcados bloqueariam o horário para sempre |
| FK | `ON DELETE RESTRICT` | Impediria desativar/limpar unidades com histórico; hoje unidades são desativadas (`active`), não apagadas, mas `SET NULL` preserva o histórico mesmo se isso mudar |

## 5. Impacto

- **Compatibilidade:** sem mudança de contrato HTTP; 2 respostas de erro novas (409).
- **Dados:** 1 migração com backfill do `cpf_hmac` e limpeza de órfãos. Exige janela curta de manutenção só se houver duplicatas a resolver manualmente.
- **LGPD:** o HMAC é dado derivado do CPF. Sem a chave não se inverte nem se compara; com a chave, permite confirmar um CPF candidato. Deve ficar sob a mesma governança da `DATA_ENCRYPTION_KEY` (cofre, rotação). Atualizar o ROPA/RIPD (`docs/governanca/`) com a nova coluna.
- **Desempenho:** busca por CPF medida no PoC: 8.412 ms (varredura com decifra, 50 mil usuários) → 11 ms (índice).

## 6. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Já existem CPFs duplicados: o `UNIQUE` falha na migração | Relatório de duplicatas antes; resolução manual (mesclar contas) é decisão do atendimento, não automática |
| Vazamento da chave HMAC permite confirmar CPFs candidatos | Chave separada, em cofre, fora do repositório e dos backups do banco |
| Rotação da chave HMAC exige recalcular tudo | Script de backfill idempotente (mesmo da migração) |
| `professional_id` NULL escapa do índice único | Consultas sem profissional seguem a regra da aplicação; o React já exige profissional quando existe |
| Sobreposição por duração (08:00–09:00 vs 08:30) não é coberta | Continua no `FOR UPDATE` da aplicação (limite medido no PoC) |

## 7. Perguntas abertas (para os revisores)

1. ~~Duplicatas de CPF: mesclar ou sinalizar?~~ **Decidido (2026-11-01):** só relatar; a migração para e lista os ids, sem mesclar contas.
2. ~~Dependentes e menores podem usar o CPF do responsável?~~ **Decidido (2026-11-01):** não se usa o CPF do responsável. Menor de 18 pode se cadastrar **sem CPF**, desde que informe o **CNS** (cifrado, como sempre); o responsável legal continua obrigatório e é registrado só pelo nome (`guardian_name`). CPF ausente fica `NULL`, que não colide no `UNIQUE (cpf_hmac)`. Se o menor tem CPF próprio, ele vale e é único como o de qualquer pessoa.
3. ~~Onde fica a chave HMAC?~~ **Decidido (2026-11-01):** variável `CPF_HMAC_KEY`, separada da de cifra, exigida no boot; em produção, injetada pelo cofre/provedor (nunca no repositório nem nos backups do banco).
4. ~~Aceitamos que `ON DELETE SET NULL` deixe agendamentos antigos sem unidade, ou gravamos também `unit_name`?~~ **Decidido (2026-11-01):** aceitar. A API **não tem rota para apagar unidade** (só `PATCH active`, que inativa); o `SET NULL` é rede de segurança para uma exclusão manual no banco, e o texto `location` do agendamento continua como "foto" do local. Orientação de operação: **inative, não apague**. Não se grava `unit_name` (redundante com `location`).

## 8. Plano e critérios de aceite

1. Aprovar este RFC → promover ADR-0006/0007 de *Proposta* para *Aceita*.
2. Implementar conforme a especificação, em três migrações separadas (B1, B2, B3), cada uma com rollback.
3. Aceite: suíte do servidor verde; novos testes de FK, de horário único (inclui corrida) e de CPF duplicado; `npm run doctor` conhece as novas colunas; relatório de órfãos/duplicatas zerado em produção antes do `UNIQUE`/FK.

## 9. Histórico de comentários

- 2026-11-01 — B1 implementado (`2b51368`). Perguntas 1 e 3 decididas com o responsável do projeto; B3 implementado (ADR-0006 aceita). B2 (horário único) implementado (migration 0005, ADR-0007 aceita). RFC integralmente implementada; perguntas 2 e 4 seguem abertas.

_(registrar aqui data, autor e decisão a cada rodada)_
