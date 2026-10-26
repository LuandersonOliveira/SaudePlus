# Saúde+ — Playbook de Resposta a Incidentes (LGPD art. 48)

> Revisão: 2026-10-26.

## 1. Triagem (até 24h)

1. **Conter:** revogar `JWT_SECRET` (invalida todas as sessões) + `UPDATE refresh_tokens SET revoked = 1`;
   bloquear IP/origem; snapshot do banco antes de qualquer correção.
2. **Classificar:** que dados? (credencial / CPF-RG-CNS / prontuário), quantos titulares,
   causa provável (vazamento, ransomware, acesso indevido interno).
3. **Preservar evidência:** copiar `audit_log` + logs do servidor para local imutável
   (NÃO apagar nada — `audit_log` é append-only por trigger).

## 2. Comunicação (prazos legais)

- **ANPD:** em até **3 dias úteis** se houver risco relevante (art. 48 + regulamentação).
- **Titulares:** sem demora indevida quando houver risco a direitos (modelo de aviso no §4).
- **Interno:** DPO → Secretaria → Procuradoria. Registrar tudo em processo administrativo.

## 3. Investigação e correção

- Cruzar `audit_log` (`admin_view_user_docs`, `staff_update`, `lgpd_delete`, `auth_refresh_reuse_detected`) com janela do incidente.
- Rodar `npm run smoke-test` + revisar `CORS_ORIGIN`, acessos DB, dependências (`npm audit`).
- Lições aprendidas → atualizar RIPD e este playbook.

## 4. Modelo de aviso ao titular

> Identificamos acesso indevido a [dados] em [data]. Medidas tomadas: [sessões
> invalidadas, acesso bloqueado, reforço X]. Riscos possíveis: [phishing em seu
> nome, ...]. O que fazer: [trocar senha, desconfiar de contatos]. Canal do DPO:
> [nome — e-mail]. Pedimos desculpas e seguimos à disposição.
