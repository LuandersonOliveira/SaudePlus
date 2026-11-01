# ADR-0007 — Integridade no banco: FKs e horário único por coluna gerada

**Status:** **Aceita e implementada** — itens 1 (FKs + índice, B1, `2b51368`) e 2–3 (horário único, B2: `active_slot` + `UNIQUE`, migration 0005, `horario-unico.test.js`, 18 testes) feitos em 2026-11-01 · **Data:** 2026-11-01 · **Evidência:** POC-001 §1 e §3 · **Detalhe:** ESPEC-001 §2

## Contexto
`appointments`/`exams` só têm FK para `user_id`. `unit_id`/`professional_id` aceitam ids inexistentes e não há índice em `unit_id`. A exclusividade de horário depende de `SELECT … FOR UPDATE` e de testes de corrida: eficaz, mas nenhum mecanismo impede um novo caminho de escrita de esquecê-lo.

## Decisão
1. FKs `ON DELETE SET NULL` de `unit_id`/`professional_id` + `INDEX (unit_id, scheduled_at)`.
2. Coluna gerada `active_slot = IF(status IN ('pendente','confirmado'), scheduled_at, NULL)` e `UNIQUE (professional_id, active_slot)`.
3. O `FOR UPDATE` e a validação de duração permanecem na aplicação; o banco é a segunda barreira, não a única.

## Alternativas
- **Só aplicação (status quo)** — sem rede de proteção.
- **`UNIQUE (professional_id, scheduled_at)` simples** — cancelados e remarcados ocupariam o horário para sempre.
- **`ON DELETE RESTRICT`/`CASCADE`** — RESTRICT trava limpezas; CASCADE apagaria histórico clínico. `SET NULL` preserva o registro (a "foto" textual `location/doctor` continua).
- **Exclusion constraint por intervalo** (como no PostgreSQL) — não existe no MySQL; sobreposição por duração fica na aplicação.

## Consequências
- (+) Duplicata exata e corrida são impossíveis no banco (PoC: 1 de 20 conexões vence).
- (+) Consultas por unidade usam índice; ids órfãos deixam de existir.
- (−) `professional_id` NULL não é protegido; sobreposição parcial segue na aplicação.
- (−) `ALTER` com coluna gerada `STORED` reescreve a tabela (medir num dump real).
- (−) Requer limpeza prévia de órfãos e de duplicatas de horário ativas.
