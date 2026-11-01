# ADR-0004 — E2E com sessão criada por API e conta de atendente efêmera

**Status:** Aceita · **Data:** 2026-11-01 · **Implementação:** `e2e/global-setup.js`, `e2e/fixtures.js`

## Contexto
`/auth/login` é limitado (60 tentativas/15 min) e trava o IP. Um login pela tela por teste estourava o limite e os últimos testes falhavam por infraestrutura. Além disso, criar uma conta de atendente com senha fixa no código, num banco que pode ser o real, seria uma credencial conhecida.

## Decisão
O `globalSetup` autentica **por API** (uma vez por papel) e grava o `storageState` com as chaves de sessão do React (`saude_token`, `saude_user`, `saude_refresh`). O atendente de teste é criado pelo admin com **senha aleatória a cada execução** (guardada em `e2e/.auth/creds.json`, ignorado pelo git); se a conta já existir e `E2E_STAFF_PASSWORD` não for informada, os testes de atendente são pulados. A tela de login é coberta por `login.spec.js` (poucos logins reais).

## Alternativas
- **Login pela tela em cada teste** — esbarra no rate limit.
- **Senha fixa do atendente** — credencial conhecida em qualquer banco onde rodar.
- **Mock da API** — perderia o que o e2e existe para verificar (integração real).

## Consequências
- (+) Suíte rápida e estável (28 testes em ~2 min); sem credencial fixa de atendente.
- (+) Rodar contra banco descartável é o padrão recomendado.
- (−) O formato de sessão no `localStorage` é um contrato implícito entre o setup e o app (`web/src/lib/session.ts`): mudar as chaves exige atualizar o setup.
- (−) Executar contra o banco real cria dados de teste (`Atendente E2E`, itens "PW …").
