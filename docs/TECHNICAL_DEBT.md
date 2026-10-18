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

## Fechado sem mudança de código: não era explorável

| Onde era | Achado | O que a verificação mostrou |
|---|---|---|
| `admin.html`, `atendente.html` | "`esc()` não cobre `onclick` com aspas duplas (XSS residual)" | **Falso positivo.** Duas camadas: (1) desde a Task 5 não existe mais `esc()` interpolado dentro de `onclick="…"` — o dado vai em `data-attribute` e um listener delegado lê; (2) `esc()` escapa `"` → `&quot;`, que é decodificado depois de o limite do atributo estar definido, então não abre aspas. Teste em `escaping.test.js` renderiza o botão com `x" onmouseover="alert(1)" x="` usando o `esc()` extraído da página de verdade, e confirma que o botão tem exatamente as duas aspas do atributo. Nenhum código alterado — mudar algo aqui seria mexer em código correto. |

## Fechado na revisão (2026-10-16, pós-fases)

Achados que a revisão do trabalho encontrou e que foram corrigidos. Estão aqui
porque o **porquê** de cada decisão é o que evita a reintrodução.

| Onde era | Achado | Como ficou |
|---|---|---|
| `scripts/db-setup.js` | Lista própria de 6 migrations enquanto `migrate:all` tinha 8 — `npm run db:setup` imprimia "Pronto." sem criar as colunas novas | Lista **derivada** do `package.json`; teste de paridade |
| `scripts/doctor.js` | Não conhecia `totp_last_step` / `duration_minutes`: dizia "Ambiente pronto" na base quebrada | As três colunas na lista + teste que compara com o `schema.sql` |
| `scripts/doctor.js` | Conectava num banco e **conferia outro** (`db.js` lê `process.env`; a checagem usava o valor do arquivo) | Precedência unificada: ambiente vence o `.env`, como no `db-setup` |
| `booking.js` | `duration_minutes` sem fallback → 500 em todo agendamento | Boot **recusa** subir (degradar devolveria sobreposição silenciosa) |
| `auth.routes.js` (`/auth/mfa/verify`) | Replay de TOTP por ler→comparar→gravar: duas requisições simultâneas abriam duas sessões | UPDATE condicional (`WHERE totp_last_step < ?`) + `affectedRows` |
| `auth.routes.js` (`/auth/mfa/verify`) | Replay contava como tentativa errada: duplo clique trancava por 5 min | Só código **errado** conta; replay responde 401 |
| `app.js` (`/ready`) | Público, sem rate limit, com `SELECT 1` a cada chamada → esgotamento de pool | `readinessLimiter` (60/min); `/health` fora do limite |
| `auth.routes.js` (`PUT /auth/me`) | Sem validação de tamanho: `state: "São Paulo"` → **500** | `LIMITES_CAMPO` por coluna + 400; teste compara com o schema |
| `server.js` / `utils/crypto.js` | Fail-closed só com `NODE_ENV=production`, que **nada** no projeto definia | Padrão fechado; liberação explícita por `ALLOW_PLAINTEXT_DEV` |
| `test/race/audit-chain-race.test.js` | Escrevia 24 linhas permanentes na `audit_log` de desenvolvimento | Banco descartável, como o `booking-race` |
| `utils/validators.js` | Listas de ENUM copiadas à mão do schema, sem verificação | Teste de paridade com os ENUMs do `schema.sql` |
| Testes de MFA | `.catch(() => {})` escondia que o `DELETE` do usuário nunca funcionava (FK `audit_log` é RESTRICT) | Comentário explicando; `.catch` só engole `ER_ROW_IS_REFERENCED_2` |
| `admin.html` / `atendente.html` | "XSS residual em onclick com aspas duplas" | **Falso positivo** — testado e fechado sem tocar em código |

## MEDIUM — correção funcional, sem risco de segurança

| Onde | Achado | Risco |
|---|---|---|
| `booking.js` (`findAvailabilityByService`) | Um horário com 2 profissionais disponíveis é reportado como 1 vaga; `totalVagas` subconta | O usuário vê "1 vaga" e escolhe por engano, ou desiste de um horário que tem 2 profissionais. |
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