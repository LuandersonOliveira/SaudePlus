# Saúde+ — Governança, risco e papéis (Aulas 2–4)

## 1. Governança × gestão

- **Governança (o QUÊ):** avalia, direciona e monitora. Dono: Secretaria/Direção.
- **Gestão (o COMO):** planeja, executa e mede. Dono: equipe técnica do Saúde+.

## 2. Três linhas

| Linha | Quem | Faz o quê no projeto |
|---|---|---|
| 1ª — Operação | Atendentes, admins do dia a dia | Usa o sistema, confirma agendamentos, guarda credenciais |
| 2ª — Riscos e compliance | DPO + responsável segurança | ROPA, RIPD, revisa trilhas, cobra controles deste doc |
| 3ª — Auditoria interna | Independente (não opera o sistema) | Verifica a trilha (`verify`), confere SoA, reporta à Direção |

⚠️ **Autorrevisão é ameaça à independência:** quem codificou o controle não audita o próprio controle.

## 3. Papéis (RACI resumido)

| Papel | Responsabilidade | RACI no incidente |
|---|---|---|
| **Direção** | Aceita formalmente os riscos críticos/residuais | Aprova |
| **CISO** (ou responsável segurança) | Ativos, controles, backups, resposta técnica | Realiza |
| **DPO** | Direitos dos titulares, ANPD, ROPA/RIPD | Consultado + comunica ANPD/titulares |
| Operação | Seguir PSI, não compartilhar credenciais | Informada |

## 4. Ameaças (Aula 2/3) e onde batem

- **Passivas** (só escutam; difíceis de detectar, previnem-se com cripto): sniffing no Wi-Fi do posto → **TLS em produção**; dump do banco → **AES-256 em coluna**.
- **Ativas** (alteram; fáceis de detectar, difíceis de evitar): força bruta → **rate-limit + bloqueio**; alteração de prontuário → **hash encadeado detecta**; DoS → **rate-limit global**; spoofing de atendente → **MFA**.
- Regra de ouro: o atacante precisa de **1** brecha; a defesa fecha todas as camadas.

## 5. Matriz de risco (Risco = Probabilidade × Impacto, 1–3)

| Risco | P × I = R | Tratamento | Residual | Aceito por |
|---|---|---|---|---|
| Vazamento do banco expõe documentos | 2×3=6 | Mitigar: AES-256 + TDE/backups | 2 (baixo) | Direção |
| Roubo de sessão | 2×3=6 | Mitigar: 15min + refresh rotativo + MFA p/ staff | 2 | Direção |
| Alteração silenciosa da trilha | 1×3=3 | Mitigar: append-only + hash encadeado + verify | 1 | Direção |
| Ransomware apaga banco sem backup | 2×3=6 | Mitigar: backup diário + teste de restore | 2 | Direção |
| Compartilhamento indevido (RNDS) | 1×3=3 | Evitar até credenciamento + novo RIPD | 1 | Direção |

## 6. PDCA do SGSI (Aula 1/5)

- **Plan:** este doc + SoA + RIPD. **Do:** Fases 0–2 + controles. **Check:** `verify` da trilha, `smoke-test`, revisão trimestral da SoA, `npm audit` crítico no CI. **Act:** corrigir causa (não sintoma) e atualizar docs.

> Revisão: 2026-10-26.
