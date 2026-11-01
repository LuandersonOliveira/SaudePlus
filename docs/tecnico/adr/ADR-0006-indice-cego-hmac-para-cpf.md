# ADR-0006 — Índice cego (HMAC) para CPF cifrado

**Status:** **Aceita e implementada** em 2026-11-01 (B3: `migrate:cpf:hmac`, `utils/cpf.js`, `server/test/cpf-hmac.test.js`, 21 testes) · **Data:** 2026-11-01 · **Evidência:** POC-001 §2 · **Detalhe:** ESPEC-001 §3

## Contexto
CPF/RG/CNS são cifrados em coluna (AES-256-GCM, cifra não determinística — correto). Consequência: o banco não consegue procurar nem garantir unicidade por CPF. Hoje o vínculo Gov.br decifra todos os usuários para achar um CPF (8,4 s com 50 mil usuários na PoC) e o cadastro aceita o mesmo CPF duas vezes.

## Decisão
Adicionar `users.cpf_hmac CHAR(64)` com `UNIQUE`, igual a `HMAC-SHA256(CPF_HMAC_KEY, 11 dígitos)`. A chave HMAC é **distinta** da de cifra e fica fora do repositório e dos backups do banco. A busca e a unicidade usam só essa coluna; a cifra de coluna não muda.

## Como ficou
- `CPF_HMAC_KEY` (64 hex) é variável própria, exigida no boot (fail-closed, como a chave de cifra). Só com `ALLOW_PLAINTEXT_DEV=1` (`npm run dev`) ela é derivada, com aviso. O `doctor` recusa chave ausente, malformada ou igual à `DATA_ENCRYPTION_KEY`.
- Duplicatas existentes são **só relatadas** (ids, nunca o CPF): a migração para sem mesclar nem apagar contas. A decisão de mesclar é humana.
- Cadastro e `PUT /auth/me` gravam o índice junto do CPF; violação do `UNIQUE` vira 409 "CPF já cadastrado. Entre na conta existente ou recupere a senha." (não revela e-mail nem nome).
- Gov.br: `WHERE cpf_hmac = ?` e, no único candidato, `cpfIgual` sobre o CPF decifrado (o índice aponta; o dado cifrado decide).
- Anonimização LGPD zera `cpf_hmac`, liberando o CPF.
- Troca de chave: `npm --prefix server run migrate:cpf:rehash`.
- Menores: não usam o CPF do responsável. Menor de 18 pode se cadastrar sem CPF (então o CNS é obrigatório); `cpf_hmac` fica `NULL`, que não colide no `UNIQUE`. O responsável legal é registrado só pelo nome.

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
