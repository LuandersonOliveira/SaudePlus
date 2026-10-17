# Dívida técnica conhecida

Achados da auditoria que **não** foram corrigidos nesta rodada de estabilização
(CRITICAL + HIGH). Estão aqui para ninguém redescobrir: cada um tem gravidade,
local e o risco concreto. Nenhum bloqueia o uso do sistema; todos são
candidatos naturais a uma próxima fase.

A numeração de linha refere-se ao commit em que a lista foi escrita e vai
derivar — o símbolo/trecho described é o que importa.

## MEDIUM — correção funcional, sem risco de segurança

| Onde | Achado | Risco |
|---|---|---|
| `app.js` (mount) vs `admin.routes.js` | `GET /admin/users` existe nos dois arquivos; o mount de `admin.users.routes.js` sombreia a rota de `admin.routes.js`, que fica código morto | Alterar a rota "errada" não muda nada, sem erro visível. **Resolver** movendo o handler para `admin.users.routes.js` ou removendo o duplicado. |
| `booking.js` (conflito de horário) | Duração de 30 min está fixa no cálculo de conflito, enquanto `work_schedules.slot_minutes` aceita 5–240 | Um agendamento de 60 min **não bloqueia** o slot das 09:30. O profissional fica com dois compromissos sobrepostos. **Resolver** lendo `slot_minutes` do profissional. |
| `booking.js` (`findAvailabilityByService`) | Um horário com 2 profissionais disponíveis é reportado como 1 vaga; `totalVagas` subconta | O usuário vê "1 vaga" e escolhe por engano, ou desiste de um horário que tem 2 profissionais. |
| `admin.routes.js` (stats) | `SUM()` sobre tabela vazia devolve `null`, e `/admin/stats` expõe `pending: null` | O front espera número e formata `null` como vazio/`NaN` em alguns cards. **Resolver** com `COALESCE(SUM(...), 0)`. |
| `privacy.js` (anonimização LGPD) | A anonimização roda em 4 statements independentes, sem transação | Uma falha no meio deixa o usuário parcialmente anonimizado — o pior estado possível num pedido de LGPD: os dados some sem o registro de exclusção. **Resolver** dentro de transação. |
| `auth.routes.js` (fallback CPF Gov.br) | Faz `SELECT * FROM users` e compara CPF com `===` | Compara todo o usuário inteiro e **não é timing-safe**. Além disso carrega colunas que não precisa. **Resolver** `SELECT cpf` + `timingSafeEqual`. |
| `admin.professionals.routes.js`, `units.routes.js` | `INSERT IGNORE` devolve `201 Created` com um id que não foi persistido | O front recebe 201 e mostra o profissional na lista; ele nunca existiu. **Resolver** checar `affectedRows` e devolver `200`/`409`. |
| `admin.professionals.routes.js` | `TIME_RE` aceita `99:99` | Horário inválido entra no banco e não aparece em nenhum filtro. **Resolver** validar hora/minuto separadamente. |
| `admin.users.routes.js` | `const SELF_RANK = 4` declarado e nunca usado | Ruído que sugere uma regra de hierarquia que não existe. Remover. |
| `admin.routes.js` (auditoria) | Lê `audit_log` com `INNER JOIN users`, que oculta linhas órfãs; `verifyChain` não usa join | A tela e o verificador discordam: o verificador acusa cadeia íntegra e a lista mostra menos linhas. **Resolver** `LEFT JOIN` e exibir o órfão marcado. |
| CSS (modais) | Modais declaram `aria-modal="true"` sem focus trap, sem restaurar foco e sem `tabindex="-1"` | Leitor de tela anuncia um diálogo que o teclado não consegue atravessar; `Esc` fecha, `Tab` sai do modal para a página de trás. |
| CSS (tabelas de histórico) | Tabelas sem wrapper de scroll horizontal | Em telas ≤400px a página inteira rola na horizontal. **Resolver** com wrapper `overflow-x:auto`. |

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