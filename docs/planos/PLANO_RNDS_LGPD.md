# Saúde+ — Plano RNDS + LGPD + Hardening (Fases 0–2)

> Documento de planejamento para transformar o Saúde+ em sistema apto a operar
> numa Secretaria Municipal de Saúde (Lagoa de Itaenga/PE), com interoperabilidade
> SUS (RNDS/FHIR) e conformidade LGPD para dados sensíveis de saúde.
> Criado em 09/10/2026 a partir da leitura do código atual. Revisão: 2026-10-26.

## 0. Ponto de partida (o que já existe — verificado no código)

- Auth JWT (`middleware/auth.js`: `verifyToken`, `requireAdmin`, `requireStaff`,
  `requireCapability` por `admin_level`) + redirecionamento por papel no front.
- Brute-force no login: 5 tentativas/IP/5 min com 429 (`auth.routes.js`).
- CPF com dígito verificador + CNS com checagem de 15 dígitos no signup.
- Isolamento `WHERE user_id = ?` nas rotas `/me/*`; staff omite `cpf/rg`.
- `audit_log` + `logAction()` (mas **mutável**: aceita `UPDATE/DELETE`, sem trigger).
- Paginação só em `GET /admin/users`; demais listagens usam `LIMIT` sem `page/total`.
- `CORS_ORIGIN` com fallback `*`; sem `helmet`, sem rate-limit global, sem limite de JSON.
- JWT default `7d` em `localStorage`, sem refresh, sem revogação.
- `health_units` com seed CNES manual; `diseases` cadastrado à mão; ViaCEP no front.

## 1. Fase 0 — Hardening sem quebra (ESTA ENTREGA)

Objetivo: fechar os buracos críticos **sem quebrar** `admin.html`, `dashboard.html`,
`atendente.html` nem o `smoke-test.js` existente.

| # | Item | Onde | Critério de aceite |
|---|---|---|---|
| 0.1 | `helmet()` + `express.json({limit:'100kb'})` + CORS allowlist (sem `*`) | `src/app.js` | `GET /health` retorna `X-Content-Type-Options: nosniff`; origem fora da lista recebe 500/CORS block, não dado |
| 0.2 | Rate-limit global (300 req/15 min/IP) + auth estrito (20 req/15 min/IP em `/auth`) | `src/app.js`, `src/middleware/rateLimit.js` | Login excedente retorna 429 JSON; rotas legadas continuam 401 sem token |
| 0.3 | Access token curto (default `15m`) + refresh rotativo 30d em `httpOnly` cookie + body | `auth.routes.js`, `middleware/auth.js`, `migration_002` | Login retorna `{token, refreshToken, user}` + cookie; `POST /auth/refresh` rotaciona (reuso detectado = revoga cadeia); `POST /auth/logout` revoga; front antigo que ignora `refreshToken` continua funcionando até o access expirar |
| 0.4 | Validação server-side padronizada: CPF (dígito), **CNS com checksum real**, e-mail, datas | `src/utils/validators.js` (novo, `zod`) | CNS inválido → 400 (antes só checava length); signup com dado ruim não chega ao SQL |
| 0.5 | Paginação padrão `?page=&pageSize=` com envelope `{data,page,pageSize,total}` **quando solicitada**, array legado caso contrário | `admin.routes.js`, `staff.routes.js` | `GET /admin/appointments?page=2&pageSize=10` retorna envelope; sem query retorna array como hoje (front não quebra) |
| 0.6 | `audit_log` append-only: triggers que bloqueiam `UPDATE`/`DELETE` + `details` sanitizado (sem senha/token/CPF completo) | `migration_002_security.sql`, `utils/audit.js` | `UPDATE audit_log` falha com `SIGNAL 45000`; detalhe com `cpf` vira `[redigido]` |
| 0.7 | `.env.example` + README atualizados; `smoke-test` estendido (headers + refresh + paginação) | vários | `npm run smoke-test` verde cobrindo Fase 0 |

Dependências novas: `helmet`, `express-rate-limit`, `cookie-parser`, `zod`.

## 2. Fase 1 — Governança LGPD (próxima)

1. **ROPA + RIPD**: inventariar tratamentos (`users`, `appointments`, `exams`, `audit_log`,
   futuro RNDS); RIPD antes da produção (dado sensível em larga escala).
2. **DPO/Encarregado** + canal de titular (trocar `contato@saudemais.app` fictício).
3. **`privacy.html` jurídica** + base legal por finalidade (art. 11, II, f — tutela da
   saúde; art. 11, II, b + art. 23 — política pública SUS). Consentimento destacado só
   fora da finalidade SUS.
4. **Direitos do titular**: `GET /me/export` (portabilidade), `DELETE /me` (eliminação
   com retenção legal), prazo 15 dias.
5. **Minimização**: revisar ~30 colunas de `users` (ex. `rg/filiação` realmente necessários?).
6. **Retenção/expurgo**: tabela de temporalidade + job de anonimização.
7. **Resposta a incidentes**: playbook (ANPD em 3 dias úteis + titular se houver risco).
8. **Contratos**: prefeitura (controladora) × fornecedor (operador), art. 39; vedação de
   uso econômico de dado de saúde (art. 11, §§3º–4º).
9. **Cripto em repouso**: TDE MySQL + `AES-256-GCM` em `cpf/rg/cns` via KMS/Vault;
   backups criptografados com teste de restore.

## 3. Fase 2 — Interoperabilidade SUS (ordem sugerida)

> **Alvo municipal ainda não confirmado.** O sistema usado pela Secretaria de
> Lagoa de Itaenga será apurado na descoberta institucional
> ([`DESCOBERTA_SAUDE_DIGITAL.md`](../tecnico/DESCOBERTA_SAUDE_DIGITAL.md)); o desenho
> técnico e os gates estão em
> [`INTEROPERABILIDADE.md`](../tecnico/INTEROPERABILIDADE.md). A ordem abaixo assume
> RNDS como rota primária e não autoriza integração com nenhum fornecedor
> local antes dos gates G1–G7.

| Ordem | Integração | Mapeamento com o Saúde+ |
|---|---|---|
| 2.1 | **CNES sync** ✅ (`scripts/sync-cnes.js`, dry-run default; `CNES_MUNICIPIO_CODE=260850` corrigido via IBGE — era 260890) | Upsert em `health_units` (`cnes_code`+`phone`+`address`, migration 004); 27 lidos, 20 relevantes (9 seeds casadas por nome + 11 novas); executado em 09/10/2026 |
| 2.2 | **Alertas automáticos** ✅ (`scripts/sync-alerts.js`, InfoDengue/Fiocruz; `source='infodengue'`, nunca toca `source='manual'`) | Dengue+Chikungunya nível baixo (SE 202636–639, 9 casos dengue); Zika sem dados; executado em 09/10/2026 |
| 2.3 | **Login Gov.br** ✅ scaffold (`services/govbr.js`, `GET /auth/govbr/login`, `GET /auth/govbr/callback`; 501 sem credencial; nunca cria usuário — vincula por `govbr_sub`/e-mail/CPF) | Falta: client homologado em `sso.acesso.gov.br` + conta prata/ouro |
| 2.4 | **CNS WebService** ✅ camada pronta (`services/cns.js`: normalização + dedup por CNS/CPF+nascimento testados offline em `scripts/test-cns.js`; `lookupByCns()` 501 sem credencial) | Falta: credenciamento DATASUS (e-CNPJ + certificado) para `CNS_WS_BASE_URL`/`CNS_WS_LOOKUP_PATH`; wiring no signup fica para quando a credencial chegar |
| 2.5 | **RNDS FHIR R4** ✅ camada pronta (`services/rnds.js`: builders RAC + validador + mTLS; `scripts/test-rnds.js` 7/7 offline; `POST /interop/rnds/send`, `GET /interopatatus`) | Falta: credenciamento (e-CNPJ + CNES), validar Bundle no validador DATASUS, **novo RIPD** antes de enviar dado real |
| 2.6 | **e-SUS APS/SISAB via e-Gestor AB** ⏳ (organizacional, com a Secretaria) | evita prontuário paralelo: dado entra uma vez, vale no SUS inteiro |

### Diff previsto no código (Fase 2, resumo)

```text
server/src/app.js                → ✅ monta /interop/* (requireStaff)
server/src/routes/auth.routes.js → ✅ GET /auth/govbr/login, GET /auth/govbr/callback
server/src/services/rnds.js      → ✅ EHR Auth mTLS + POST Bundle FHIR R4 + validador
server/src/services/govbr.js     → ✅ OIDC (authorize, token, userinfo)
server/src/services/cnes.js      → ✅ CNES → health_units (dry-run default)
server/src/services/infodengue.js→ ✅ InfoDengue → diseases (source='infodengue')
server/src/services/cns.js       → ✅ normalização + dedup CNS/CPF+nascimento; lookupByCns() 501 sem credencial
server/src/routes/interop.routes.js → ✅ GET /interop/status (+ cns), POST /interop/rnds/send
server/scripts/sync-cnes.js / sync-alerts.js / test-rnds.js / test-cns.js → ✅ + npm scripts
server/scripts/migrate-interop.js→ ✅ cnes_code/phone/address, govbr_sub, source/external_ref
dashboard.html                   → ⏳ aba "Meu histórico SUS" (após RNDS homologado)
```

Referências: `https://servicos-datasus.saude.gov.br/` (credenciamento),
`https://rnds-fhir.saude.gov.br/` (IG FHIR), `https://apidadosabertos.saude.gov.br/`
(CNES), guias ANPD poder público + e-SUS APS/LGPD.
