# ADR-0001 — Front em React + Vite + TypeScript + shadcn/ui

**Status:** Aceita · **Data:** 2026-10 (migração concluída em 2026-11-01) · **Decisores:** equipe do projeto (pedido do responsável)

## Contexto
O front original eram 6 páginas HTML com JS puro (`admin.html` ≈ 2,8 mil linhas, estado em variáveis globais, HTML montado por strings). Cada mudança exigia testes estáticos que liam o HTML como texto, e bugs como botão sem ação por apóstrofo em `onclick` eram recorrentes. Pedido: React, Vite, shadcn/ui, Radix, Tailwind, Recharts, Zod e Vitest.

## Decisão
App em `web/`: React 19 + Vite + TypeScript, Tailwind v4, shadcn/ui (Radix), React Router, React Query, react-hook-form + Zod, Recharts, Vitest. Migração incremental por área (público → atendente → paciente → admin), com `features/{staff,patient,admin}` carregadas sob demanda.

## Alternativas
- **Manter HTML + JS puro** — sem componentização nem tipos; custo de manutenção crescente.
- **Next.js** — SSR desnecessário (painéis autenticados, sem SEO) e exigiria outro servidor.
- **Vue/Svelte** — não pedidos, sem ganho que compense a troca de ecossistema.

## Consequências
- (+) Componentes reutilizáveis, tipos, testes de comportamento (336 Vitest) e e2e reais.
- (+) Acessibilidade herdada do Radix; escape de HTML por padrão (JSX).
- (−) Etapa de build; dependência de ecossistema JS com atualização frequente.
- (−) Bundle principal 555 kB (A8 da análise).
- Os servidores seguem como API JSON; o contrato HTTP não mudou.
