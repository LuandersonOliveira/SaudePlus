# Saúde+ — Manual da trilha de auditoria (Aula 8)

> Auditoria é **sistemática, independente, documentada e baseada em evidência**.
> **Achado = evidência comparada com o critério** (ex.: "log X mostra acesso sem MFA" vs critério "N1 da PSI").  
> Revisão: 2026-10-26.

## 1. Tipos e quando usar

| Tipo | Quem faz | Uso no Saúde+ |
|---|---|---|
| Interna (1ª parte) | Equipe independente da operação | Trimestral: roda §3 + `verify` |
| 2ª parte | Secretaria (cliente) sobre o operador | Anual, antes de renovar contrato |
| 3ª parte | Certificadora | Quando buscar ISO 27001 |

## 2. Abordagens (todas aplicáveis aqui)

- **Ao redor do computador:** compara entrada × saída (ex.: confere no painel do
  paciente se o que o atendente confirmou aparece igual).
- **Através do computador:** examina lógica e configuração (ler `auth.js`,
  `booking.js`, triggers do banco).
- **Com o computador:** SQL/scripts prontos (§3) + `GET /admin/audit-log/verify`.

## 3. Kit do auditor — queries "com o computador" (somente leitura!)

```sql
-- Quem viu documentos sensíveis nos últimos 30 dias?
SELECT u.full_name, COUNT(*) AS acessos
FROM audit_log al JOIN users u ON u.id = al.actor_id
WHERE al.action = 'admin_view_user_docs' AND al.created_at > NOW() - INTERVAL 30 DAY
GROUP BY u.full_name;

-- Alterações de status sem motivo registrado?
SELECT * FROM audit_log
WHERE action = 'admin_update_user' AND details NOT LIKE '%motivo:%';

-- Logins com MFA vs sem MFA (últimos 30 dias)?
SELECT action, COUNT(*) FROM audit_log
WHERE action IN ('mfa_login', 'govbr_login') AND created_at > NOW() - INTERVAL 30 DAY
GROUP BY action;

-- Cadeia íntegra? (via API, sem SQL destrutivo)
-- GET /admin/audit-log/verify  -> { ok, checked, head }
```

⛔ O auditor usa usuário **só-leitura** do banco; nunca `UPDATE/DELETE` (o trigger
bloqueia mesmo assim — teste isso como evidência de controle!).

## 4. Achado → correção × ação corretiva (Aula 5)

- **Correção (sintoma):** ex. reativar trigger que faltava.
- **Ação corretiva (causa):** ex. incluir `migrate:security` no checklist de
  deploy para o trigger nunca faltar. Registre causa raiz no relatório.

## 5. Programa anual (modelo)

| Quando | O quê | Evidência |
|---|---|---|
| Mensal | `verify` da cadeia + backup restore-teste (amostra) | print/JSON do `verify` |
| Trimestral | Kit §3 + revisão SoA + acessos `pendente` parados | relatório 1 página |
| Anual | 2ª parte + RIPD + teste de restore completo | ata + RIPD assinado |
