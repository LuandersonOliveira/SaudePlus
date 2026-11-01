# ESPEC-001 — Especificação técnica: FKs, horário único e índice cego de CPF

| | |
|---|---|
| **Status** | Rascunho para implementação (depende da aprovação da RFC-0001) |
| **Escopo** | `server/schema.sql`, novas migrations, `routes/auth.routes.js`, `utils/booking.js`, `utils/cpf.js`, `scripts/doctor.js`, testes |
| **Verificado em** | MySQL 8.0.42 (PoC-001). Geração de coluna `STORED` + `UNIQUE` exige MySQL ≥ 5.7.6 |

## 1. Requisitos

| ID | Requisito |
|---|---|
| R1 | `appointments.unit_id/professional_id` e `exams.unit_id/professional_id` referenciam `health_units`/`professionals` |
| R2 | Apagar unidade/profissional não apaga nem bloqueia o histórico: o vínculo vira `NULL` |
| R3 | Consultas por unidade usam índice |
| R4 | Dois registros **ativos** (`pendente`/`confirmado`) do mesmo profissional no mesmo `scheduled_at` são impossíveis, mesmo sob concorrência |
| R5 | Registros `cancelado`/`concluido`/`para_remarcar` não ocupam horário |
| R6 | Um CPF (11 dígitos normalizados) pertence a no máximo um usuário |
| R7 | A busca por CPF não decifra linhas |
| R8 | Nenhuma mudança de contrato HTTP além de 2 mensagens 409 |

Fora do escopo: sobreposição por duração (continua em `utils/booking.js`), mesclagem automática de contas, separação da tabela `users`.

## 2. Modelo de dados

```sql
-- B1 (por tabela: appointments e exams)
ALTER TABLE appointments
  ADD INDEX idx_appointments_unit_scheduled (unit_id, scheduled_at),
  ADD CONSTRAINT fk_appointments_unit_ref FOREIGN KEY (unit_id) REFERENCES health_units (id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_appointments_prof_ref FOREIGN KEY (professional_id) REFERENCES professionals (id) ON DELETE SET NULL;

-- B2
ALTER TABLE appointments
  ADD COLUMN active_slot DATETIME
    GENERATED ALWAYS AS (IF(status IN ('pendente','confirmado'), scheduled_at, NULL)) STORED,
  ADD UNIQUE KEY uq_appointments_prof_active_slot (professional_id, active_slot);

-- B3
ALTER TABLE users
  ADD COLUMN cpf_hmac CHAR(64) NULL,
  ADD UNIQUE KEY uq_users_cpf_hmac (cpf_hmac);
```

Notas:
- `professional_id`/`unit_id` NULL não participam do `UNIQUE` (comportamento padrão do MySQL) — ver risco na RFC.
- Anonimização LGPD (`DELETE /auth/me`) deve **zerar** `cpf` e `cpf_hmac`; senão o CPF anonimizado continuaria bloqueando novo cadastro.
- Remover os índices redundantes `idx_appointments_user` e `idx_exams_user` na mesma migração (B6).

## 3. Algoritmo do índice cego

```
cpf_hmac = hex( HMAC_SHA256( CPF_HMAC_KEY, apenas_dígitos(cpf) ) )     -- 64 caracteres
```

- `CPF_HMAC_KEY`: 32 bytes aleatórios, variável de ambiente **nova**, distinta de `DATA_ENCRYPTION_KEY`. Ausente → o servidor recusa subir em produção (mesma regra da chave de cifra); em dev local usa o modo `ALLOW_PLAINTEXT_DEV` já existente.
- Implementação em `utils/cpf.js` (`hmacCpf(cpf)`), junto de `cpfIgual` (a comparação em tempo constante permanece para conferir o resultado do índice).
- Apenas CPFs válidos de 11 dígitos geram HMAC; vazio/inválido → `NULL`.

## 4. Mudanças por arquivo

| Arquivo | Mudança |
|---|---|
| `server/schema.sql` + novas `migrate-*.js` | Colunas/índices/FKs acima, idempotentes (`information_schema` antes de `ALTER`) |
| `routes/auth.routes.js` (signup, ~211) | Gravar `cpf_hmac`; capturar `ER_DUP_ENTRY` do `uq_users_cpf_hmac` → 409 "CPF já cadastrado. Entre na conta existente ou recupere a senha." (mensagem não revela e-mail nem nome) |
| `routes/auth.routes.js` (perfil, ~962) | Recalcular `cpf_hmac` junto de `cpf`; mesmo 409 |
| `routes/auth.routes.js` (Gov.br, ~745) | Trocar `SELECT id, cpf …` + `acharPorCpf` por `WHERE cpf_hmac = ?` |
| `utils/booking.js` | Capturar `ER_DUP_ENTRY` de `uq_*_prof_active_slot` → 409 "Horário já ocupado." (mesma resposta do conflito detectado pelo `FOR UPDATE`) |
| `routes/auth.routes.js` (exclusão LGPD) / `utils/privacy.js` | Zerar `cpf_hmac` |
| `scripts/doctor.js` | Incluir `users.cpf_hmac`, `appointments.active_slot`, `exams.active_slot` em `COLUNAS_ESPERADAS` |
| `server/.env.example`, README | Documentar `CPF_HMAC_KEY` |
| `docs/governanca/ROPA.md`, `RIPD.md` | Registrar a nova coluna derivada |

## 5. Migração (expand → backfill → contract)

1. **Auditoria (somente leitura)** — gerar três relatórios e parar se algum não estiver vazio:
   - órfãos: `unit_id`/`professional_id` sem pai (consulta validada no PoC);
   - horários ativos duplicados por `(professional_id, scheduled_at)`;
   - CPFs duplicados (decifrando uma vez, agrupando por HMAC calculado em memória).
2. **Expand** — criar colunas (`cpf_hmac`, `active_slot`) sem `UNIQUE` ainda.
3. **Backfill** — `cpf_hmac` em lotes (decifra, calcula, `UPDATE`); idempotente (`WHERE cpf_hmac IS NULL AND cpf IS NOT NULL`).
4. **Resolver pendências** do passo 1 (decisão humana para duplicatas).
5. **Contract** — criar os `UNIQUE` e as FKs.
6. Deploy do código novo **antes** do passo 5 (o código tolera coluna sem `UNIQUE`); `UNIQUE`/FK por último.

Rollback: `DROP INDEX/DROP FOREIGN KEY/DROP COLUMN` na ordem inversa; o código novo continua funcionando sem os índices (apenas perde a rede de proteção).

## 6. Casos de borda

| Caso | Comportamento |
|---|---|
| Cancelar e remarcar para o mesmo horário | Permitido (cancelado vira `NULL` no `active_slot`) |
| Remarcar (`PATCH`) para horário ocupado | `ER_DUP_ENTRY` → 409, sem perder o registro original |
| Duas requisições simultâneas ao mesmo horário | Uma vence, a outra recebe 409 (medido: 1 de 20) |
| CPF digitado com pontuação | Mesmo HMAC (normalização) |
| Usuário sem CPF | `cpf_hmac` NULL; vários permitidos |
| Troca da `CPF_HMAC_KEY` | Rodar o backfill em modo `--rehash` (recalcula tudo) numa janela |

## 7. Testes necessários

- **Servidor (novos):** FK (id inexistente recusado; apagar unidade zera o vínculo); horário único (duplicado, cancelado liberando, corrida de N conexões); CPF duplicado no signup e no perfil; Gov.br localizando por HMAC; anonimização liberando o CPF; migração idempotente (rodar duas vezes); paridade `schema.sql` × migrations (`schema-parity` existente).
- **Front React:** mensagens 409 exibidas nos formulários de cadastro e de agendamento (já tratam `ApiError` 4xx; acrescentar teste do texto).
- **E2E:** cadastro com CPF repetido mostra o erro.

## 8. Critérios de pronto

Suíte do servidor, Vitest e Playwright verdes; relatórios de auditoria vazios em produção; `npm run doctor` verde; ROPA/RIPD atualizados; PoC reexecutável (`node server/scripts/poc-integridade.js`) segue 18/18.
