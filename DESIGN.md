---
name: SaudePlus
description: Cuidado integrado Lagoa de Itaenga — lagoa verde-água, alto contraste, tipografia generosa
colors:
  ink: "#0E2A27"
  bg: "#F3F7F5"
  surface: "#FFFFFF"
  primary: "#0F7A6B"
  primary-600: "#0B5C50"
  primary-100: "#DCEFEA"
  accent: "#E0622E"
  muted: "#5B6E6A"
  border: "#DCE6E2"
  danger: "#C0392B"
  danger-bg: "#FBE7E4"
  warning: "#B9790F"
  warning-bg: "#FBF0DC"
  warning-ink: "#6B4A00"
  brand-dot-hi: "#5FC9B8"
  success: "#1E8F5E"
  success-bg: "#E1F3EA"
typography:
  display:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(1.7rem, 3vw, 2.3rem)"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
rounded:
  xs: "6px"
  sm: "9px"
  md: "14px"
spacing:
  sm: "8px"
  md: "16px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "11px 20px"
  button-primary-hover:
    backgroundColor: "{colors.primary-600}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "11px 20px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "11px 20px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "20px"
---

> **Nota (2026-11):** o front HTML descrito abaixo (`assets/styles.css`, `assets/ui.js`, `admin.html` etc.) foi aposentado. A implementação vigente é o app React em `web/`: os tokens da paleta lagoa estão em `web/src/index.css` e os componentes são shadcn/ui (`web/src/components/ui`). Os princípios, a paleta e as regras de acessibilidade abaixo continuam valendo; trechos que citam `assets/*` ou `*.html` são históricos. `assets/styles.css` só permanece para a demo `event-manager-demo.html`.

## Overview

Sistema incumbente vanilla (sem build) para rede municipal. Assinatura: a "lagoa" — gradiente `primary-100 → bg` + ondulação em `radial-gradient` no hero, `brand-dot` radial com anel. Público baixa-familiaridade digital: contraste alto, fonte 16px, passos curtos. Modos: `index` Persuade, `auth` Persuade→Operate, painéis Operate com `app-shell` 256px rail.

## Colors

Lagoa comprometida: texto `ink` quase-preto-esverdeado sobre `bg` água-clara; ação só em `primary/primary-600`; `accent` terracota com moderação (nunca texto corrido). Semânticos fechados: danger/warning/success + bgs pastéis.

**Contraste (Fase 0 detector → Fase 1/2 resolvido).** O detector acusou 3 pares reprovados. Estado medido hoje, com os valores reais de `styles.css`:

| Par | Razão | Veredito |
|---|---|---|
| `white` on `--primary` | 5.23:1 | Passa AA |
| `white` on `--primary-600` | 7.89:1 | Passa AAA |
| `--warning` on `--warning-bg` | 3.20:1 | **Reprovado** — resolvido trocando o texto por `--warning-ink` (7.14:1) |

A correção foi de token, não de paleta: `--warning-ink` existe exatamente para texto sobre `--warning-bg`, e `--warning` ficou só para ícone/borda/acento.

**Don't (regra permanente):** não usar `--warning`, `--warning-bg` nem `--success` como fundo de texto pequeno. `--warning` sobre `--bg` dá 3.62:1 e `white` sobre `--success` dá 4.08:1 — ambos reprovados para texto normal (precisariam de ≥4.5:1). Texto branco sobre `--primary`/`--primary-600`/`--danger` está liberado (5.23 / 7.89 / 5.44).

## Typography

Inter variável (100–900) autohospedada em `assets/fonts/inter-latin.woff2` com `display:swap` — zero request externo (Fase 2). H1 800 clamp, H2 1.5rem, H3 1.15rem, corpo 16px/1.55. Nos painéis, a hierarquia é h1→h2→h3 sem saltos: títulos de card/diálogo são h2 com 1.15rem e subseções/itens são h3 com 1rem (regras em `styles.css`, Fase 2) — o visual é idêntico ao antigo h3/h4. Detector marca Inter como overused-font (slop): mantido por decisão — legibilidade + offline + familiaridade SUS valem mais que distinção; distinção vem da composição lagoa, não da face. Hospedagem local confirmada em `assets/fonts/` para rural instável; avaliar Atkinson Hyperlegible só se teste mostrar ganho real.

## Layout

`--maxw:1080px`, `.container 32px 20px 64px`. Grids: `.grid-2/3/4/5` colapsam <760px; dentro de `app-shell` colapsam mais cedo (1300px/1150px) porque rail rouba 256px. Rail: `grid 256px 1fr`, sticky 100vh, vira topbar rolável <980px e empilha <620px. Hero `72px 20px 96px` centrado, max 680/560px. Linha 35–75 chars implícita; sem scroll horizontal.

**Camada responsiva do admin (`assets/styles.css`, escopada em `.app-admin`).** Tudo o que segue existe só para o admin.html e não toca dashboard/atendente — mesmo `styles.css`, regras sem escopo virariam regressão nos outros dois painéis.

- **Raiz do estouro horizontal: `min-width:0` + `width:100%` no `.container`.** Margem `auto` no eixo cruzado **desliga** o `align-items:stretch` do flex column em `.app-main`: o container virava `fit-content` e crescia até o min-content do filho mais largo. Medido antes do refactor: Auditoria com 8099px de documento num viewport de 360px; hoje, 0px em 20 combinações de viewport×aba.
- **Escada:** `<620` fone · `620–980` fone grande/tablet retrato · `980–1440` tablet paisagem/notebook · `≥1440` desktop · **`≥1600` TV** · `≥2200` 4K (teto em 1680px para a linha não passar de 75 caracteres).
- **Tabela → card abaixo de 760px.** `.table-wrap` rola no ponteiro (`min-width:34rem`, scrollbar visível); no toque cada `<tr>` vira card e o rótulo vem de `data-label` no `<td>` (o `thead` some, o `caption.sr-only` fica). Escolhido no lugar de scroll horizontal porque o dedo não converge para arrastar tabela e o público tem baixa familiaridade digital.
- **Item de lista:** `.item{flex-wrap:wrap}` + `.item-main{flex:1 1 16rem;min-width:0}` + `.item-actions`. Em <620px as ações viram faixa cheia no rodapé.
- **Método de entrada, não só largura:** `@media (pointer:coarse)` dá 48px aos botões e 44px aos `.btn-sm`. Notebook com touch é grande e táctil; celular pequeno com mouse é raro.
- **Dica de rolagem:** faixas que não cabem (abas) recebem `data-scroll` via `ui.js:initScrollHint` e o CSS esmaece o lado que ainda tem conteúdo. Sem isso "Auditoria" e "Doenças e alertas" apareciam cortados sem aviso.
- **Utilitários globais** (valem para admin, atendente e dashboard): `.mt-*`/`.mb-*`/`.m-0`/`.mr-*`/`.gap-*`/`.col-full`/`.grow`/`.card-sub`/`.field-actions`/`.btn-block`/`.btn-danger`/`.btn-outline-danger`/`.text-danger`/`.text-sm`/`.text-upper`/`.items-start`/`.list-plain`/`.select-all`/`.field-code`/`.field-uf`/`.meter*`/`.stat-*`/`.stats-grid`/`.state-error`/`.load-more*`/`.card-highlight`/`.hide`/`.review-lines`. Substituem os `style=""` inline — o admin saiu de 93 para 5, o dashboard de 81 para 17 (todos `display:none` alternado por JS: estado, não estilo).
- **`--sp-1..7` no `:root`** (antes presos ao bloco `.app-admin`): a escala de espaçamento alimenta as utilitárias globais e os componentes compartilhados.
- **Safe area:** `env(safe-area-inset-*)` no container e no toast, com `viewport-fit=cover` na meta.

## Componentes novos compartilhados (`assets/ui.js`)

`openModal`/`closeModal` (foco preso em Tab, foco devolvido ao fechar, scroll do fundo travado, backdrop e Esc fecham, `overscroll-behavior:contain`), `confirmDialog` (Promise<boolean>, texto via `textContent`), `loadingButton` (desabilita + `…` + `aria-busy`, ignora o 2º toque — substitui o `disabled` manual que existia em 15 handlers com 9 sem nada), `skeleton`, `stateMessage('empty'|'error', msg, retryFn)` e `initScrollHint`. `closeTopModal` ganha um fallback genérico para `.modal-overlay` **depois** da tabela legada, então `passwordModal`/`reviewModal`/`cancelModal` e osclosersnamedcontinuam idênticos.

**Substituídos:** os 4 `<style>` injetados em `<head>` no admin (reagendar, excluir alerta, editar alerta, excluir conta), que não tinham `max-height` (conteúdo mais alto que a viewport era cortado nas duas pontas, sem rolagem), nem foco preso, nem scroll lock — e o `.toast` (`z-index:100`) ficava **atrás** do scrim (`9999`), então o erro de "reagendar" era invisível enquanto o modal seguisse aberto.

## Do's and Don'ts

Do: um CTA primário por viewport; foco 3px sempre; erro inline + `aria-describedby` (não só toast); validar blur + submit com sumário focável `role=alert`; alvos 44px/8px gap; SVG inline/lucide, nunca emoji como ícone; `prefers-reduced-motion`.
Don't: texto `ink` sobre `primary`, `warning` sobre `warning-bg`; nativos `confirm/prompt/alert`; Inter-as-display PH; gradiente roxo/rosa IA; motion pesado; inventar depoimentos/stats (usar `GET /public/stats` real ou omitir).

**Don't (aprendido no refactor do admin):**
- **Não confiar em `min-width:0` sozinho.** Só ele não resolve: com `margin:0 auto` no eixo cruzado o flex deixa de esticar e o problema reaparece como `fit-content`.
- **Não colocar regra de breakpoint antes da regra base** quando empatam em especificidade. Media query não ganha prioridade de cascata; a ordem no arquivo decide.
- **Não repetir botão sem nome acessível único.** N botões "Editar" numa lista viram N vezes "Editar, botão" no leitor de tela. Montar `aria-label` com o nome do alvo.
- **Não interpolar id em `onclick`.** `data-*` + delegação é o que impede a aspas/apóstrofo de matar o script (`server/test/escaping.test.js`).
- **Não usar `confirm()` nativo nem box sem `confirmDialog`** em ação destrutiva — o produto exige que a consequência seja explicada (princípio 3 do `PRODUCT.md`).
- **Não deixar o modal depender só de `Esc`:** o botão fecha, o backdrop fecha e o foco vai para dentro dele.
- **Não escrever a URL de dentro do carregador.** `replaceState` disparado durante a carga da própria aba substitui a entrada anterior e o Voltar volta para a mesma tela. A escrita mora no listener, com a intenção explícita: **trocar de aba empilha (`pushState`), mexer em filtro substitui (`replaceState`).**
- **Não deixar um item de grid atravessar linhas** para ganhar largura: ele divide a altura entre elas e abre um vão artificial sob o cartão vizinho mais curto.

## Estado na URL (admin)

`#tab=cadastros&sub=rede&q=…&role=…&status=…&entityType=…&action=…`. O Início e a sub-aba Pessoas são o padrão e **não** entram na URL.

**Regra dura: nada é escrito no load.** O deep link é lido uma vez, depois de `applyLevelGating()` decidir quais abas existem. Sem isso, o boot escreva um hash vazio e quebra o e2e `toHaveURL(/admin\.html$/)`, que exige a URL limpa logo após o login. Ausência de hash é estado válido (Início) — voltar do histórico para `/admin.html` sem hash tem que **voltar ao Início**, não deixar a tela numa aba que a URL não representa.

## Paginação e busca (admin)

Só o que a API realmente aceita — verificado nas rotas, não adivinhado:

| Lista | Mecanismo | Limite |
|---|---|---|
| Usuários | `page`/`pageSize` (offset é derivado, nunca lido) | 25/página, `pageSize` até 100 |
| Auditoria | `page`/`pageSize` — **sem eles a rota cai no modo legado e devolve só os 50 primeiros** | 25/50/100/200 |
| Consultas e exames do dia | pagina até passar de "hoje" (a rota vem `scheduled_at DESC`), com teto de 5 páginas e aviso se estourar | 100/página |
| Unidades, profissionais, doenças, serviços | **filtro no cliente** — nenhuma dessas rotas lê query param | — |

"O Carregar mais" só aparece quando ainda há registro (`total` da API), e o fim da lista é declarado ("Fim da lista — N registro(s)") em vez de truncar em silêncio.

## Overview em tela larga (admin)

Abaixo de 1180px é uma coluna. A partir de 1180px: indicadores na linha inteira e **"Precisa da sua atenção + atalhos" × "Atividade recente"** em duas colunas (7fr/5fr); a partir de 1900px, metades iguais. Os dois lados são células independentes — a atividade não atravessa linhas, senão divide a altura delas e abre um vão sob o cartão curto.

## Do's and Don'ts

Do: um CTA primário por viewport; foco 3px sempre; erro inline + `aria-describedby` (não só toast); validar blur + submit com sumário focável `role=alert`; alvos 44px/8px gap; SVG inline/lucide, nunca emoji como ícone; `prefers-reduced-motion`.
Don't: texto `ink` sobre `primary`, `warning` sobre `warning-bg`; nativos `confirm/prompt/alert`; Inter-as-display PH; gradiente roxo/rosa IA; motion pesado; inventar depoimentos/stats (usar `GET /public/stats` real ou omitir).

## Elevation & Depth

Sutil, não neumórfico (recomendação ui-ux-pro-max Neumorphism rejeitada: risk high + custo contraste). `--shadow-sm` cards, `--shadow` toasts/modais. Sem blur decorativo; blur só para dismissal futuro de modal.

## Shapes

Raio generoso amigável: 14px cards, 9px inputs/botões, 999px badges/pills (`slot-day`), 50% dots/steps, 6px (`radius-xs`) anel de foco e barras finas. Modais: `16px` + scrim `rgba(0,0,0,.45)` + sombra `0 20px 60px rgba(0,0,0,.22)`, via componente `.modal-card` global — os `<style>` injetados por página (admin e dashboard) foram eliminados e as páginas usam a mesma folha. Borda 1–1.5px `border`; edição ativa `2px primary` + glow (`.form-editing`); erro `danger`.

## Components

- Btn: primary branco sobre verde, outline borda `border`; `:active translateY(1px)`; transição 150ms bg/border; futuro: `loadingButton` desabilita + spinner (evita duplo submit).
- Tabs: linha inferior 2.5px; sidebar vira pill esquerda 3px + `primary-100` bg; `has-badge` flex para contador fila.
- Field/input/select/textarea: label 0.85rem 600, padding 11/13, raio sm; erro `.has-error` borda danger + `.field-msg` 0.78rem 600 + `aria-invalid` (via `assets/ui.js:setFieldError`).
- `.opt`: complemento discreto do label (`(opcional)`, `- mínimo 6 caracteres`) — 0.75rem `muted`, peso 400. Vive no design system, não num `<style>` de página: as seis páginas compartilham `assets/styles.css`, e uma regra local só aparecia onde foi escrita.
- Card/item/badge/spinner/toast/slots: `.slot-day` pill toggle, `.slot-time` outline vira preenchido selected, `.slot-summary` dashed; spinner 26px borda rotativa (trocar por skeleton na Fase 3).
- Wizard `.wizard-steps` contador + conector 2px; role-cards 2col selecionável (`radiogroup`).
- Tabs: setas/Home/End navegam e ativam via `assets/ui.js` (auto-init em todo `[role=tablist]`); Esc fecha o diálogo aberto (closer dedicado; senha resolve null).

## Do's and Don'ts

Do: um CTA primário por viewport; foco 3px sempre; erro inline + `aria-describedby` (não só toast); validar blur + submit com sumário focável `role=alert`; alvos 44px/8px gap; SVG inline/lucide, nunca emoji como ícone; `prefers-reduced-motion`.
Don't: texto `ink` sobre `primary`, `warning` sobre `warning-bg`; nativos `confirm/prompt/alert`; Inter-as-display PH; gradiente roxo/rosa IA; motion pesado; inventar depoimentos/stats (usar `GET /public/stats` real ou omitir).
