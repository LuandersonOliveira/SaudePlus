# Saúde+ — Registro de Operações de Tratamento (ROPA) + Temporalidade

> Base: LGPD arts. 16, 37. Controladora: Secretaria Municipal de Saúde de
> Lagoa de Itaenga/PE. Operador (software): equipe/fornecedor do Saúde+.
> Revisar a cada mudança de finalidade ou de schema. Versão 1 — 09/10/2026. Revisão: 2026-11-03
> (conferida contra o código, commit `15c5c8c`; achados E-10, E-11, E-15, E-21, E-24, E-26 e E-27).

## 1. Inventário de tratamentos

| # | Dados | Onde | Finalidade | Base legal (LGPD) | Quem acessa | Compartilha com |
|---|---|---|---|---|---|---|
| T1 | Conta + perfil: nome, e-mail, senha (hash), contato, endereço, nascimento, filiação e responsável legal, **dados sensíveis de saúde e origem** (`priority`, `race`, `blood_type`, `gender`) | `users` | Identificar o cidadão e organizar o atendimento | art. 11, II, f (tutela da saúde) + art. 11, II, b / art. 23 (política pública SUS, Lei 8.080/90) | titular (próprio perfil); atendente (sem CPF/RG/CNS); admin (lista sem documentos) | RNDS/e-SUS (Fase 2, com ato formal); **SMTP** (nome e e-mail ao enviar lembrete, aviso de vaga e redefinição de senha) |
| T2 | Documentos (CPF, RG, CNS) | `users` (cifrados AES-256-GCM; `cpf_hmac` = HMAC-SHA256 do CPF com chave própria, só para unicidade e busca, zerado na anonimização). O segredo do MFA (`totp_secret`) também é cifrado (AES-256-GCM, mesma chave) | Unicidade do prontuário + interoperabilidade SUS | idem T1 (mínimo necessário) | o **titular** (`GET /auth/me` e exportação, decifrados); o **admin** só no detalhe individual (`GET /admin/users/:id`, auditado como `admin_view_user_docs`); o envio à RNDS decifra CPF e CNS (auditado). Listas e rotas do atendente não selecionam estes campos | CNS WebService p/ validação (Fase 2); RNDS (Fase 2) |
| T3 | Consultas/exames agendados, incluindo `notes` (texto livre, **sem cifra**) e o nome/local copiados no registro | `appointments`, `exams` | Prestação do serviço de saúde | idem T1 | titular; staff (agenda e histórico do paciente ativo, o histórico é auditado); admin | RNDS (RAC/REL, Fase 2); **SMTP** (especialidade, local e horário no lembrete) |
| T4 | Lembretes (título e mensagem com especialidade, local e horário) e estado de leitura | `reminders` | Continuidade do cuidado | idem T1 | titular (lê e marca como lido) | **SMTP** |
| T5 | Alertas epidemiológicos | `diseases` | Saúde pública (dado agregado, sem titular) | art. 11, II, b | todos logados | painel público futuro (agregado); origem InfoDengue |
| T6 | Sessões | JWT de acesso (15 min, só em memória do navegador) + `refresh_tokens` rotativos (hash; o valor só trafega em cookie HttpOnly) | Segurança do acesso | art. 16, I (cumprimento de obrigação de segurança, art. 46) | sistema | — |
| T7 | Auditoria | `audit_log` (append-only, hash encadeado com triggers) | Responsabilização (art. 6º, X) | art. 16, I | admin (`alertas` não vê) | ANPD/Poder Judiciário se requisitado |
| T8 | Consentimento | `users.privacy_version/consent_at/consent_ip` | Prova da base legal e da versão da política aceita | art. 8º, §3º (ônus da prova) | o titular (na exportação). **Não há consulta administrativa hoje** (achado E-25) | — |
| T9 | Recuperação de senha | `password_reset_tokens` (hash, uso único) | Segurança de conta | art. 16, I | sistema | **SMTP** (link de redefinição) |
| T10 | Lista de espera: serviço, unidade e profissional desejados | `waitlist` | Preencher vagas canceladas por ordem de prioridade legal e de chegada | idem T1 | titular; staff (fila, com nome, e-mail e telefone); admin | **SMTP** (aviso de vaga) |
| T11 | Histórico operacional da agenda: tipo de evento, horários, motivo, autor | `booking_events` | Rastrear remarcações, cancelamentos e desativação de profissional | idem T1 | staff (`GET /staff/booking-events`) | — |
| T12 | Profissionais de saúde: nome, cargo, registro no conselho, vínculo com a conta de atendente | `professionals` (+ ofertas, escalas e bloqueios) | Montar a agenda e identificar quem atende | art. 7º, II e III (execução de política pública; **a confirmar com a Procuradoria**) | todos logados (catálogo de agendamento); admin (gestão) | — |
| T13 | Rede de saúde: unidades e serviços (sem dado de titular) | `health_units`, `unit_offers` | Oferecer os locais e serviços do município | art. 7º, III (**a confirmar**) | todos logados | CNES (sincronização) |

Destinatários fora do sistema que recebem dado pessoal: **SMTP** (operador de e-mail) e **ViaCEP** (o navegador do titular consulta o CEP direto; a política de CSP do site só libera esse host).

## 2. Direitos do titular — como exercer (prazo: 15 dias)

| Direito | Como | Implementação |
|---|---|---|
| Confirmação/acesso (art. 18, I–II) | `GET /auth/me`, `GET /auth/me/export` | ✅ Fase 1 (+ botão no dashboard). A exportação deixa rastro na trilha (`lgpd_export`) |
| Correção (art. 18, III) | `PUT /auth/me` | ✅ existente; deixa rastro (`profile_update`, só os nomes dos campos) |
| Anonimização/eliminação (art. 18, IV/VI) | `DELETE /auth/me` (com a senha); o admin também elimina pelo painel, e há o expurgo por inatividade | ✅ **um só caminho** (`anonymizeUser`, ADR-0009): zera nome, contatos, documentos, endereço, filiação, `govbr_sub`, `consent_ip` e o segundo fator, cancela o futuro e encerra sessões. O histórico vira estatística anônima |
| Portabilidade (art. 18, V) | `GET /auth/me/export` (JSON) | ✅ Fase 1 (credenciais nunca saem) |
| Revogação (fora do SUS) | canal do DPO | ⏳ quando houver tratamento consentido |
| Oposição/revisão automatizada | N/A — sem decisão automatizada (a fila de espera ordena por prioridade legal e chegada, regra pública) | — |

O que **permanece** depois da eliminação, e por quê: a linha em `users` (com `created_at`, `last_login_at`, `consent_at`, `privacy_version`) sem identificação; atendimentos passados sem vínculo identificável (o campo `notes` de atendimentos **passados** não é limpo: só os futuros); e o `audit_log`, imutável por desenho. Linhas da trilha gravadas **antes de 2026-11-02** podem conter nome ou e-mail em `details`; desde então a trilha só guarda identificadores e dados operacionais (ADR-0012).

## 3. Temporalidade e expurgo

| Dado | Guarda por | Depois |
|---|---|---|
| Conta ativa | enquanto ativa | — |
| Conta paciente inativa | 5 anos sem login (`RETENTION_INACTIVE_YEARS`) | anonimização por `npm run purge:retention -- --apply`. **Roda quando alguém executa**; ainda não há agendador (achado C-01) |
| Conta excluída pelo admin antes do ADR-0009 | — | `npm --prefix server run anonimizar:excluidos -- --apply` (correção única; o banco de desenvolvimento não tinha nenhuma) |
| Consultas/exames passados | prazos legais do SUS (validar com Procuradoria) | mantidos sem vínculo identificável, para estatística; `notes` permanece |
| `refresh_tokens` revogados/expirados | 90 dias | DELETE físico no expurgo (manual) |
| `password_reset_tokens` usados/expirados | **previsto: 24h** após expiração/uso | **ainda não implementado**: nenhum script os apaga (achado C-01) |
| `reminders`, `waitlist`, `booking_events` | **sem prazo definido** | decidir com a Procuradoria; hoje nada os apaga |
| `audit_log` | prazo legal + prescrição (validar; sugerido 5 anos) | avaliação jurídica antes de qualquer remoção (hoje: sem remoção) |
| Backups | ciclo do backup + criptografia | o script `backup.js` gera o arquivo e o hash; **não há teste automático de restauração** (achado C-06) nem agendamento no código |

## 4. Segurança (resumo — detalhe em PLANO_RNDS_LGPD.md)

Sessão curta (access token de 15 min **só em memória**; refresh rotativo em **cookie HttpOnly**, com detecção de reuso e prazo absoluto da família; o corpo das respostas não leva o refresh — ADR-0011); bcrypt; **MFA TOTP obrigatório para atendente e admin** (sessão restrita até configurar; o Gov.br não substitui o segundo fator; redefinição só por superadmin, com a senha dele, ou por terminal — ADR-0010) e opcional para paciente; CPF/RG/CNS e segredo do MFA cifrados (AES-256-GCM, chave em `DATA_ENCRYPTION_KEY`, futuro KMS/Vault); `cpf_hmac` com chave própria; TLS em produção; CORS por allowlist ou mesma origem (também barra `Origin` de outro site em `/auth/refresh` e `/auth/logout`); helmet; rate-limit global e por `/auth`; validação server-side (CPF/CNS); RBAC por papel + `admin_level` com falha fechada; anonimização transacional; audit append-only com hash encadeado, `details` sanitizado e **sem nome, e-mail ou registro profissional** (ADR-0012); `.env` fora do git. **16 tabelas** no schema.
