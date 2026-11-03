# Architecture Decision Records (ADR)

Cada ADR registra **uma** decisão: contexto, decisão, alternativas, consequências. Formato curto (estilo Nygard). Um ADR aceito não é editado: se a decisão mudar, cria-se outro que o **substitui**.

Status possíveis: **Proposta** → **Aceita** → (**Substituída por ADR-NNNN** | **Rejeitada**).

| ADR | Decisão | Status | Data |
|---|---|---|---|
| [0001](ADR-0001-front-react-vite-shadcn.md) | Front em React + Vite + TypeScript + shadcn/ui | Aceita | 2026-10 |
| [0002](ADR-0002-origem-unica-express-serve-front.md) | Origem única: Express serve `web/dist` e a API fica em `/api` | Aceita | 2026-11-01 |
| [0003](ADR-0003-aposentar-front-html-legado.md) | Aposentar o front HTML legado | Aceita | 2026-11-01 |
| [0004](ADR-0004-e2e-sessao-por-api.md) | E2E com sessão criada por API e conta de atendente efêmera | Aceita | 2026-11-01 |
| [0005](ADR-0005-credenciais-de-admin-so-superadmin.md) | E-mail e senha de conta admin só mudam por `superadmin` | Aceita | 2026-10 |
| [0006](ADR-0006-indice-cego-hmac-para-cpf.md) | Índice cego (HMAC) para CPF cifrado | **Aceita e implementada** | 2026-11-01 |
| [0007](ADR-0007-integridade-no-banco-fk-e-horario-unico.md) | Integridade no banco: FKs e horário único por coluna gerada | **Aceita e implementada** | 2026-11-01 |
| [0008](ADR-0008-migrations-numeradas-com-controle.md) | Migrations numeradas com tabela de controle | **Aceita e implementada** | 2026-11-01 |
| [0009](ADR-0009-eliminacao-unica-de-conta-por-anonimizacao.md) | Eliminação de conta é uma só: anonimização completa | Aceita (não implementada) | 2026-11-01 |
| [0010](ADR-0010-mfa-obrigatorio-para-atendente-e-admin.md) | Segundo fator obrigatório para atendente e admin | Aceita (não implementada) | 2026-11-01 |
| [0011](ADR-0011-refresh-token-so-em-cookie-httponly.md) | Refresh token só em cookie HttpOnly; access token em memória | **Aceita e implementada** | 2026-11-03 |
| [0012](ADR-0012-auditoria-sem-dado-pessoal-e-lembrete-lido.md) | Auditoria sem dado pessoal e lembrete com marcar como lido | Aceita (não implementada) | 2026-11-01 |

Relacionados: `../rfc/RFC-0001-…`, `../especificacao/ESPEC-001-…`, `../poc/POC-001-…`, `../PROS_E_CONTRAS.md`.

Modelo para novos ADRs:

```markdown
# ADR-NNNN — Título no imperativo curto
Status · Data · Decisores
## Contexto      (forças em jogo, restrições)
## Decisão       (o que faremos, em uma frase firme)
## Alternativas  (o que descartamos e por quê)
## Consequências (positivas, negativas, o que muda a partir de agora)
```
