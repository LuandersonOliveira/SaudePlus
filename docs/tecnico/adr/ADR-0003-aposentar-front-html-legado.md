# ADR-0003 — Aposentar o front HTML legado

**Status:** Aceita · **Data:** 2026-11-01 · **Commit:** `d5b799c` (reversível com `git revert d5b799c`) · **Decisor:** responsável pelo projeto (confirmou a remoção)

## Contexto
Com o React cobrindo atendente, paciente, admin e páginas públicas, e a suíte e2e nova (28 testes) passando, o legado era código duplicado. Cerca de 200 casos de teste do servidor existiam só para ler esses HTMLs como texto.

## Decisão
Remover `admin/atendente/dashboard/auth/index/privacy.html`, `assets/{api,ui,agenda}.js`, `scripts/serve-web.js` e o script `dev:legacy`; remover ou reduzir os testes estáticos que dependiam deles (`frontend-high`, `escaping`, `web-server`, `dev-stack`, `admin-user-form`, `dashboard-multiprof`; reduzidos: `mfa-setup`, `stylesheet`, `doctor`). Manter `event-manager-demo.html` + `assets/event-manager.*` + `assets/styles.css` + fonte, que a demo ainda usa.

## Alternativas
- **Manter como fallback** — dobra a manutenção e deixa duas implementações divergirem (já havia divergências: reagendar sem motivo, máscara de CNS).
- **Apagar também a demo `event-manager`** — era trabalho anterior do responsável, sem uso no React; preservado até haver decisão.

## Consequências
- (+) Superfície menor; uma só implementação de cada tela.
- (+) Fim dos testes de "texto de HTML".
- (−) Os testes de escape de XSS do legado perderam o objeto; no React, `dangerouslySetInnerHTML` existe só em `components/ui/chart.tsx` (CSS de tema, sem dado de usuário). Vale um lint que proíba novo uso.
- (−) A API na raiz permanece só para compatibilidade (ADR-0002).
