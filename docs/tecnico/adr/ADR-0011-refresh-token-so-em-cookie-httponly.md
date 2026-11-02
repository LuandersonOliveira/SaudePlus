# ADR-0011: Refresh token só em cookie HttpOnly; access token só em memória

**Status:** Aceita (não implementada) · **Data:** 2026-11-01 · **Decisor:** responsável pelo projeto · **Achado:** E-21

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
