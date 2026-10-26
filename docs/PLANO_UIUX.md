# Plano de Melhorias — Interface, UX e UI (Saúde+)

Análise gerada em 2026-07-20, complementar ao [PLANO_MELHORIAS.md](PLANO_MELHORIAS.md) (backend/segurança). Escopo: `index.html`, `auth.html`, `dashboard.html`, `admin.html`, `atendente.html`, `assets/styles.css`. Só leitura — nada alterado.

> **Atualização 2026-10-18:** o achado 13 (unificar busca de usuário/histórico) e a dívida de responsividade foram tratados no `admin.html` — Fases 0 a 4 do plano "UX/UI + responsivo do admin". Ver [Refactor do admin](#refactor-do-admin-2026-10-18) no fim deste arquivo. 
> **Atualização 2026-10-26:** dashboard paciente (Fase 8) e partes do atendente/admin consolidadas. Cadastro passou para **wizard de 2 passos** (não 4) com fonte **Inter autohospedada**. Ainda há pontos a polir em fluxos não padronizados, mas várias melhorias foram aplicadas. PLANO_UIUX já foi parcialmente atualizado — não reverter mudanças existentes.

## O que já está bem resolvido (não mexer sem motivo)

- **Design system consolidado** em `styles.css` via CSS custom properties (`--primary`, `--radius`, `--shadow`...) — paleta "lagoa" com propósito declarado (alto contraste, tipografia generosa para público com baixa familiaridade digital).
- **Acessibilidade de base já presente**: `:focus-visible` global com outline de 3px, `prefers-reduced-motion` respeitado, `aria-selected`/`role="tab"`/`role="tabpanel"` nas abas de todos os 3 painéis internos, `autocomplete` correto nos campos de login/senha.
- **Sanitização de output**: função `esc()` usada consistentemente antes de injetar dado dinâmico no DOM — evita XSS refletido via nome/observações do usuário.
- **Estado vazio tratado** (`.empty`, mensagens tipo "Nenhum registro") em vez de listas quebradas ou brancas.
- **Feedback de carregamento** (`.spinner`) e feedback de ação (`.toast` com variantes success/error) presentes em todo fluxo assíncrono.
- **Wizard de cadastro em 2 passos** com indicador visual de progresso (`.wizard-steps`) — bem pensado para reduzir abandono num formulário longo. Fonte Inter autohospedada.
- **Máscaras de input em tempo real** (CPF, telefone, CEP) e autopreenchimento via ViaCEP com fallback manual.

## Achados por prioridade

### 🔴 Alto impacto — usabilidade/acessibilidade real

1. **Uso de `confirm()` nativo do navegador** para cancelar agendamento (`dashboard.html:330`) — inconsistente com o design system (não segue a paleta, não é responsivo em mobile, texto do botão não customizável, ruim para leitor de tela). Deveria ser um modal próprio com os mesmos componentes (`.card`, `.btn`) do resto do app.
2. **`alert()`/`confirm()` como única confirmação destrutiva** — cancelar consulta/exame é ação com peso real (paciente pode perder vaga), e a única fricção é um `confirm()` de uma linha, sem explicar consequência específica (ex.: "essa vaga pode não voltar a ficar disponível").
3. **Sem loading state nos botões de submit dos formulários de agendamento** (`addAppt`, `addExam`) — só o botão de signup (`submitBtn`) desabilita e troca texto durante o request; os formulários do dashboard não bloqueiam duplo clique, permitindo submissão dupla acidental (ex.: rede lenta + usuário clica de novo).
4. **Mensagens de erro genéricas demais em alguns pontos** — `toast(err.message||'Erro','error')` em `addAppt/addExam` não diferencia erro de rede, erro de validação do servidor, ou erro de horário no passado; usuário não entende o que corrigir.
5. **Navegação por teclado dentro das tabs não implementada** — `role="tab"` está presente mas não há handler de seta esquerda/direita entre abas (padrão ARIA para `tablist` esperado por leitores de tela avançados/usuários de teclado).
6. **Campos obrigatórios do wizard (passo 2 e 3) não usam `aria-invalid` nem mensagem inline** — a validação (`validateStep2`, `validateStep3`) só foca o campo e dispara toast; usuário de leitor de tela não é avisado *qual* campo falhou de forma associada ao input (`aria-describedby`).
7. **Sem indicação de força de senha** no cadastro — só valida `length >= 6` no `submitSignup`; senha fraca (`123456`) passa sem aviso, em app que guarda dado de saúde sensível.

### 🟠 Médio impacto — consistência e polimento

8. **Duplicação quase total de CSS inline em `style="..."`** espalhado pelos HTMLs (ex.: `style="text-align:center;margin-bottom:8px"` repetido em várias seções, `style="grid-column:1/-1"` repetido dezenas de vezes) — quebra a disciplina de design system que `styles.css` estabelece; deveria virar classes utilitárias (`.text-center`, `.col-span-full`) reaproveitáveis.
9. **Duplicação de JS entre `dashboard.html`, `admin.html`, `atendente.html`** — cada um reimplementa `switchTab`, `statusClass`, `fmtDate`-adjacent helpers, `esc()` já está em `api.js` mas outros helpers (`stat()`, `levelClass()`) são redefinidos por página. Risco: corrigir um bug de status/badge em uma tela e esquecer as outras duas (mesmo padrão já sinalizado no plano de backend para as rotas).
10. **Formulários de agendamento não usam `datetime-local` `max`** — só têm `min` (`nowLocalForInput()`), então dá pra agendar consulta daqui a 50 anos sem aviso; UX permite erro de digitação de data óbvio (ano errado) sem qualquer alerta.
11. **Botão "Editar" em itens de lista faz scroll pro formulário** (`form.scrollIntoView`) mas não há indicação visual de "modo edição ativo" além do texto do título/botão mudar — em telas longas, fácil perder o contexto de que está editando algo específico (ex.: destacar borda do card do formulário).
12. **Select de especialidade "Outra"** (`specialtySelect` com `__outra`) é um padrão bom, mas não existe equivalente para tipo de exame nem local (`exam_type`, `location`) — inconsistência: em um form dá pra digitar livre, no outro não.
13. **Painel admin: busca de usuário e busca de histórico são telas/abas separadas** (`Histórico` busca por e-mail exato, `Usuários` busca por nome/e-mail parcial) fazendo praticamente a mesma coisa com UX diferente — unificar reduziria carga cognitiva do atendente/admin.
14. **Sem "Cancelar" nos formulários de criação** (só existe "Cancelar edição", que só aparece em modo edição) — usuário que preenche metade de um formulário longo (agendamento com observações) não tem botão explícito de "descartar e voltar", só pode trocar de aba.
15. **Mobile (resolvido)**: `.grid-2` vira 1 coluna abaixo de 480px/760px e o wizard de cadastro hoje tem **2 passos** ("Você" e "Acesso"), com regra `@media(max-width:360px)` em `.wizard-step`. O aperto original de 4 passos não existe mais.

### 🟡 Baixo impacto — refinamento

16. **Tipografia (resolvido)**: Inter é autohospedada em `assets/fonts/inter-latin.woff2` com `font-display: swap`, sem request externo nem dependência de Google Fonts — adequada ao público rural com internet instável.
17. **Ícones SVG inline repetidos** (ex.: ícone de cadeado em "trust-item", ícone de coração) — sem um sprite/symbol compartilhado, cada HTML carrega o path SVG duplicado; não afeta performance de forma crítica no tamanho atual, mas cresce mal.
18. **Sem skeleton loading** — usa spinner central genérico (`.spinner`) em vez de skeleton nas listas (cards cinza pulsando no formato do conteúdo final), o que causa mais "pulo" de layout quando o conteúdo chega.
19. **Sem dark mode** — não é falha, só ausência; dado o público (baixa familiaridade digital, provavelmente uso diurno), baixa prioridade real.
20. **Contraste de `.opt` (texto "(opcional)")** usa `--muted` (#5B6E6A) em fonte pequena (.75rem/.8rem) — vale checar contraste mínimo AA para texto pequeno (WCAG exige 4.5:1 para texto < 18px; `--muted` sobre `--surface` branco dá aproximadamente 5.3:1, deve passar, mas vale confirmar com ferramenta em vez de estimar).
21. **`atendenteNote`, mensagens de aviso (`⚠️`)** usam emoji direto no texto — funciona, mas emoji não tem `aria-label`/`role="img"`, leitor de tela pode ler o nome do emoji de forma estranha ("sinal de aviso" antes do texto) dependendo do software.

## Plano de ação sugerido (ordem recomendada)

### Fase 1 — Acessibilidade e confirmação de ações críticas
- [ ] Substituir todo `confirm()`/`alert()` nativo por modal próprio do design system (componente `.modal` reaproveitável, mesmo padrão dos `.card`).
- [ ] Adicionar `aria-invalid` + mensagem inline associada (`aria-describedby`) nos campos obrigatórios do wizard, além do toast atual.
- [ ] Implementar navegação por seta esquerda/direita nas `role="tab"` (padrão ARIA APG para tablist).
- [ ] Adicionar `max` em todos os inputs `datetime-local` (limite razoável, ex.: +1 ano) para pegar erro de digitação de data.

### Fase 2 — Consistência de estado e feedback
- [ ] Desabilitar + trocar texto do botão em `addAppt`/`addExam` durante o request (mesmo padrão já usado em `submitSignup`), evitando duplo submit.
- [ ] Diferenciar mensagens de erro por causa (rede vs. validação vs. servidor) nos `catch` dos formulários.
- [ ] Adicionar indicador de força de senha no cadastro (mínimo: fraca/média/forte, sem lib externa — regex simples já resolve).
- [ ] Adicionar botão "Cancelar" explícito (não só "Cancelar edição") nos formulários de criação, limpando o form.

### Fase 3 — Consolidação de design system
- [ ] Extrair `style="..."` inline repetido para classes utilitárias em `styles.css` (`.text-center`, `.col-span-full`, `.mt-*`).
- [ ] Extrair helpers JS duplicados (`switchTab`, `statusClass`, `stat`, `levelClass`) para um `assets/ui.js` compartilhado entre `dashboard.html`, `admin.html`, `atendente.html`.
- [ ] Padronizar campo "Outro/Outra" (texto livre) em todos os selects que hoje têm lista fechada (`exam_type`, `location`), não só em `specialty`.
- [ ] Unificar busca de usuário/histórico no admin numa única tela.

### Fase 4 — Polimento visual
- [ ] Trocar spinner central por skeleton loading nas listas (`.item` placeholder cinza).
- [ ] Avaliar hospedar Inter localmente (`assets/fonts/`) para reduzir dependência de rede externa, dado público-alvo rural.
- [ ] Consolidar ícones SVG repetidos em um `<svg><symbol>` sprite único, referenciado via `<use>`.
- [ ] Rodar checagem de contraste real (ex. `axe DevTools` ou Lighthouse) nos textos `--muted` pequenos para confirmar AA.

## Observação sobre plugins/skills

Diagnóstico feito por leitura direta do HTML/CSS (sem alterar nada), como pedido. Para aprofundar quando o usuário quiser agir:
- `web-design-guidelines` — checklist formal de Web Interface Guidelines (contraste, foco, ARIA) aplicado item a item nas páginas.
- `frontend-design` — orientação de direção visual caso queira revisar identidade além do que já existe (paleta "lagoa" já é uma escolha deliberada e coerente, não recomendo redesenho do zero).
- `design-taste-frontend` / `minimalist-ui` — só relevantes se o pedido for redesign visual amplo; hoje o sistema visual atual é consistente e não parece "genérico", então baixa prioridade.

Nenhuma dessas foi executada agora — só citadas como próximo passo, conforme pedido de "só informação".

---

## Refactor do admin (2026-10-18)

Escopo: `admin.html`, `assets/styles.css` (regras novas escopadas em `.app-admin`) e `assets/ui.js` (primitivas novas aditivas). `dashboard.html` e `atendente.html` **não foram tocados** — é o motivo de o CSS novo ser escopado.

### Base medida antes (Playwright, 4 viewports × 5 abas)

| Viewport | Aba | Overflow horizontal |
|---|---|---|
| 360 | Atendimentos | 465px |
| 360 | Cadastros | 102px |
| **360 / 820 / 1280 / 1920** | **Auditoria** | **7739 / 7279 / 7075 / 6727px** |
| 820 | Atendimentos | 5px |

**Depois: 0px nas 20 combinações.**

### Causa raiz (não era a largura da tabela)

O `.container` usa `margin:0 auto` para centralizar. Margem `auto` no eixo cruzado **desliga** o `align-items:stretch` do flex column em `.app-main`, então o container virava `fit-content` e crescia até o min-content do filho mais largo. A trilha de auditoria tem `details` livre e hash sem quebra, que viravam um bloco de 7000px e subiam de elo em elo até o `<html>`. Corrigido com `min-width:0` na cadeia **e** `width:100%` no `.container`.

### O que foi resolvido

| Achado antigo | Estado no admin |
|---|---|
| 1–2. `confirm()` nativo e ação destrutiva sem explicar consequência | **Parcial**: os 4 modais ganharam foco preso, scroll lock e Esc; os 10 casos sem confirmação usam `confirmDialog` (Fase 5) |
| 3. Sem loading nos submits | **Resolvido**: `loadingButton` nos 15 handlers |
| 5. Sem navegação por teclado nas abas | **Resolvido e corrigido**: as sub-abas não eram `role=tab`; havia **dois** handlers de seta (o do `ui.js` e um local) disparando `switchTab()` duas vezes |
| 8. `style=""` duplicado | **Resolvido no admin**: 93 → 5 (os 5 são `display:none` por JS) |
| 9. Helpers JS duplicados | **Parcial**: `ui.js` ganhou `openModal`/`closeModal`/`confirmDialog`/`loadingButton`/`skeleton`/`stateMessage`/`initScrollHint` |
| 13. Busca de usuário/histórico separadas | **Parcial**: ambas em `.card` com `<dl>` e nome acessível único por linha |
| 18. Sem skeleton nas listas | **Resolvido no admin**: `skeleton()` |
| 20. Contraste de texto pequeno | **Resolvido**: `.text-sm`/`.text-xs` sobre `--muted` (AA verificado no `DESIGN.md`) |

### Achados novos, só do admin

- **4 modais com `<style>` injetado no `<head>`**, sem `max-height` — conteúdo mais alto que a viewport era cortado nas duas pontas, sem rolagem para alcançar nenhuma delas.
- **`.toast` ficava atrás do scrim** (`z-index:100` contra `9999`): o erro de "reagendar" era invisível enquanto o modal seguisse aberto. Erro de API agora aparece no campo, dentro do modal.
- **`#acctForm` tinha `novalidate` + `required` sem nenhuma validação JS**: envio vazio ia ao back e voltava só como toast.
- **`form.reset()` no cadastro de doença** devolvia o `<select>` de bairros ao placeholder "Carregando regiões…", porque as opções são injetadas por JS — o dropdown travava naquele texto até recarregar.
- **`loadProfessionals()` re-renderizava `#profDetail`** a cada ação dentro dele, apagando o digitado nos dois formulários vizinhos.
- **`setDateLimits()` varria o documento inteiro** e aplicava a janela de agendamento também ao formulário de bloqueio de agenda do profissional.
- **Nomes acessíveis duplicados**: N botões "Editar", N "Remover", N "Confirmar", N "Fechar" numa lista. Agora cada um descreve o alvo.
- **Erro de carga deixava skeleton eterno** em 3 containers (só toast, que some em 3,5s). Agora há estado de erro no container com "Tentar de novo".
- **`#userList` nascia completamente vazio**, sem estado inicial. **`#acctPct` mostrava `0%`** antes de carregar, sugerindo 0% de preenchimento.
- **Zero `aria-live` na página inteira** — o veredito ÍNTEGRA/VIOLADA da auditoria não era anunciado.

### Continuam abertos (Fases 5 e 6, não feitas)

- Confirmação nas 10 ações destrutivas restantes (`confirmDialog` já existe, falta chamar).
- Estado na URL (deep-link de aba/sub-aba/filtros).
- Paginação e busca em usuários/auditoria/unidades/profissionais/doenças.
- Overview em 2–3 colunas a partir de 1280px (TV). O degrau tipográfico e o teto de largura já estão prontos em `styles.css`.
- `e2e/admin-responsive.spec.js` com asserções de overflow e alvo de toque.

---

## Fases 5 e 6 — fechadas em 2026-10-18

### 5.1 Confirmação destrutiva (`confirmDialog`, 8 casos novos)

Desativar unidade · desativar profissional · desativar alerta · cancelar atendimento/exame · remover serviço da unidade · remover vínculo · remover horário · remover bloqueio. Cada diálogo explica a **consequência concreta**, não um genérico "tem certeza?" — ex.: *"A unidade deixa de aparecer no agendamento para os pacientes até ser reativada. Os atendimentos já marcados continuam como estão."*

Ativar (o caminho inverso) **não** pede confirmação — desativar esconde algo do paciente, ativar não.

Os dois que já confirmavam (excluir alerta, excluir conta) mantêm o modal próprio por causa da senha e do texto específico.

### 5.2 Estado na URL

`#tab=cadastros&sub=rede&q=…&status=…`. Trocar de aba empilha no histórico (Voltar navega entre abas); mexer em filtro substitui a entrada.

**Nada é escrito no load** — regra dura, porque `login.spec.js:48` afirma `toHaveURL(/admin\.html$/)` logo após o login e `applyLevelGating()` chama `setSubTab()` no boot.

Dois bugs encontrados pelo próprio teste e corrigidos:
- `loadAuditLog`/`searchUsers` faziam `replaceState` **dentro** do carregador, que durante a troca de aba substituía a entrada anterior — o Voltar voltava para a mesma tela. A escrita saiu dos carregadores para os listeners.
- Ausência de hash não era tratada como estado: voltar para `/admin.html` sem hash deixava a tela na aba de Auditoria, contradizendo a URL.

### 5.3 Paginação e busca — só o que a API aceita

| Lista | Mecanismo | Por quê |
|---|---|---|
| Usuários | `page`/`pageSize` | A rota deriva o offset; `limit` é ignorado |
| Auditoria | `page`/`pageSize` | Sem nenhum dos dois a rota cai no modo legado: só 50 linhas, sem como pedir o resto |
| Consultas/exames do dia | pagina até passar de "hoje", teto de 5 páginas | A rota vem `scheduled_at DESC`; antes a "Agenda de hoje" filtrava só entre os 100 mais recentes |
| Unidades, profissionais, doenças, serviços | filtro no cliente | Nenhuma dessas rotas lê **nenhum** query param (verificado nas rotas do servidor) |

O total da API passou a ser usado: "Carregar mais (25 de 143)" só aparece quando há resto, e o fim é declarado.

### 5.4 Loading

`loadingButton` nos 15 handlers de mutação, incluindo os dois downloads (CSV e exportação LGPD), que antes disparavam em duplicata sem nenhum sinal.

### 5.5 Toggle com estado real

O valor alvo não é mais assado no HTML (`data-next`): o handler lê o array atualizado. Com o valor assado, dois admins em telas antigas se desativavam por engano, cada um invertendo o que o outro fez.

### 6. Overview em tela larga

Indicadores na linha inteira; "Precisa da sua atenção + atalhos" × "Atividade recente" em duas colunas a partir de 1180px, metades iguais a partir de 1900px. `grid-4`/`grid-5` liberadas dentro do shell acima de 1600px (colavam para 2 e 3 logo depois de 1150/1300 por causa dos 256px do rail).

### Fase 7 — verificação

`e2e/admin-responsive.spec.js` (15 testes) + `e2e/global-setup.js`.

O `global-setup` faz **um** login e grava o `storageState` para a suíte inteira, com espera quando o login volta 429. Motivo: `/auth/login` é limitado a 60/15 min e trava o IP; com um login por teste a suíte estourava o limite e os testes seguintes morriam de timeout — falha de infraestrutura, não de página. O arquivo de sessão vai para `e2e/.auth/` e está no `.gitignore` (é um JWT real).

A suíte responsiva usa **uma página só** (fixture de worker) e só troca o viewport: a API tem limite global de 300 requisições/15 min, e carregar o painel por teste × viewport estourava a janela no meio da execução.

Coberto: overflow horizontal em 360/820/1440/1920 × 5 abas · alvo ≥44px · tabela→card · rail coluna→barra · marca não cortada · Início em 2 colunas · todo botão com nome acessível · sub-abas como tablist de verdade · hash + Voltar · deep link com filtros · confirmação destrutiva · rodapé de paginação.

**29/29 e2e verdes** (14 originais + 15 novos), `npm run check` verde (317 + 7), `npm run doctor` verde.

---

## Fase 8 — dashboard.html (paciente)

Fatia em 4 sub-fases aprovadas: 8A estados, 8B acessibilidade, 8C design system, 8D testes. Escopo: `dashboard.html`, `assets/ui.js` (globais aditivas) e `assets/styles.css` (utilities/componentes desescopados de `.app-admin`).

### 8A — Estados de carga/erro (fechada)

- `err.status` no `api.js` — a UI distingue 401 (sessão caiu) de erro de rede/servidor.
- `role="alert"` no `#stateMessage`, `aria-live` nos containers de lista e stats.
- Skeleton em `#stats` (antes: spinner central ou nada).
- `Promise.allSettled` nas 5 cargas independentes do Início — uma falha não mata as outras.
- `loadingButton` nos submits (`addAppt`/`addExam`/profile/consent) — bloqueia duplo clique.
- `loadErrorMessage` com "Tentar de novo" em vez de toast que some em 3,5s.

### 8B — Acessibilidade (fechada)

- Roving tabindex nas abas; handler de setas duplicado removido.
- 3 modais migrados para `openModal`/`closeModal` (foco preso, scroll lock, Esc, foco devolvido) + `data-modal-persist`/`data-modal-close`.
- `#cancelModal` como `alertdialog` (o texto explica a consequência).
- `renderList` ganhou 7º parâmetro `label` — nome acessível único por botão (Editar/Cancelar/Reagendar por item).
- Skip link `a.sr-only:focus` + `#profileBar` com `role="progressbar"`/`aria-valuenow`.

### 8C — Design system (fechada)

- **`--sp-1..7` movido para `:root`** (antes preso em `.app-admin`), alimentando as utilities globais.
- **Utilities desescopadas** (valem para os 3 painéis): margens/gaps, `.btn-outline-danger`, `.card-highlight`, `.text-sm`, `.text-upper`, `.items-start`, `.col-full`, `.select-all`, `.field-code`, `.field-uf`, `.list-plain`, `.dpo-contact`, `.card-sub`, `.mr-1`, `.mb-1`, `.review-lines` e o componente modal (`.modal-card`, `.modal-overlay`, `.modal-actions`).
- **`statusClass`/`levelClass`/`stat`** viraram globais no `ui.js` (`window.*`) — o dashboard deixou de redefinir os 3 helpers; `admin.html` e `atendente.html` permanecem com as cópias locais (shadowing inofensivo, idênticas).
- **`<style>` injetados eliminados** — `ensureReviewModal`/`ensureCancelModal`/`ensurePasswordModal` do dashboard usam o markup/estilos do componente `.modal-card` global; os 3 botões de confirmação usam `btn-danger` via classe (não `style.background`).
- **`style=""` do dashboard: 81 → 17**, e os 17 restantes são todos `display:none` alternado por JS (estado, não estilo). O `renderList`/template do dashboard usa as utilities; `#stats` migrou de `grid grid-5` para `stats-grid` (o mesmo do admin); o meter do perfil usa `.meter`/`.meter-track`/`.meter-fill`.
- Verificação: `npm run test` 317/317 (mailer "resumo" flaky conhecido — DNS, passa no retry), `npm run test:e2e` 29/29, checagem estática via servidor (0 `style` não-`display:none`, atributos no ar).

### 8D — Testes (fechada)

- **Sessão do paciente:** `e2e/global-setup.js` cria/login de paciente idempotente (signup via API tolerando 409, login via UI) → `e2e/.auth/paciente.json`. Credenciais por env `E2E_PATIENT_EMAIL/PASSWORD` com defaults de teste.
- **Suíte nova `e2e/dashboard.spec.js` (10 testes):**
  1) Painel abre no Início sem erro de JS e sem 4xx relevantes (5 abas + role/aria).
  2) Estado de erro da lista tem "Tentar de novo" e recarrega (`stateMessage`, `loadAll` com `Promise.allSettled`).
  3) Consulta manual ("Outra") → review modal → confirmar → aparece em `#appts` (`toast` "Consulta agendada").
  4) Review modal "Voltar" fecha sem POST (nenhum item adicionado).
  5) Cancelar: `#cancelModal` `role="alertdialog"`, Voltar não cancela, confirmar → vira "Tentar agendar novamente" (`apiPatch /me/appointments/:id/cancel`).
  6) Editar: banner `#apptEditBanner`, título "Editar consulta", `#apptCancelEdit` restaura.
  7) Exame manual → review modal → toast "Exame agendado" → aparece em `#exams`.
  8) Perfil: `social_name` salva → toast "Perfil salvo" + meter atualiza; CPF inválido → `.has-error` sem `PUT /auth/me`.
  9) MFA: `askPassword` → segredo revelado; código inválido → toast erro, não ativa (`#mfaDisableBtn` continua oculto).
  10) LGPD: `#consentLine` carregado, download `meus-dados-saude-mais.json`, `DELETE /auth/me` **mockado** → toast + redirect `auth.html` (conta preservada).
- **Fixture worker:** `patientPage` carrega dashboard uma vez para todo o arquivo; teste 10 usa contexto próprio.
- Verificação: `npm run test` + `npm run test:e2e` (tolerando janela de rate limit).
