# ADR-0008 — Migrations numeradas com tabela de controle

**Status:** **Proposta** · **Data:** 2026-11-01 · **Origem:** A3 da análise (Fase 6)

## Contexto
O banco é montado por `schema.sql` (união de tudo) + 14 scripts `migrate-*.js` idempotentes, executados todos, em ordem fixa, a cada `db:setup`. Não existe registro de quais já rodaram nem como desfazer. O teste `schema-parity` reduz o risco de divergência, mas depende de alguém atualizar os dois lados. As mudanças da RFC-0001 (3 migrações com rollback) tornam isso mais crítico.

## Decisão
Migrations numeradas (`NNN_descricao.sql` com `up` e `down`) executadas por um runner mínimo que grava em `schema_migrations(version, applied_at, checksum)`. O `schema.sql` vira o estado resultante da última migration (gerado/validado pelo `schema-parity`). Os 14 scripts atuais são convertidos para a numeração **sem mudar o resultado**.

## Alternativas
- **Ferramenta pronta** (ex.: `umzug`, `db-migrate`, Flyway) — menos código próprio, mais uma dependência e convenções externas.
- **Status quo** — sem estado, sem rollback, sem auditoria de versão.
- **ORM com migrations (Prisma/Knex)** — mudaria o acesso a dados inteiro; fora de proporção.

## Consequências
- (+) Sabe-se a versão de cada banco; rollback possível; deploy repetível.
- (+) Habilita as migrações da RFC-0001 com segurança.
- (−) Trabalho de conversão dos 14 scripts e de bancos existentes (marcar como já aplicados na primeira execução — "baseline").
- (−) Runner próprio de ~50 linhas para manter (ou adotar ferramenta e aceitar a dependência).
