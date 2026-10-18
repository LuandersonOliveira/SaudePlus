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
| `booking.js` + `dashboard.html` | Horário com 2 profissionais livres mostrava só o primeiro; o POST mandava o `professional_id` dele | **Falso positivo no `totalVagas`** — a contagem é de *horários*, e o front já escrevia "horário(s) livre(s)". O defeito real era outro: o segundo profissional era descartado em silêncio, e se o primeiro fosse ocupado entre listar e enviar o POST devolvia 409 sem saída. **Corrigido** — o slot carrega `professionals[]`, o painel achata hora × profissional em um botão cada. |
| `auth.routes.js` (fallback CPF Gov.br) | `SELECT * FROM users WHERE cpf IS NOT NULL` + comparação com `===` dentro de `Array.find` | Três defeitos: a comparação sai no primeiro byte diferente (tempo reconstrói o CPF), o `find` parava no primeiro acerto (tempo dependia da posição), e o `SELECT *` trazia `password_hash` de toda a base a cada tentativa. **Corrigido** — `utils/cpf.js` com `timingSafeEqual` sobre 11 dígitos, varredura sem `break`, e `SELECT id, cpf` seguido de uma busca pelo índice. |

## MEDIUM — correção funcional, sem risco de segurança

_Todos os achados desta seção foram corrigidos._

| Onde | Achado | Risco |
|---|---|---|
| `admin.routes.js` (auditoria) | Lê `audit_log` com `INNER JOIN users`, que oculta linhas órfãs; `verifyChain` não usa join | A tela e o verificador discordam: o verificador acusa cadeia íntegra e a lista mostra menos linhas. **Corrigido** — `LEFT JOIN` + `actor_missing`, e o painel mostra "Usuário removido". |

## MEDIUM — endurecimento de segurança

_Todos os achados desta seção foram corrigidos._

| Onde | Achado | Risco |
|---|---|---|
| `auth.routes.js` (`/auth/refresh`) | A doc sugeria "teto de tentativas por família". **A recomendação estava errada** — o defeito real era outro | Um teto por contagem derrubaria sessões legítimas: o access token expira em 15 min, e um usuário ativo rotaciona ~2.900 vezes em 30 dias. O que permitia "rotacionar indefinidamente" era o **prazo deslizante**: cada rotação emitia `now + 30d`, então a família nunca expirava, e o cookie httpOnly repetia `maxAge: 30d`. Um par roubado vivia para sempre e o titular legítimo nunca percebia. **Corrigido** — a rotação preserva o prazo absoluto da família (`MIN(expires_at)` da família = prazo do token original) e o cookie usa o restante desse prazo. OAuth 2.0 BCP §4.14.2. |
| `server/src/utils/audit.js` | Se `GET_LOCK` não for concedido em 5s, a escrita prossegue sem o mutex | A trilha pode bifurcar de novo sob carga. O caminho é deliberado — perder registro é pior que gravar fora de ordem — mas o único sinal era um `console.warn`. **Corrigido** — `GET /ready` passou a expor `audit_lock: { ok, falhas, ultimaFalhaEm }`, que é o que um monitor observa. O `AUDIT_LOCK` ganhou override por `AUDIT_LOCK_NAME` só para os testes. |

> Os dois achados de segurança que **estavam** aqui foram corrigidos e estão
> na tabela "Fechado na revisão": replay de TOTP (`c9a0271`, `e4068d3`) e o
> XSS residual em `onclick`, que se provou falso positivo (`cc26cca`). Eles
> permaneceram nesta tabela até a revisão de 2026-10-16 e só saíram agora,
> depois de confirmados contra o código.

## LOW / dívida de produto

- **Recuperação de senha** ("esqueci minha senha") não existe — o usuário que
  esquece a senha perde a conta.
- **Envio real dos lembretes**: o job monta e persiste a linha, mas não envia
  e-mail/SMS/WhatsApp.
- **Lint/CI**: não há `eslint` nem pipeline; a suíte `npm test` é o portão.

### E2E automatizado — resolvido (2026-10-18)

A cobertura era de contrato no servidor + verificação estática do front.
Nenhuma das duas abre uma página, então a lacuna era exatamente a que o
usuário vê: botão que não faz nada por erro de sintaxe no script, `onclick`
apontando para função renomeada, painel que carrega e trava ao renderizar.

`npm run test:e2e` (Playwright + Chromium) cobre login dos papéis, sessão
sobrevindo a reload, logout, guarda de painel sem sessão, a URL única e a
abertura dos painéis sem erro de JS nem resposta 4xx. Sobe o `dev` sozinho.

O que o navegador encontrou que nenhuma outra camada via:

- `dashboard.html:880` manda o admin para o painel administrativo — a regra
  existia no código sem nenhum teste; agora está travada.
- Um teste que falhou por **corrida sua**, não por defeito: `page.goto()`
  logo após clicar em Entrar aborta o POST em voo, o painel abre sem sessão
  e `requireAuth()` joga para o login. O `entrar()` agora espera a resposta.

Continua pendente: E2E de **agendamento** (criar consulta de ponta a ponta) e
de outros papéis, que dependem do seed demo.

---

Achados CRITICAL e HIGH corrigidos nesta rodada estão no
[plano de estabilização](superpowers/plans/2026-10-16-saudeplus-estabilizacao.md)
e no histórico de commits (`git log --oneline`).