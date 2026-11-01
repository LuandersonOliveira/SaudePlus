# ADR-0005 — E-mail e senha de conta admin só mudam por `superadmin`

**Status:** Aceita · **Data:** 2026-10 · **Implementação:** `server/src/routes/admin.users.routes.js`; testes `server/test/admin-user-update.test.js` (11 casos)

## Contexto
Uma revisão de segurança durante a migração do painel de Pessoas mostrou que qualquer nível com a capability `users` (ex.: `gestor`) podia trocar o e-mail ou a senha de uma conta **admin** — inclusive de um `superadmin` — o que equivale a tomar a conta.

## Decisão
Alterar e-mail ou senha de uma conta com `role = admin` exige a capability `admins` (só `superadmin`). A trava de e-mail só dispara quando o e-mail **realmente muda** (reenviar o mesmo valor é inofensivo). O front espelha a regra: campos desabilitados para quem não pode, com a explicação; o servidor continua sendo a autoridade (devolve 403).

## Alternativas
- **Apenas esconder os campos no front** — não protege contra chamada direta à API.
- **Bloquear toda edição de admins por gestor** — impediria ajustes legítimos (telefone, status) sem ganho de segurança.

## Consequências
- (+) Fecha o caminho de escalada de privilégio por troca de credencial.
- (+) Regra testada no servidor e na UI.
- (−) Recuperar o acesso de um admin depende de um `superadmin`; para o único `superadmin`, vale o fluxo de recuperação de senha por e-mail.
