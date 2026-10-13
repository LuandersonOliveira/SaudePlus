# Saúde+ — Registro de Operações de Tratamento (ROPA) + Temporalidade

> Base: LGPD arts. 16, 37. Controladora: Secretaria Municipal de Saúde de
> Lagoa de Itaenga/PE. Operador (software): equipe/fornecedor do Saúde+.
> Revisar a cada mudança de finalidade ou de schema. Versão 1 — 09/10/2026.

## 1. Inventário de tratamentos

| # | Dados | Onde | Finalidade | Base legal (LGPD) | Quem acessa | Compartilha com |
|---|---|---|---|---|---|---|
| T1 | Conta + perfil (nome, e-mail, senha-hash, endereço, perfil saúde) | `users` | Identificar o cidadão e organizar o atendimento | art. 11, II, f (tutela da saúde) + art. 11, II, b / art. 23 (política pública SUS, Lei 8.080/90) | titular; atendente (sem CPF/RG); admin | RNDS/e-SUS (Fase 2, com ato formal) |
| T2 | Documentos (CPF, RG, CNS) | `users` (cifrados AES-256-GCM) | Unicidade do prontuário + interoperabilidade SUS | idem T1 (mínimo necessário) | só admin (logado em auditoria) | CNS WebService p/ validação (Fase 2) |
| T3 | Consultas/exames agendados | `appointments`, `exams` | Prestação do serviço de saúde | idem T1 | titular; staff; admin | RNDS (RAC/REL, Fase 2) |
| T4 | Lembretes | `reminders` | Continuidade do cuidado | idem T1 | titular | — |
| T5 | Alertas epidemiológicos | `diseases` | Saúde pública (dado agregado, sem titular) | art. 11, II, b | todos logados | painel público futuro (agregado) |
| T6 | Sessões | JWT (15 min) + `refresh_tokens` (hash) | Segurança do acesso | art. 16, I (cumprimento de obrigação de segurança, art. 46) | sistema | — |
| T7 | Auditoria | `audit_log` (append-only) | Responsabilização (art. 6º, X) | art. 16, I | admin (`alertas` não vê) | ANPD/Poder Judiciário se requisitado |
| T8 | Consentimento | `users.privacy_version/consent_at/consent_ip` | Prova da base legal e da versão da política aceita | art. 8º, §3º (ônus da prova) | admin | — |

## 2. Direitos do titular — como exercer (prazo: 15 dias)

| Direito | Como | Implementação |
|---|---|---|
| Confirmação/acesso (art. 18, I–II) | `GET /auth/me`, `GET /auth/me/export` | ✅ Fase 1 (+ botão no dashboard) |
| Correção (art. 18, III) | `PUT /auth/me` | ✅ existente |
| Anonimização/eliminação (art. 18, IV/VI) | `DELETE /auth/me` + expurgo automático | ✅ Fase 1 (anonimiza; histórico vira estatística) |
| Portabilidade (art. 18, V) | `GET /auth/me/export` (JSON) | ✅ Fase 1 |
| Revogação (fora do SUS) | canal do DPO | ⏳ quando houver tratamento consentido |
| Oposição/revisão automatizada | N/A — sem decisão automatizada | — |

## 3. Temporalidade e expurgo

| Dado | Guarda por | Depois |
|---|---|---|
| Conta ativa | enquanto ativa | — |
| Conta paciente inativa | 5 anos sem login (`RETENTION_INACTIVE_YEARS`) | anonimização automática (`npm run purge:retention -- --apply`) |
| Consultas/exames passados | prazos legais do SUS (validar com Procuradoria) | mantidos anonimizados p/ estatística |
| `refresh_tokens` revogados/expirados | 90 dias | DELETE físico no expurgo |
| `audit_log` | prazo legal + prescrição (validar; sugerido 5 anos) | avaliação jurídica antes de qualquer remoção (hoje: sem remoção) |
| Backups | ciclo do backup + criptografia | restore testado; expurgo acompanha a base |

## 4. Segurança (resumo — detalhe em PLANO_RNDS_LGPD.md)

Sessão curta + refresh rotativo; bcrypt; CPF/RG/CNS cifrados (AES-256-GCM, chave em
`DATA_ENCRYPTION_KEY`, futuro KMS/Vault); TLS em produção; CORS allowlist; helmet;
rate-limit; validação server-side (CPF/CNS); RBAC por papel + `admin_level`;
audit append-only com `details` sanitizado; `.env` fora do git.
