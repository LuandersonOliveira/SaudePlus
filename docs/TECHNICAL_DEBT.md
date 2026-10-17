# Dívida técnica conhecida

Achados da auditoria que **não** foram corrigidos nesta rodada de estabilização
(CRITICAL + HIGH) e na Fase 5 (os "respondeu sucesso e não fez nada"). Estão
aqui para ninguém redescobrir: cada um tem gravidade, local e o risco concreto.
Nenhum bloqueia o uso do sistema; todos são candidatos naturais a uma próxima
fase.

A numeração de linha refere-se ao commit em que a lista foi escrita e vai
derivar — o símbolo/trecho descrito é o que importa.

## Corrigidos na Fase 5 (2026-10-16)

| Onde era | Achado | Como ficou |
|---|---|---|
| `admin.professionals.routes.js` (vínculos) | `INSERT IGNORE` devolvia **201** com id que não existia; auditoria registrava criação inexistente | INSERT sem IGNORE; duplicata é **409** e nada é auditado |
| `units.routes.js` (serviços) | mesmo defeito em `unit_offers` | idem |
| `admin.routes.js` (`/stats`, `/export/summary.csv`) | `SUM()` sobre tabela vazia devolvia `null` — painel mostrava "null"; CSV saía com `null` na célula | `COALESCE(SUM(...), 0)` + `utils/stats.js` (`normalizeCounts`) como segunda parede |
| `admin.professionals.routes.js` | `TIME_RE` aceitava `99:99` e `12:99` — passava o INSERT, o MySQL reclamava e a rota devolvia **500**; o horário sumia dos filtros de disponibilidade | `cleanTime` valida hora/minuto e devolve `400` com mensagem |
| `admin.routes.js` | `GET /users` duplicado com `admin.users.routes.js`; o mount da linha 93 vem antes, então era código morto | Rota morta removida, com nota explicando por quê |
| `auth.routes.js` (`/auth/mfa/verify`) | Mesmo código TOTP aceito quantas vezes quisesse na janela de 90s; sem contador de tentativas | `users.totp_last_step` + `utils/mfaAttempts.js` (5 por conta) |
| `utils/audit.js` (`logAction`) | Duas escritas simultâneas liam a mesma cabeça da cadeia (sem gap lock no fim do índice) e as duas gravavam | `GET_LOCK('saudeplus:audit-chain')` como mutex |
| `utils/audit.js` (`verifyChain`) | Exigia adjacência por `seq`; salto de AUTO_INCREMENT (transação que rolou back) era lido como adulteração | Percorre o encadeamento por hash a partir de GENESIS |
| `test:race` | deixava bancos `saude_race_*` órfãos quando o processo morria | `before` varre os órfãos antes de criar o seu |

## MEDIUM — correção funcional, sem risco de segurança

| Onde | Achado | Risco |
|---|---|---|
| `booking.js` (`fetchBusyIntervals`) | Duração de 30 min está fixa no cálculo de **conflito**, enquanto `work_schedules.slot_minutes` aceita 5–240. O candidato novo usa a duração certa (booking.js:196), mas os **já existentes** são tratados como 30 min | Só morde quando o mesmo profissional tem dois `work_schedules` **sobrepostos no mesmo dia com `slot_minutes` diferentes** (ex.: 08:00–12:00 de 60 min e 09:00–17:00 de 30 min): um agendamento de 60 min às 09:00 libera as 09:30, que a grade de 30 min oferece. Com uma grade só, o problema fica mascarado. **Resolver** persistindo a duração (ou a unit_id + horário que a define) e usando-a ao montar os intervalos ocupados. |
| `booking.js` (`findAvailabilityByService`) | Um horário com 2 profissionais disponíveis é reportado como 1 vaga; `totalVagas` subconta | O usuário vê "1 vaga" e escolhe por engano, ou desiste de um horário que tem 2 profissionais. |
| `privacy.js` (anonimização LGPD) | A anonimização roda em 4 statements independentes, sem transação | Uma falha no meio deixa o usuário parcialmente anonimizado — o pior estado possível num pedido de LGPD: os dados somem sem o registro de exclusão. **Resolver** dentro de transação. |
| `auth.routes.js` (fallback CPF Gov.br) | Faz `SELECT * FROM users` e compara CPF com `===` | Compara o usuário inteiro e **não é timing-safe**. **Resolver** `SELECT cpf` + `timingSafeEqual`. |
| `admin.routes.js` (auditoria) | Lê `audit_log` com `INNER JOIN users`, que oculta linhas órfãs; `verifyChain` não usa join | A tela e o verificador discordam: o verificador acusa cadeia íntegra e a lista mostra menos linhas. **Resolver** `LEFT JOIN` e exibir o órfão marcado. |

## Pendente de decisão do usuário

**A `audit_log` do banco de desenvolvimento tem uma bifurcação na linha 156**
(`71cf732d-29fe-4a52-95c6-0fc813ce49df`, de 2026-10-16 22:08, gravada antes do
mutex `GET_LOCK`). A partir dali, duas linhas compartilham o mesmo elo.

`audit_log` é append-only por trigger (`trg_audit_no_update` /
`trg_audit_no_delete`), então consertar exigiria **reescrever a trilha** — que é
exatamente o que a trigger existe para impedir. As saídas possíveis:

1. Deixar como está. O verificador aponta a divergência corretamente, e isso é
   honesto: a trilha realmente tem uma bifurcação.
2. Reconstruir a base de desenvolvimento (`npm run db:setup -- --fresh saude`),
   perdendo os dados de teste.
3. Manter uma tabela de correções de auditoria para casos como esse.

**Nenhuma foi feita** — reescrever log de auditoria não é decisão de agente.

## MEDIUM — endurecimento de segurança

| Onde | Achado | Risco |
|---|---|---|
| `auth.routes.js` / `totp.js` | TOTP sem proteção de replay e `/mfa/verify` sem contador de tentativas | Um código TOTP válido (30s de janela) pode ser reapresentado dentro dessa janela, e o endpoint aceita tentativas ilimitadas. **Resolver** guardar o último código usado + lockout por verificação. |
| `admin.html`, `atendente.html` | `esc()` não cobre `onclick` com aspas duplas em vários pontos | XSS residual: um dado do banco com aspeto de atributo ainda escapa do atributo. |

## LOW / dívida de produto

- **Recuperação de senha** ("esqueci minha senha") não existe — o usuário que
  esquece a senha perde a conta.
- **Envio real dos lembretes**: o job monta e persiste a linha, mas não envia
  e-mail/SMS/WhatsApp.
- **Lint/CI**: não há `eslint` nem pipeline; a suíte `npm test` é o portão.
- **E2E automatizado**: a cobertura é de contrato no servidor + verificação
  estática do front. Não há navegador de verdade no pipeline.

---

Achados CRITICAL e HIGH corrigidos nesta rodada estão no
[plano de estabilização](superpowers/plans/2026-10-16-saudeplus-estabilizacao.md)
e no histórico de commits (`git log --oneline`).