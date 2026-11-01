# ADR-0002 — Origem única: Express serve `web/dist` e a API fica em `/api`

**Status:** Aceita · **Data:** 2026-11-01 · **Implementação:** `server/src/web.js`, `server/src/app.js`, teste `server/test/web-serving.test.js`

## Contexto
Em desenvolvimento o front (Vite, :8080) e a API (:4000) são processos separados, ligados por proxy de `/api`. Em produção, dois servidores exigiriam CORS, dois deploys e uma origem a mais para proteger. As rotas do React (`/auth`, `/admin`) colidem com rotas da API de mesmo nome se ambos ocupam a raiz.

## Decisão
Com `SERVE_WEB=1` (ou `NODE_ENV=production` com `web/dist` presente) o Express entrega o build do React com fallback de SPA e a API responde **só** em `/api`. Desligado, a API continua na raiz (compatibilidade com testes e ferramentas) e também em `/api`. Assets com hash: `Cache-Control: immutable` de 1 ano; `index.html`: `no-cache`. CSP do helmet liberando apenas o próprio site e `viacep.com.br`. Sem build presente, avisa e sobe só a API.

## Alternativas
- **Nginx/CDN na frente servindo os estáticos** — melhor em escala, mas exige infraestrutura que o projeto ainda não tem; pode ser adotado depois sem mudar o código (o contrato `/api` já é o mesmo).
- **Dois serviços com CORS** — mais peças, mais superfície.

## Consequências
- (+) Um processo, um deploy, sem CORS em produção.
- (+) O link do e-mail de redefinição usa a mesma origem (`APP_BASE_URL/auth?tab=reset…`).
- (−) O Node passa a servir arquivos estáticos (aceitável nesta escala; trocar por proxy reverso se o tráfego crescer).
- (−) A API tem dois endereços enquanto o modo legado existir.
