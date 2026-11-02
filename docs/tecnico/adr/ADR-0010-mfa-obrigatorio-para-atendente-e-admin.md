# ADR-0010: Segundo fator obrigatório para atendente e admin

**Status:** Aceita (não implementada) · **Data:** 2026-11-01 · **Decisor:** responsável pelo projeto · **Achado:** E-24

## Contexto
O ROPA (§4) afirma que o MFA TOTP vale para staff e admin, e o RIPD o usa como mitigação do roubo de sessão. No código ele é opcional para todos: `services/mfa.js` oferece `setup` e `enable` livres, e nada em `middleware/auth.js` consulta `totp_enabled`. Contas de atendente e admin acessam dados de muitos pacientes.

## Decisão
Atendente e admin só usam a API depois de ter o segundo fator ativo:
1. No login, se `role` é `atendente` ou `admin` e `totp_enabled = 0`, a sessão é emitida **restrita**: o access token leva a marca `mfa_setup: true`.
2. Um middleware (`exigirMfaConfigurado`), aplicado depois de `verifyToken`, responde `403` com `code: 'MFA_SETUP_REQUIRED'` a qualquer rota, **exceto** `/auth/mfa/*`, `/auth/me`, `/auth/refresh` e `/auth/logout`.
3. Ao ativar o MFA (`mfa/enable`), a sessão é reemitida sem a marca.
4. O front, ao receber esse `code`, leva a pessoa direto à tela de configurar o segundo fator.
5. Paciente continua com MFA opcional.

**Pontos em aberto, a decidir antes de implementar:**
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
