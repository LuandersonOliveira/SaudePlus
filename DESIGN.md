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

Inter variável (100–900) autohospedada em `assets/fonts/inter-latin.woff2` com `display:swap` — zero request externo (Fase 2). H1 800 clamp, H2 1.5rem, H3 1.15rem, corpo 16px/1.55. Nos painéis, a hierarquia é h1→h2→h3 sem saltos: títulos de card/diálogo são h2 com 1.15rem e subseções/itens são h3 com 1rem (regras em `styles.css`, Fase 2) — o visual é idêntico ao antigo h3/h4. Detector marca Inter como overused-font (slop): mantido por decisão — legibilidade + offline + familiaridade SUS valem mais que distinção; distinção vem da composição lagoa, não da face. Futura: hospedar local em `assets/fonts/` para rural instável; avaliar Atkinson Hyperlegible só se teste mostrar ganho real.

## Layout

`--maxw:1080px`, `.container 32px 20px 64px`. Grids: `.grid-2/3/4/5` colapsam <760px; dentro de `app-shell` colapsam mais cedo (1300px/1150px) porque rail rouba 256px. Rail: `grid 256px 1fr`, sticky 100vh, vira topbar rolável <980px e empilha <620px. Hero `72px 20px 96px` centrado, max 680/560px. Linha 35–75 chars implícita; sem scroll horizontal.

## Elevation & Depth

Sutil, não neumórfico (recomendação ui-ux-pro-max Neumorphism rejeitada: risk high + custo contraste). `--shadow-sm` cards, `--shadow` toasts/modais. Sem blur decorativo; blur só para dismissal futuro de modal.

## Shapes

Raio generoso amigável: 14px cards, 9px inputs/botões, 999px badges/pills (`slot-day`), 50% dots/steps, 6px (`radius-xs`) anel de foco e barras finas. Exceção intencional: modais `16px` + scrim `rgba(0,0,0,.45)` + sombra `0 20px 60px rgba(0,0,0,.22)` (templates injetados em dashboard/atendente/admin — unificar só em redesign). Borda 1–1.5px `border`; edição ativa `2px primary` + glow (`.form-editing`); erro `danger`.

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
