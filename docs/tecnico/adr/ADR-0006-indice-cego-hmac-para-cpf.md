# ADR-0006 — Índice cego (HMAC) para CPF cifrado

**Status:** **Proposta** (aguarda RFC-0001) · **Data:** 2026-11-01 · **Evidência:** POC-001 §2 · **Detalhe:** ESPEC-001 §3

## Contexto
CPF/RG/CNS são cifrados em coluna (AES-256-GCM, cifra não determinística — correto). Consequência: o banco não consegue procurar nem garantir unicidade por CPF. Hoje o vínculo Gov.br decifra todos os usuários para achar um CPF (8,4 s com 50 mil usuários na PoC) e o cadastro aceita o mesmo CPF duas vezes.

## Decisão
Adicionar `users.cpf_hmac CHAR(64)` com `UNIQUE`, igual a `HMAC-SHA256(CPF_HMAC_KEY, 11 dígitos)`. A chave HMAC é **distinta** da de cifra e fica fora do repositório e dos backups do banco. A busca e a unicidade usam só essa coluna; a cifra de coluna não muda.

## Alternativas
- **Cifra determinística do CPF** — permite `UNIQUE` direto, mas expõe igualdade em todas as linhas e enfraquece a cifra; rejeitada.
- **Hash simples (SHA-256) do CPF** — CPF tem só 10⁹ possibilidades: um dump do banco permite inverter por força bruta em minutos; o HMAC com chave secreta evita isso.
- **Status quo** — duplicidade possível e busca O(N).

## Consequências
- (+) Busca ≈ 750× mais rápida (11 ms vs 8,4 s na PoC); duplicidade impedida sob concorrência.
- (+) Sem a chave, o dado não é invertível nem comparável.
- (−) Nova chave a gerir (cofre, rotação com backfill `--rehash`); vazamento da chave permite confirmar CPFs candidatos.
- (−) Dado derivado novo: atualizar ROPA/RIPD. Anonimização precisa zerar a coluna.
- (−) Migração exige resolver duplicatas existentes antes do `UNIQUE`.
