# Saúde+ — Direito e legislação em informática (guia prático)

## 1. LGPD (Lei 13.709/2018) — base de tudo aqui

- Dados de saúde = **sensíveis** (art. 11): só com as hipóteses do artigo.
  Usamos: tutela da saúde (II, f) + política pública (II, b + art. 23).
- Direitos do titular (art. 18) implementados: acesso/exportação, correção,
  anonimização/eliminação, portabilidade (`/auth/me/*` + botões no dashboard).
- Segurança (art. 46) implementada: cripto, MFA, trilhas, backups (ver SoA).
- **Sanções ANPD** (art. 52, dosimetria ativa): até 2% do faturamento por
  infração (teto R$ 50 mi), + publicização e bloqueio dos dados. Por isso o
  RIPD e o playbook de incidentes existem.
- Encarregado (art. 41): `GET /public/dpo` — canal público existe; nomear pessoa real antes da produção.

## 2. Marco Civil da Internet (Lei 12.965/2014) — o que nos obriga

- **Guarda de registros de acesso** (art. 13): 6 meses (provedores de conexão);
  aplicações (art. 15): registros de acesso por 6 meses, em sigilo.
  → Nosso `audit_log` cumpre e excede (temporalidade em `docs/ROPA.md §3`).
- **Responsabilidade por conteúdo de terceiros** (art. 19): só após ordem
  judicial (regra geral) — relevante para observações digitadas por usuários.
- **Neutralidade e privacidade** (arts. 3º, 7º): sigilo das comunicações →
  **TLS/HSTS obrigatório em produção** (pendente de deploy).

## 3. Lei Carolina Dieckmann (Lei 12.737/2012 — art. 154-A do CP)

- Criminaliza **invasão de dispositivo** para obter/adulterar dados (detenção
  3 meses–1 ano + multa; aumenta se houver divulgação).
  → Medidas do projeto que reduzem o risco penal da operação: MFA, rate-limit,
  logs que identificam o invasor, backups contra ransomware.

## 4. Mapa lei → controle implementado

| Exigência legal | Onde está no código/doc |
|---|---|
| LGPD art. 11 (base p/ sensível) | `privacy.html` + ROPA T1–T3 |
| LGPD art. 18 (direitos) | `GET /auth/me/export`, `DELETE /auth/me`, botões dashboard |
| LGPD art. 41 (encarregado) | `GET /public/dpo` (canal público; nomear pessoa real) |
| LGPD art. 46/48 (segurança/incidente) | SoA + `RESPOSTA_INCIDENTES.md` |
| Marco Civil art. 13/15 (logs 6 meses) | `audit_log` + ROPA §3 |
| Marco Civil art. 7º (sigilo) | TLS/HSTS em produção (pendente de deploy) |
| CP art. 154-A (invasão) | MFA TOTP + rate-limit + trilhas (dissuasão e prova) |

> Revisão: 2026-10-26.
