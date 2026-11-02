# ADR-0009: Eliminação de conta é uma só: anonimização completa

**Status:** Aceita (não implementada) · **Data:** 2026-11-01 · **Decisor:** responsável pelo projeto · **Achados:** E-10, E-11 (`SYSTEM_DESIGN_ACHADOS.md`)

## Contexto
Hoje existem dois "apagar" com efeitos diferentes. O titular (`DELETE /auth/me`) e o expurgo de inatividade chamam `anonymizeUser`, que zera os identificadores. O admin (`DELETE /admin/users/:id`) só preenche `deleted_at` (`repositories/usuarios.js`, `excluirLogicamente`) e deixa todos os dados pessoais na linha. Além disso, `anonymizeUser` não zera `govbr_sub`, `consent_ip`, `totp_secret` nem `totp_enabled`, que continuam identificando a pessoa ou guardando segredo. O ROPA e o RIPD dizem que a eliminação remove tudo que identifica o titular.

## Decisão
1. `DELETE /admin/users/:id` passa a chamar `anonymizeUser` (transação única, auditoria `lgpd_delete`). Existe um só caminho de eliminação.
2. `anonymizeUser` passa a zerar também `govbr_sub`, `consent_ip`, `totp_secret` e `totp_enabled`.
3. Inativar (reversível) continua sendo `PATCH` de `account_status`.
4. As regras de hierarquia e de conta própria do admin (`utils/adminHierarchy`) continuam valendo antes da eliminação.

## Alternativas
- **Manter o soft delete do admin e documentar:** deixa dado pessoal retido sem prazo e contraria o que o ROPA afirma.
- **Dois botões (inativar e anonimizar):** o inativar já existe como mudança de status; um segundo botão de "excluir" só reintroduziria a ambiguidade.

## Consequências
- (+) Um conceito, uma implementação, uma prova (testes de `lgpd-anonymization`).
- (+) ROPA, RIPD e código passam a dizer a mesma coisa.
- (−) A exclusão pelo admin deixa de ser reversível. A interface precisa de confirmação explícita, e o texto deve mandar usar "inativar" quando a intenção for reversível.
- (−) O e-mail do titular continua reservado (`removido_<id>@removido.local` é único por id), então não há reaproveitamento de e-mail.
- A migration não é necessária: contas já "excluídas" pelo admin precisam ser anonimizadas por um script único de correção, a rodar uma vez e a auditar.
