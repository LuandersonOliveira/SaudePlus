# Saúde+ — Política de Segurança da Informação (PSI) — Aula 7

> Hierarquia: **Política** (o que fazer) → **Norma** (regra obrigatória) →
> **Procedimento** (como fazer) → **Diretriz** (recomendação).
> Aprovação: Direção. Revisão: anual ou após incidente. Revisão: 2026-10-26. Exceção: formal, com
> prazo e aceite do risco pela Direção.

## POLÍTICA (aprovada pela Direção em ___/___/___)

1. Dados de saúde são sensíveis: acesso mínimo necessário, sempre autenticado.
2. Nenhum dado sensível em texto puro fora do banco cifrado.
3. Toda ação administrativa é registrada em trilha imutável e verificável.
4. Credenciais são pessoais e intransferíveis; staff usa segundo fator.
5. Incidente de segurança é comunicado ao CISO/DPO em até 24h.

## NORMAS (obrigatórias)

- N1. Senhas: mínimo 6 (sistema) / administradores e atendentes com MFA ativo.
- N2. Proibido compartilhar usuário/senha, inclusive entre turnos do posto.
- N3. Acesso a CPF/RG/CNS restrito a `admin`; visualização é auditada.
- N4. `.env` e backups nunca em repositório, e-mail ou pendrive sem cripto.
- N5. Estação do posto: tela bloqueada ao se ausentar; antivírus atualizado.
- N6. Alteração em produção só com revisão + `smoke-test` verde.

## PROCEDIMENTOS (onde está o "como")

- P1. Ativar atendente: `admin.html → Cadastros → Pessoas → status ativo + motivo`.
- P2. Responder incidente: `docs/governanca/RESPOSTA_INCIDENTES.md`.
- P3. Backup/restore: `npm run backup` (diário); restore em `docs/governanca/TRILHA_AUDITORIA.md §5`.
- P4. Expurgo: `npm run purge:retention -- --apply` (dry-run primeiro).
- P5. Auditar a trilha: botão **Verificar integridade** (Auditoria) ou `GET /admin/audit-log/verify`.

## DIRETRIZES (recomendado)

- D1. Prefira conta Gov.br prata/ouro quando disponível (Fase 2.3).
- D2. Revise a SoA (`docs/SOA_27001.md`) a cada trimestre.
- D3. Treine a operação contra phishing a cada 6 meses.

## EXCEÇÕES

| Exceção | Motivo | Prazo | Aceito por |
|---|---|---|---|
| *(nenhuma — modelo)* | | | Direção |
