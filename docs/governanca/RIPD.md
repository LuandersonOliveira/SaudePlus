# Saúde+ — Relatório de Impacto à Proteção de Dados (RIPD) — minuta Fase 1

> LGPD art. 38. Minuta técnica para a Secretaria/DPO validar com a Procuradoria
> antes da produção. Reavaliar a cada fase (RNDS = novo RIPD). Revisão: 2026-11-03
> (conferida contra o código, commit `15c5c8c`; ver `docs/tecnico/SYSTEM_DESIGN_ACHADOS.md`).

## 1. Necessidade e proporcionalidade

O Saúde+ trata dados sensíveis de saúde **em larga escala municipal** para agendar
e acompanhar atendimento SUS. Sem o sistema, o tratamento ocorreria em papel/
planilhas, com **menos** controle. A coleta limita-se ao necessário ao agendamento
e à unicidade do prontuário (CPF/CNS); `rg/filiação/referência` devem ser
reavaliados na minimização contínua (Fase 1, item 5 do plano). Também são
dados sensíveis, e entram na mesma avaliação, a **cor/raça** (`race`), a **prioridade
legal** (`priority`, que revela condição de saúde ou idade) e o **tipo sanguíneo**.

## 2. Riscos mapeados × medidas

| Risco | Prob. × Impacto | Medida implementada | Residual |
|---|---|---|---|
| Vazamento de banco (dump) expõe CPF/RG/CNS e o segredo do MFA (permitiria gerar os códigos de qualquer usuário) | M × Alto | AES-256-GCM em coluna (inclui `totp_secret`) + backups gzip/SHA-256 + futuro TDE/KMS (Fase 1) | Baixo |
| Vazamento do banco expõe os **dados não cifrados**: nome, e-mail, telefone, endereço, nascimento, filiação, `race`, `priority` e o texto livre de `notes` | M × Alto | Acesso ao banco restrito; backups em disco; **sem cifra por coluna** nesses campos | **Médio** — avaliar cifra dos campos sensíveis (`race`, `priority`, `notes`) |
| Vazamento da `CPF_HMAC_KEY` permite confirmar CPFs candidatos contra o `cpf_hmac` de um dump | B × Médio | Chave separada da de cifra, fora do repositório e dos backups do banco; exigida no boot; rotação por `npm --prefix server run migrate:cpf:rehash`; `doctor` recusa chave igual à de cifra | Baixo |
| Roubo de sessão (XSS, dispositivo compartilhado) | M × Alto | Access token de 15 min **só em memória** e refresh em **cookie HttpOnly**, sem token em `localStorage` nem no corpo das respostas (ADR-0011); refresh rotativo com detecção de reuso; logout revogatório; **MFA TOTP obrigatório para atendente e admin** (ADR-0010); `Origin` de outro site recusado em `/auth/refresh` e `/auth/logout` | Baixo (antes de 2026-11-03 era Baixo **só no papel**: os dois tokens ficavam em `localStorage` e o MFA era opcional) |
| Acesso indevido por atendente/admin | M × Médio | RBAC + `requireCapability` + CPF/RG/CNS fora das listas e das rotas do atendente + auditoria de visualização (`admin_view_user_docs`, `staff_view_history`) + MFA obrigatório | Baixo. Pendente: escopo do atendente em `/staff/agenda/reports` e `/staff/booking-events` (item 3.2 da Fase 8) |
| Perda do aparelho do MFA / uso indevido da redefinição | B × Alto | Só superadmin redefine o MFA de outra conta, exigindo a **própria senha**, e grava `mfa_reset`; o caso do único superadmin vai por terminal (`mfa:reset`) e grava `mfa_reset_terminal`; sessões e links de redefinição da conta caem junto | Baixo |
| Força bruta em login | M × Médio | Rate-limit duplo (global + `/auth`) + bloqueio 5/5min + 429 (contadores **em memória por processo**) | Baixo com uma instância; revisar com mais de uma (achado E-05) |
| Perda de trilha (alteração de log) | B × Alto | `audit_log` append-only (trigger) + hash encadeado + verificação + `details` sanitizado | Baixo |
| **Dado pessoal gravado na trilha imutável** | B × Médio | Desde 2026-11-02 o `details` só leva identificadores e dados operacionais, e `sanitizeDetails` mascara e-mail e CPF (ADR-0012). A anonimização preserva a trilha | **Residual:** linhas anteriores a 2026-11-02 podem conter nome ou e-mail e **não podem ser editadas**; o campo livre `motivo` digitado pelo admin não é filtrado |
| Titular eliminado ainda identificável | B × Alto | Eliminação única por anonimização (ADR-0009), que zera também `govbr_sub`, `consent_ip` e o segundo fator; a exclusão administrativa usa o mesmo caminho | Baixo. Resta o texto livre `notes` de atendimentos passados (sem vínculo, mas sem limpeza) |
| Retenção excessiva | M × Médio | Temporalidade (ROPA §3) e script de expurgo | **Médio:** o expurgo é manual, a limpeza dos tokens de redefinição de senha não existe e `reminders`, `waitlist` e `booking_events` não têm prazo (achado C-01) |
| Perda de dados / recuperação | B × Alto | Backup por script (`backup.js`, com hash; a frequência depende de quem agenda no sistema operacional) | **Médio:** sem teste automático de restauração nem agendamento no código (achado C-06) |
| Compartilhamento com terceiros | B × Médio | **SMTP** recebe nome, e-mail e dados do atendimento nos lembretes; **ViaCEP** recebe o CEP pelo navegador | A formalizar: contrato/DPA com o provedor de e-mail e avaliar o envio de dado de saúde por e-mail |
| Compartilhamento indevido (RNDS futuro) | — × Alto | Ato formal + base legal expressa + pseudonimização p/ estatística (Fase 2); o envio à RNDS é auditado | A reavaliar |

## 3. Parecer (minuta)

Diante das medidas das Fases 0–1 e da Fase 8 (ondas 1 e 2 em andamento), o tratamento é **proporcional à finalidade SUS**,
desde que: (a) DPO nomeado e canal público ativo; (b) `privacy.html` + ROPA
aprovados pela Procuradoria; (c) TLS/HSTS e chave em KMS/Vault em produção;
(d) capacitação de atendentes; (e) novo RIPD antes da integração RNDS;
(f) decididos o prazo de guarda de `reminders`, `waitlist` e `booking_events` e o
agendamento do expurgo; (g) avaliada a cifra dos campos sensíveis não cifrados.

Assinaturas: _____________ (DPO) · _____________ (Secretaria) · data: ___/___/___
