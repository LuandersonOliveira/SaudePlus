# ADR-0011: Refresh token só em cookie HttpOnly; access token só em memória

**Status:** Aceita e implementada (item 1.5 da Fase 8) · **Data:** 2026-11-01 · **Decisor:** responsável pelo projeto · **Achado:** E-21

## Contexto
O front guarda o JWT de acesso e o refresh token em `localStorage` (`web/src/lib/session.ts`). O servidor devolve o refresh também no corpo de `login`, `mfa/verify`, `refresh` e `govbr/callback`, e aceita o refresh vindo do corpo antes do cookie (`readRefreshRaw` em `services/session.js`). Qualquer XSS lê os dois tokens. O cookie `saude_refresh` já existe: `httpOnly`, `sameSite: 'lax'`, `secure` em produção e com `Path` que segue o ponto de montagem (`/api/auth`).

## Decisão
1. O refresh token **só trafega por cookie HttpOnly**. As respostas deixam de incluir `refreshToken`, e o servidor deixa de aceitá-lo no corpo.
2. O access token (15 min) fica **só em memória** no front. `localStorage` guarda no máximo dados de exibição do usuário, nunca token.
3. Ao abrir ou recarregar a página, o front chama `POST /auth/refresh` (o navegador envia o cookie) para obter um novo access token antes de renderizar rotas protegidas.
4. CSRF: o cookie é `SameSite=Lax` e `/auth/refresh` é `POST` com corpo JSON; o servidor passa a recusar `POST /auth/refresh` e `/auth/logout` cujo `Origin` não esteja na lista permitida (a mesma de CORS).

## Alternativas
- **Tudo em cookie HttpOnly:** exige proteção CSRF em toda rota que muda estado e uma mudança maior no front e na API, sem ganho proporcional agora.
- **Manter `localStorage` e reforçar a CSP:** reduz o risco de XSS, mas não o elimina; o roubo do token continuaria possível e o RIPD teria de registrar o risco como aceito.

## Consequências
- (+) Um XSS deixa de entregar o refresh token; o access token roubado vale no máximo 15 minutos.
- (+) O contrato fica único (cookie), sem o caminho duplo corpo/cookie.
- (−) Quebra o contrato atual: `web/src/lib/api.ts`, `session.ts`, `api.test.ts`, `AuthPage.test.tsx`, `e2e/global-setup.js` e os testes de `session-service` e de rota que leem `refreshToken` do corpo precisam mudar junto.
- (−) Sem `SERVE_WEB` (API e front em origens diferentes) o cookie `Lax` não acompanha chamadas entre origens; o modo suportado passa a ser a origem única (ADR-0002), e o modo separado só vale em desenvolvimento com proxy.
- (−) O primeiro carregamento ganha uma ida ao servidor.

## Implementação (2026-11-03)
- **Servidor:** nenhuma resposta devolve `refreshToken`; `readRefreshRaw` só lê o cookie `saude_refresh` (token no corpo dá 401 e não é consumido). Testes: `auth-refresh-cookie.test.js`, `refresh-prazo.test.js`, `session-service.test.js`.
- **Front:** access token só em memória (`lib/session.ts`); as chaves antigas `saude_token` e `saude_refresh` são apagadas ao carregar. `AuthProvider` recupera a sessão com `POST /auth/refresh` e expõe `ready`; `RequireRole`, `AuthPage` e a landing esperam por ele (`SessionLoading`). Uma renovação por vez: promessa compartilhada na aba e Web Locks API (`saude-refresh-sessao`) entre abas, para que várias abas abertas juntas não reapresentem um token já girado.
- **Dev:** o proxy do Vite reescreve o `Path` do cookie de `/auth` para `/api/auth` (`cookiePathRewrite`); sem isso o cookie nunca voltaria ao servidor.
- **e2e:** cada teste faz o próprio login por API e monta o `storageState` com o cookie daquela sessão (`e2e/fixtures.js`, opção `papel`); o `global-setup` só valida as contas, espera a API em `/health` e apaga descritores de execuções anteriores. Isso ajusta o ADR-0004: a sessão continua criada por API, mas por teste, não uma vez para a suíte.
- **CSRF:** a checagem de `Origin` já vinha do `cors` global, que recusa origem de outro site em toda a API. Faltava aceitar a MESMA origem (origem única, ADR-0002): em produção com `SERVE_WEB`, todo POST do navegador voltava 403 a menos que `CORS_ORIGIN` repetisse o endereço do próprio site. `middleware/origin.js` passou a aceitar `Origin` com o mesmo host da requisição, e há testes de regressão para `/auth/refresh` e `/auth/logout`.