# ADR-0010: Segundo fator obrigatório para atendente e admin

**Status:** Aceita e implementada (item 1.6 da Fase 8) · **Data:** 2026-11-01 · **Decisor:** responsável pelo projeto · **Achado:** E-24

## Contexto
O ROPA (§4) afirma que o MFA TOTP vale para staff e admin, e o RIPD o usa como mitigação do roubo de sessão. No código ele é opcional para todos: `services/mfa.js` oferece `setup` e `enable` livres, e nada em `middleware/auth.js` consulta `totp_enabled`. Contas de atendente e admin acessam dados de muitos pacientes.

## Decisão
Atendente e admin só usam a API depois de ter o segundo fator ativo:
1. No login, se `role` é `atendente` ou `admin` e `totp_enabled = 0`, a sessão é emitida **restrita**: o access token leva a marca `mfa_setup: true`.
2. Um middleware (`exigirMfaConfigurado`), aplicado depois de `verifyToken`, responde `403` com `code: 'MFA_SETUP_REQUIRED'` a qualquer rota, **exceto** `/auth/mfa/*`, `/auth/me`, `/auth/refresh` e `/auth/logout`.
3. Ao ativar o MFA (`mfa/enable`), a sessão é reemitida sem a marca.
4. O front, ao receber esse `code`, leva a pessoa direto à tela de configurar o segundo fator.
5. Paciente continua com MFA opcional.

**Pontos que estavam em aberto (decididos em 2026-11-03):**
- **Gov.br:** o login pelo Gov.br conta como segundo fator para staff e admin, ou exige também o TOTP? (O padrão proposto é exigir o TOTP, até haver credenciamento que prove o nível da conta.)
- **Perda do aparelho:** hoje o titular desativa o MFA com a própria senha. É preciso definir quem restaura o acesso de um admin que perdeu o aparelho (proposta: `superadmin` redefine o MFA de outro admin, com auditoria, e para o único `superadmin` vale o procedimento em linha de comando).

## Alternativas
- **Prazo de carência com bloqueio depois:** exige coluna nova e adia a proteção.
- **Só corrigir o ROPA e o RIPD:** deixa contas privilegiadas protegidas apenas por senha, com tokens no navegador.

## Consequências
- (+) O que o ROPA e o RIPD afirmam passa a ser verdade; o risco de sessão roubada cai de fato.
- (+) A regra fica em um middleware, não espalhada pelas rotas.
- (−) O seed do `superadmin`, o e2e (ADR-0004, que cria atendente efêmero por API) e os testes de rota de staff e admin precisam configurar o TOTP ou emitir sessão já sem a marca; é trabalho certo da implementação.
- (−) Todo atendente e admin existente precisa configurar o MFA no próximo login.

## Decisões dos pontos em aberto e implementação (2026-11-03)
- **Gov.br:** o login pelo Gov.br **não** conta como segundo fator para atendente e admin. Ele só prova a identidade; quem tem o TOTP ativo recebe o ticket de verificação, e quem não tem recebe a sessão restrita, como no login por senha. Sem credenciamento que prove o nível da conta (prata ou ouro), o sistema não tem como confiar no 2º fator do Gov.br.
- **Perda do aparelho:** o **superadmin** redefine o MFA de outro atendente ou admin em `POST /admin/users/:id/mfa/reset` (capability `admins`, com a **senha de quem redefine**; zera o segredo, encerra sessões e links de redefinição e grava `mfa_reset`). Não vale para a própria conta. Quando nenhum superadmin consegue (o único perdeu o aparelho, ou a conta é de outro superadmin), vale o comando de terminal `npm --prefix server run mfa:reset -- --email <e-mail> [--apply]`, que exige acesso ao servidor e grava `mfa_reset_terminal`.
- **Sessão restrita:** `payloadDoUsuario` marca `mfa_setup: true` para atendente e admin com `totp_enabled = 0`; `verifyToken` responde `403 MFA_SETUP_REQUIRED` a tudo, exceto `/auth/mfa/setup`, `/auth/mfa/enable`, `/auth/me` e `/auth/logout`. A renovação da sessão recalcula a marca a partir do banco.
- **Liberação:** `POST /auth/mfa/enable` devolve um token novo, sem a marca, e o front o grava. Atendente e admin não desativam o próprio MFA (`400`).
- **Front:** `RequireRole` leva a sessão restrita para `/seguranca/mfa` (`MfaSetupPage`, com a senha, a chave em grupos de 4 e o código). O superadmin ganhou "Redefinir segundo fator" no menu de Pessoas (`ResetMfaDialog`). A tela mostra a chave para digitar e o link `otpauth://`; **não há QR code** (o projeto não tem biblioteca de QR e o ADR não pedia uma nova dependência).
- **Testes:** `mfa-obrigatorio.test.js` (servidor), `MfaSetupPage.test.tsx` e os de Pessoas (front) e `e2e/mfa.spec.js` (navegador). No e2e, as contas de atendente e admin ativam o MFA no setup, e cada teste entra com login e código, zerando `totp_last_step` no banco descartável (o helper recusa o banco `saude`).
- **Efeito para quem já usa o sistema:** todo atendente e admin existente configura o MFA no próximo login (contas com sessão aberta só sentem na renovação, em até 15 minutos).