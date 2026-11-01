# POC-001 — Prova de conceito: integridade de agendamento e CPF

| | |
|---|---|
| **Hipótese** | O banco consegue garantir sozinho (a) horário único por profissional, (b) CPF único com busca indexada e (c) integridade de unidade/profissional — sem mudar o que a aplicação já faz |
| **Script** | `server/scripts/poc-integridade.js` (reexecutável) |
| **Ambiente** | MySQL 8.0.42, Node 24, Windows 11; banco descartável `saude_poc_tmp` criado e apagado pelo próprio script (o banco real não é tocado) |
| **Resultado** | **18/18 verificações passaram** — hipótese confirmada, com um limite conhecido |
| **Alimenta** | RFC-0001, ESPEC-001, ADR-0006/0007 |

Como rodar: `node server/scripts/poc-integridade.js` (usa as credenciais do `server/.env`; sai com código 1 se algo falhar).

## 1. B2 — Horário único por coluna gerada

Tabela de teste com `active_slot` gerada (`IF(status IN ('pendente','confirmado'), scheduled_at, NULL)`) e `UNIQUE (professional_id, active_slot)`.

| Verificação | Resultado |
|---|---|
| 2º agendamento no mesmo horário/profissional | recusado (`ER_DUP_ENTRY`) |
| Outro profissional, mesmo horário | aceito |
| Mesmo profissional, outro horário | aceito |
| Cancelar e marcar de novo no mesmo horário | aceito |
| Vários cancelados no mesmo horário | aceitos (`NULL` não colide) |
| **20 conexões simultâneas no mesmo horário, sem `FOR UPDATE`** | **1 aceita, 19 recusadas** |
| Horário parcialmente sobreposto (08:15 vs 08:00) | **passa** — limite: sobreposição por duração segue na aplicação |

Conclusão: o índice é uma rede de proteção correta contra duplicata exata e corrida; não substitui a regra de duração.

## 2. B3 — Índice cego (HMAC) para CPF cifrado

50.000 usuários fictícios (CPF de teste, não reais), CPF cifrado com AES-256-GCM e `cpf_hmac` com `UNIQUE`. Busca pelo **último** registro (pior caso da varredura).

| Medida | Resultado |
|---|---|
| Varredura + decifra (como `auth.routes.js:745` faz hoje) | **8.411,9 ms** |
| `WHERE cpf_hmac = ?` | **11,1 ms** (≈ 750× mais rápido) |
| Os dois encontram o mesmo usuário | sim |
| 2º cadastro com o mesmo CPF | recusado (`ER_DUP_ENTRY`) |
| CPF com pontuação × só dígitos | mesmo HMAC |
| Mesmo CPF cifrado duas vezes | textos diferentes (cifra continua não-determinística) |
| Backfill de linhas antigas | 2 linhas em 31 ms (decifra uma vez por linha) |

Observação: a varredura cresce linearmente com a base e roda a cada vínculo Gov.br; o índice é praticamente constante. Os 8,4 s incluem trazer 50 mil linhas e decifrar cada uma — número de ordem de grandeza, não um benchmark de produção.

## 3. B1 — FKs sobre tabela que já tem órfãos

| Verificação | Resultado |
|---|---|
| Consulta de auditoria acha o órfão | 1 de 4 linhas |
| `ADD FOREIGN KEY` com órfão presente | **falha** → a auditoria precisa vir antes |
| Após zerar os órfãos | FK e índice entram |
| `INSERT` com id inexistente | recusado |
| Apagar a unidade | agendamento preservado, `unit_id` vira `NULL` (`SET NULL`) |

## 4. Limites e o que a PoC não prova

- Usa tabelas simplificadas, não o `schema.sql` completo; a migração real deve ser ensaiada num dump do banco de produção.
- Não mede o custo do `UNIQUE` em tabelas grandes de agendamento nem o tempo do `ALTER` (MySQL 8 faz `ADD COLUMN` gerada `STORED` reescrevendo a tabela).
- Não testa a chave HMAC em cofre nem a rotação.
- `professional_id` `NULL` não é protegido pelo índice único.
- Não valida o impacto sobre os testes de corrida existentes (`server/test/race/`); fazer na implementação.

## 5. Próximos passos

Se a RFC-0001 for aprovada: ensaiar as três migrações num dump real, medir a duração do `ALTER`, e só então seguir a ESPEC-001.
