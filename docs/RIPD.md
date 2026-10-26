# Saúde+ — Relatório de Impacto à Proteção de Dados (RIPD) — minuta Fase 1

> LGPD art. 38. Minuta técnica para a Secretaria/DPO validar com a Procuradoria
> antes da produção. Reavaliar a cada fase (RNDS = novo RIPD). Revisão: 2026-10-26.

## 1. Necessidade e proporcionalidade

O Saúde+ trata dados sensíveis de saúde **em larga escala municipal** para agendar
e acompanhar atendimento SUS. Sem o sistema, o tratamento ocorreria em papel/
planilhas, com **menos** controle. A coleta limita-se ao necessário ao agendamento
e à unicidade do prontuário (CPF/CNS); `rg/filiação/referência` devem ser
reavaliados na minimização contínua (Fase 1, item 5 do plano).

## 2. Riscos mapeados × medidas

| Risco | Prob. × Impacto | Medida implementada | Residual |
|---|---|---|---|
| Vazamento de banco (dump) expõe CPF/RG/CNS | M × Alto | AES-256-GCM em coluna + backups gzip/SHA-256 + futuro TDE/KMS (Fase 1) | Baixo |
| Roubo de sessão (XSS, dispositivo compartilhado) | M × Alto | Access 15 min + refresh rotativo com detecção de reuso + logout revogatório + MFA TOTP | Baixo |
| Acesso indevido por atendente/admin | M × Médio | RBAC + `requireCapability` + CPF/RG ocultos do staff + auditoria de visualização (`admin_view_user_docs`) | Baixo |
| Força bruta em login | M × Médio | Rate-limit duplo (global + `/auth`) + bloqueio 5/5min + 429 | Baixo |
| Perda de trilha (alteração de log) | B × Alto | `audit_log` append-only (trigger) + hash encadeado + verificação + `details` sanitizado | Baixo |
| Retenção excessiva | M × Médio | Expurgo automático 5 anos + temporalidade (ROPA §3) | Baixo |
| Compartilhamento indevido (RNDS futuro) | — × Alto | Ato formal + base legal expressa + pseudonimização p/ estatística (Fase 2) | A reavaliar |

## 3. Parecer (minuta)

Diante das medidas das Fases 0–1, o tratamento é **proporcional à finalidade SUS**,
desde que: (a) DPO nomeado e canal público ativo; (b) `privacy.html` + ROPA
aprovados pela Procuradoria; (c) TLS/HSTS e chave em KMS/Vault em produção;
(d) capacitação de atendentes; (e) novo RIPD antes da integração RNDS.

Assinaturas: _____________ (DPO) · _____________ (Secretaria) · data: ___/___/___
