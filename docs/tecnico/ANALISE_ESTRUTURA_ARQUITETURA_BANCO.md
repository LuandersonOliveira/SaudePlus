# Análise de estrutura, arquitetura e banco de dados (Fase 6)

Data: 2026-11-01 · Branch `stabilize/fase-0-1` · Base: leitura do código, `schema.sql`, suíte de testes e execução real (e2e com banco descartável).
Complementa `TECHNICAL_DEBT.md` (que lista defeitos já fechados) com a visão estrutural. Cada achado traz **evidência** (arquivo/linha ou medição) e **ação sugerida**. Nada aqui foi alterado no código, exceto o que está marcado como *feito*.

## 1. Retrato do projeto

| Parte | Tecnologia | Tamanho | Testes |
|---|---|---|---|
| `server/` API | Node 24, Express 4, mysql2, Zod (1 arquivo), Nodemailer | ~7,6 mil linhas em `src/` | 62 arquivos / ~11 mil linhas (425 casos, `node --test`) |
| `web/` front novo | React 19, Vite 8, TypeScript, Tailwind v4, shadcn/ui, React Query | ~160 arquivos | 336 casos (Vitest) |
| `e2e/` | Playwright (Chromium) contra `npm run dev` | 4 specs / 28 testes | — |
| raiz (legado) | 6 páginas HTML + `assets/` JS/CSS puros | `admin.html` ≈ 2,8 mil linhas | cobertos por testes estáticos no `server/test` |
| Banco | MySQL, 16 tabelas | `schema.sql` 542 linhas + 14 scripts `migrate-*.js` | `schema-parity`, `boot-schema-guard`, `db-setup` |

Pontos fortes (preservar): auditoria encadeada por hash; documentos (CPF/RG/CNS) cifrados em repouso; MFA TOTP com anti-replay; RBAC por capability testado; rate limit com teto próprio no `/ready`; testes de corrida de agendamento; dívida técnica documentada; paridade `schema.sql` × migrations testada.

## 2. Estrutura e arquitetura do backend

### A1 — Rotas "gordas", SQL direto na camada HTTP (média)
`routes/auth.routes.js` tem 1.051 linhas e 43 consultas; `admin.users` 27; `admin.professionals` 26; `utils/booking.js` (995 linhas) mistura regra de agenda e SQL. Só integrações externas vivem em `services/`. Consequência: regra de negócio só é testável subindo HTTP + banco; reaproveitar uma regra (ex.: "desativar profissional remarca atendimentos") exige copiar a rota.
**Ação:** extrair serviços por domínio (`auth`, `users`, `professionals`, `booking`) com a consulta dentro, deixando a rota com validação + resposta. Começar por `auth.routes.js` (maior) e `booking.js`. Sem reescrever: mover função a função, com a suíte atual como rede de segurança.

### A2 — Validação de entrada heterogênea (média)
Zod aparece em um arquivo (`utils/validators.js`); o resto valida à mão em cada rota (`if (!name…)`). Mensagens e limites divergem entre rotas; o front React valida com Zod, o servidor não compartilha o contrato.
**Ação:** esquemas Zod por rota (ou por domínio) com um `validate(schema)` de middleware; devolver o mesmo formato de erro. Beneficia o front (tipos gerados dos mesmos esquemas se um dia o servidor virar TypeScript).

### A3 — Migrations sem versionamento (média)
14 scripts idempotentes rodam todos, em ordem fixa, a cada `db:setup`; `schema.sql` é a "união". Não há tabela de controle (`schema_migrations`), então não se sabe qual versão um banco já está nem se pode reverter. A paridade é guardada por teste (`schema-parity`), o que reduz o risco, mas só enquanto alguém lembra de atualizar os dois lados.
**Ação:** migrations numeradas (`001_…sql`) + tabela de controle (ferramenta pronta, ex. `umzug`/`node-pg-migrate` equivalente MySQL, ou um runner de 50 linhas). Migrar os 14 scripts para a numeração sem mudar o resultado; manter o teste de paridade.

### A4 — Job de lembretes dentro do processo da API (média)
`jobs/reminders.js:227` usa `setInterval(…, DAY_MS)`. Com duas instâncias da API (ou reinício a cada deploy) o envio duplica ou se perde; não há trava distribuída nem registro de "última execução".
**Ação:** `GET_LOCK` do MySQL (ou coluna `last_run`) em volta da execução; ou processo separado (`node server/src/jobs/run.js` por cron do sistema). O teste `reminder-delivery` já cobre o envio, falta cobrir a exclusão mútua.

### A5 — Observabilidade mínima (baixa/média)
Erros vão para `console.error` sem id de requisição, nível ou formato estruturado; `/ready` só diz se o banco responde. Difícil correlacionar "Erro interno" do usuário com a linha de log.
**Ação:** id por requisição (header `X-Request-Id`, devolvido no JSON de 5xx) e log em JSON (ex. `pino`). Custo baixo, ganho alto em produção.

### A6 — Higiene do repositório (baixa)
Versionados sem necessidade: `server/scripts/temp_marked.js` (arquivo temporário), `migrate-supabase.js` (vestígio de outra plataforma), `.superpowers/…/progress.md`, `ROTEIRO_TESTE_ALUNOS.md` na raiz, ~2,7 MB de PDFs em `docs/` (binários no git incham o histórico). `graphify-out/` (3 MB gerado) ficou fora do commit.
**Ação:** remover os dois scripts e o `.superpowers`; mover PDFs para um release/armazenamento de documentos; `graphify-out/` no `.gitignore`.

### A7 — Dois front-ends no mesmo repositório (decisão pendente)
O front legado (6 HTMLs + `assets/` + `scripts/serve-web.js`) continua no repo e sustenta ~200 casos de teste estáticos em `server/test` (`frontend-high`, `escaping`, `stylesheet`, `web-server`, `dev-stack`, parte de `doctor`, `admin-user-form`, `dashboard-multiprof`, `mfa-setup`). Com o React cobrindo todas as áreas e a suíte e2e nova passando, o legado é código duplicado a manter.
**Ação:** aposentar (ver Fase 5). Os testes de XSS/escape do legado perdem o objeto; o React escapa por padrão (JSX); `dangerouslySetInnerHTML` aparece só em `components/ui/chart.tsx` (CSS de tema do gráfico, gerado pelo shadcn, sem dado de usuário).

### A8 — Bundle do front (baixa)
Chunk principal 555 kB (aviso do Vite acima de 500 kB); rotas por papel já são `lazy`. Candidatos: separar `recharts` e `react-day-picker` em chunks próprios (`manualChunks`) e carregar o gráfico de Alertas sob demanda.

## 3. Banco de dados

Resumo do modelo: `users` (40 colunas) concentra perfil, credenciais, MFA, consentimento e Gov.br; agendamento em `appointments`/`exams` (+ `booking_events`, `waitlist`); oferta em `health_units` → `unit_offers`, `professionals` → `professional_offers`/`work_schedules`/`schedule_blocks`; segurança em `refresh_tokens`, `password_reset_tokens`, `audit_log` (cadeia de hash).

### B1 — Agendamentos sem integridade referencial para unidade e profissional (alta)
`appointments`/`exams` têm `unit_id` e `professional_id`, mas **só `user_id` tem FK** (`schema.sql`). Não há índice em `unit_id`. Também guardam `location`, `doctor`, `specialty` como texto livre copiado no momento do agendamento. Consequências: ids órfãos possíveis; renomear uma unidade não reflete nos agendamentos antigos (pode ser desejado como "foto", mas hoje não é decisão documentada); consultas por unidade fazem varredura.
**Ação:** (1) auditar órfãos (`SELECT … WHERE unit_id IS NOT NULL AND unit_id NOT IN (SELECT id FROM health_units)`); (2) adicionar FKs `ON DELETE SET NULL` + `INDEX (unit_id, scheduled_at)`; (3) documentar que `location/doctor` são a "foto" do momento.

### B2 — Exclusividade de horário só na aplicação (média)
Não há restrição no banco contra dois agendamentos no mesmo (profissional, horário); a garantia vem de `SELECT … FOR UPDATE` dentro de transação (`utils/booking.js:321/849/950`) e dos testes de corrida. Funciona e está testado, mas depende de todo novo caminho de escrita lembrar do padrão.
**Ação:** rede de proteção no banco: coluna gerada `active_slot = IF(status IN ('pendente','confirmado'), scheduled_at, NULL)` + `UNIQUE (professional_id, active_slot)`. Cobre o caso exato; sobreposição por duração continua na aplicação.

### B3 — CPF cifrado sem índice cego: duplicidade e busca O(N) (média)
CPF/RG/CNS usam AES-256-GCM (correto), mas sem um *blind index* (HMAC do CPF). Efeitos verificados: o vínculo Gov.br faz `SELECT id, cpf FROM users WHERE cpf IS NOT NULL` e decifra tudo na aplicação (`auth.routes.js:745`); **o cadastro não checa CPF repetido** (só o e-mail é `UNIQUE`), então a mesma pessoa pode ter duas contas, com fila e histórico divididos.
**Ação:** coluna `cpf_hmac CHAR(64)` (HMAC-SHA256 com chave separada da de cifra) + `UNIQUE`; preencher por migração (decifra uma vez); trocar a varredura por `WHERE cpf_hmac = ?`. Mantém a comparação em tempo constante já implementada em `utils/cpf.js`.

### B4 — Alertas ligados a bairros por texto (baixa)
`diseases.region` é texto igual a `health_units.neighborhood`. Renomear um bairro numa unidade deixa o alerta apontando para um nome que ninguém mais usa, e nada avisa.
**Ação:** tabela `regions` (ou validar a região contra os bairros existentes ao salvar, que o React já faz na criação).

### B5 — Datas sem fuso (baixa, documentar)
`DATETIME` + `dateStrings: true` guardam e devolvem hora "de parede" do servidor. Funciona em um município/fuso único; quebra com servidor em UTC e usuários em outro fuso, ou mudança de horário.
**Ação:** fixar `TZ` no deploy e registrar a premissa em `PRODUCT.md`; revisitar se houver mais de um fuso.

### B6 — Pontos menores
- `idx_appointments_user` é prefixo de `idx_appointments_user_scheduled` (e o mesmo em `exams`): o primeiro é redundante.
- `audit_log.actor_id` `ON DELETE RESTRICT` impede apagar usuário com trilha — coerente com a LGPD (exclusão é anonimização), manter.
- `users` com 40 colunas é larga; separar `user_security` (MFA, Gov.br, tentativas) só vale se a tabela virar gargalo.
- `connectionLimit: 10` fixo em `db.js`: expor em variável de ambiente.

## 4. Segurança e dependências

- `npm audit --omit=dev` no servidor acusava 4 vulnerabilidades (body-parser, qs, ip-address, **zod** — DoS por memória/laço). **Feito:** `npm audit fix` (somente `package-lock.json`, versões compatíveis); agora 0 em produção. Sobram 2 moderadas em `nodemon` (só desenvolvimento). Suíte do servidor: 423/425 (a falha é o teste do `doctor` ao rodar com banco descartável, artefato do ambiente de teste, não do código).
- Front: `npm audit` = 0.
- **Feito (Fase 5):** o link do e-mail de redefinição apontava para `/auth.html`, que não existe no front React; agora usa `/auth?tab=reset&token=…` (teste cobre).
- Achados registrados nas fases anteriores (ainda abertos):
  1. **MFA:** `utils/totp.js` gera o segredo em base64url; apps autenticadores (Google/Microsoft Authenticator) exigem base32, então o segredo provavelmente não é cadastrável em app real (o legado tem o mesmo defeito). Corrigir exige migrar os segredos já gravados (decifrar → recodificar → recifrar) e manter compatibilidade durante a troca.
  2. `GET /auth/me` devolve CPF/CNS/RG sem máscara ao próprio titular; menos exposição se devolver mascarado e expor o completo só em "Minha conta" sob demanda.
  3. `seed:demo` cria agendamentos para outro usuário, não para o paciente de teste (atrapalha demonstração).
  4. Servidor rejeita agendar sem profissional (409) quando há profissionais para o serviço; o React já exige a escolha, o legado não.

## 5. Ordem sugerida

| Prioridade | Item | Esforço | Por quê primeiro |
|---|---|---|---|
| 1 | B1 FKs + índice em `unit_id` (após auditoria de órfãos) | S | integridade de dados clínicos |
| 2 | B3 `cpf_hmac` único + busca indexada | M | duplicidade de pacientes + varredura O(N) |
| 3 | MFA base32 com migração de segredos | M | 2º fator inutilizável em app real |
| 4 | A4 trava no job de lembretes | S | duplicação de e-mails/SMS ao escalar |
| 5 | A3 migrations numeradas | M | habilita todas as mudanças de banco acima com segurança |
| 6 | A1/A2 serviços + validação Zod, começando por `auth` | L | manutenção; faça junto de cada mudança, não como projeto à parte |
| 7 | A7 aposentar legado, A6 higiene, A8 bundle | S–M | redução de superfície |
| 8 | B2 índice único de horário, A5 request id/logs | S | defesa em profundidade e operação |

S ≤ 1 dia · M 2–4 dias · L > 1 semana (estimativas de ordem de grandeza).
