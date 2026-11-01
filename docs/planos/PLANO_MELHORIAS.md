# Plano de Melhorias — Saúde+ (Lagoa Conectada)

Análise gerada em 2026-07-20. Atualizado em 2026-10-26 com base em verificação do código.

## Visão geral do projeto

- **Frontend**: HTML5/CSS3/JS puro (sem build step), 5 páginas (`index`, `auth`, `dashboard`, `admin`, `atendente`) + `assets/api.js` (cliente HTTP) + `assets/styles.css`.
- **Backend**: Node/Express, MySQL via `mysql2/promise`. Auth com access token curto + refresh rotativo; sessões gerenciadas com cookies httpOnly/secure em produção.
- **Domínio**: agendamento de consultas/exames, alertas de doenças por região, lembretes, unidades de saúde e gestão administrativa para a rede de Lagoa de Itaenga.
- **Papéis**: `paciente`, `atendente` (precisa ativação), `admin` com `admin_level` granular (`superadmin`, `gestor`, `atendimento`, `alertas`).
- **Repositório**: git inicializado (há histórico). Schema em `server/schema.sql` com **14 tabelas** (inclui `refresh_tokens` e `password_reset_tokens`; `professionals.user_id` presente).
- **Fonte**: Inter autohospedada em `assets/fonts/` (sem Google Fonts).
- **Migrations**: `migrate:all` cobre migrações incluindo `professional-user` entre v3 e security.

Pontos fortes já presentes no código (vale reconhecer, não é tudo dívida técnica):
- SQL 100% parametrizado (`?` bindings) em todas as rotas — sem injeção SQL.
- Isolamento por `user_id` consistente em rotas `/me/*`.
- `password_hash` nunca retornado; CPF/RG restritos a admin.
- Log de auditoria (`audit_log`) em ações administrativas.
- Separação clara de middleware (`verifyToken`, `requireAdmin`, `requireStaff`).

## Achados por prioridade

### 🔴 Crítico — segurança

1. **`.env`**: manter fora do VCS (verificado). Girar segredos antes de qualquer deploy real. Existe `server/.env.example` para template.
2. **Rate limiting**: aplicado em rotas sensíveis (login e recuperação de senha). Ainda avaliar hardening por IP em produção.
3. **Tokens**: access curto (15 min), refresh rotativo (30d) com revogação por família/reuso; logout revoga. HttpOnly/secure em produção conforme configuração. Ainda há atenção a XSS (sanitização presente) e necessidade de HTTPS/HSTS em produção.
4. **Segurança HTTP**: Helmet e CORS configurados. Revisar configuração por ambiente.
5. **Validação**: há validações no backend (incluindo CPF/formatos e regras de agendamento). Manter cobertura e aplicar em todos os fluxos críticos.
6. **HTTPS/produção**: pendente configurar HTTPS/HSTS e revisar política de cookies por ambiente.
7. **MFA**: TOTP implementado com tentativas limitadas e proteção contra replay.

### 🟠 Alto — robustez / correção

8. **Testes**: 327 testes `node:test` passando + `test:race` + E2E Playwright (29/29 verificados). Cobertura em expansão contínua.
9. **`.env.example`**: presente em `server/`.
10. **Rotas de agendamento**: já há consolidações em partes, mas ainda pode haver duplicação entre camadas; manter revisão ao evoluir.
11. **Reminders**: geração automática implementada (job diário) com persistência e exibição no painel do paciente. Envio por e-mail quando SMTP configurado.
12. **Paginação**: implementada em partes nas listagens administrativas.
13. **Tratamento de erro**: melhorado (tradução de alguns erros e respostas mais claras). Continuar padronizando.
14. **Promoção de papéis**: controlada por capability (`admins` com permissão para promover admin). Alterações registradas com trilha.

### 🟡 Médio — manutenibilidade / DX

15. **Lint/formatter**: ESLint configurado (`eslint.config.mjs`), `npm run lint`. Prettier opcional.
16. **CI**: `.github/workflows/ci.yml` com lint, suíte + E2E (MySQL 8.4 + Playwright Chromium) e `npm audit critical`.
17. **Tipagem**: JS puro com JSDoc em pontos críticos; migração incremental para TS ainda opcional.
18. **Frontend**: `assets/api.js` global funcional; estrutura atual atende escopo.
19. **Root package.json**: existe com scripts `dev`, `test`, `lint`, `setup`, `doctor`.
20. **Datas**: validação de formato/futuro aplicada em fluxos críticos (backend). Manter em todos os endpoints.

### 🟢 Baixo — nice-to-have

21. **Sem paginação/UI de busca "carregar mais"** no admin/atendente além do limite fixo.
22. **Sem internacionalização** (tudo hardcoded em pt-BR) — não é problema para escopo atual (produto local), só registrar como decisão consciente.
23. **`migrate-supabase.js`** sugere origem migrada de Supabase/Postgres para MySQL — script de migração populado mas não documentado quando/se ainda é necessário rodar.
24. **Sem monitoramento/logs estruturados** (só `console.error`) — sem correlação de request, sem log level.

### 🔵 Recebimento de dados e formulário de cadastro (campo a campo)

Análise do wizard de cadastro (`auth.html`, hoje em 2 passos — na época deste diagnóstico eram 4) cruzada com o que a rota `POST /auth/signup` (`auth.routes.js`) realmente valida. Achado central: **o front valida muito mais do que o back exige** — toda a integridade de dado de cadastro hoje depende do JS do navegador, não do servidor. Qualquer chamada direta à API (Postman, script, front alternativo) contorna 100% dessas regras.

**Campo `job_role` (cargo/função do atendente) — o exemplo citado**
25. **`job_role` é texto livre** (`<input id="jobRoleInput" placeholder="Ex: Recepcionista, Médico, Enfermeiro...">`, `auth.html`) em vez de seletor fechado. Efeito prático: mesmo cargo vira 5 strings diferentes no banco ("Enfermeira", "enfermeiro", "Enferm.", "ENFERMEIRA(O)"), quebrando qualquer filtro/relatório por cargo no admin. Ação: trocar por `<select>` com lista fixa de cargos da rede de saúde (Recepcionista, Enfermeiro(a), Médico(a), Motorista, Auxiliar Administrativo, Outro — com campo livre condicional só para "Outro", no mesmo padrão já usado em "Especialidade" no dashboard).

**Inconsistência de obrigatoriedade entre front e back**
26. **CPF e RG são `required` no HTML (passo 2) mas opcionais na API** (`auth.routes.js:56`: `cpf || null, rg || null`) — o back aceita cadastro sem CPF/RG se chamado diretamente. Mesma lacuna em `birth_date`, `gender`, `mother_name`, `mobile`: todos `required` no front, todos opcionais no back (`|| null` em cada um). Ação: decidir a regra uma vez (provavelmente: CPF/RG/nascimento realmente obrigatórios para paciente de saúde pública) e replicar no back com `if (!cpf) return res.status(400)...`, não só no HTML.
27. **`password` confirmado (`s4_confirm`) só é comparado no client** (`submitSignup`) — a rota `/auth/signup` nunca recebe nem checa confirmação; não é falha de segurança (senha ainda é hasheada certo), mas mostra o padrão geral: back confia cegamente no front para regra de negócio.

**Validação de formato ausente (aceita estrutura, não valida conteúdo)**
28. **CPF sem dígito verificador**: `maskCpf()` só formata `000.000.000-00`, nunca calcula os dígitos verificadores. `111.111.111-11` (estruturalmente "válido") passa em front e back. Para app com dado de saúde vinculado a CPF, isso é o principal campo de deduplicação/identificação de paciente — vale adicionar validação de dígito verificador (função pura, sem lib).
29. **Email sem validação real no back** — `auth.routes.js` só faz `.toLowerCase().trim()`; `a@b` passa. O front usa `type="email"` (validação HTML5, contorna-se com DevTools ou request direto).
30. **Celular/telefone sem validação de DDD/tamanho real** — máscara aceita qualquer sequência de dígitos no formato `(00) 00000-0000`, incluindo DDDs inexistentes no Brasil (`(00)`, `(01)`).
31. **Datas de agendamento (`scheduled_at`) sem checagem de "não pode ser no passado" no back** — só o front trava via `min` no `datetime-local` (`nowLocalForInput()` no dashboard). Chamada direta à API aceita qualquer data, passada ou futura.

**Passo a passo do wizard — pontos de fricção/qualidade de dado**
32. **CEP preenche endereço mas todos os campos continuam livremente editáveis sem revalidação** — usuário pode buscar CEP de Lagoa de Itaenga (autopreenche cidade/UF corretos) e depois apagar e digitar outra cidade/estado manualmente, sem qualquer alerta de inconsistência. Para um sistema de saúde regional (o propósito é atender **a rede local**), vale pelo menos um aviso soft se `city`/`state` final não bater com o que o CEP indicou.
33. **`zone` (urbana/rural) e `reference_point` são obrigatórios para todo mundo**, inclusive quem já preencheu CEP + número + rua completos (tipicamente zona urbana com endereço formal). Ponto de referência faz sentido para zona rural (onde CEP/numeração é menos confiável), mas forçá-lo sempre é fricção desnecessária para quem já deu endereço completo — poderia ser condicional a `zone === 'rural'` ou pelo menos deixar de ser `*` obrigatório na zona urbana.
34. **Validação do wizard é só "forward"**: `validateStep2()`/`validateStep3()` rodam ao clicar "Continuar", mas `submitSignup()` (passo 4, envio final) não re-valida os passos anteriores. Se o usuário volta ao passo 2 pelo botão "Voltar", apaga um campo obrigatório e vai direto ao passo 4 sem clicar "Continuar" de novo (não é possível pela UI atual, mas o código não impede logicamente), o envio ainda tentaria seguir. Mais relevante: como o back aceita os mesmos campos como opcionais (achado #26), esse é um caso onde duas camadas fracas se somam em vez de uma compensar a outra.
35. **Nenhum campo do wizard mostra o que realmente é obrigatório *por que*** — ex.: não fica claro para o paciente por que CPF/RG são pedidos (LGPD/transparência) nem o que acontece se ele não tiver RG (idoso que só tem CPF, por exemplo). Um subtexto curto por campo sensível ajudaria tanto usabilidade quanto conformidade com LGPD (finalidade do dado coletado).

### 🔵 Recebimento de dados — telas de usuário, admin e atendente

Mesma análise campo a campo aplicada agora às 3 telas internas (`dashboard.html`, `admin.html`, `atendente.html`), cruzando o que cada formulário pede com o que a rota correspondente valida.

**Tela de usuário/paciente (`dashboard.html`) — formulários de agendamento**
36. **Campos "tipo" com opções fechadas incompletas**: `exam_type` (select fixo de 9 opções + Outro) **não tem campo livre condicional para "Outro"**, ao contrário de `specialty` que já tem esse padrão (`specialtyOutra`). Selecionar "Outro" em exame não captura *qual* outro — o dado se perde. Ação: replicar o padrão `__outra` + input condicional já usado em Especialidade.
37. **`location` de consulta/exame vem de um `<select>` alimentado por `GET /health-units`** — bom (evita texto livre, já é o padrão certo), mas o catálogo tem só 10 unidades cadastradas via seed SQL, sem endpoint de cadastro/manutenção pelo admin. Se uma unidade fechar ou abrir, exige `UPDATE` manual no banco — não há tela para isso em `admin.html`, apesar de o admin gerenciar doenças, usuários e diseases pela UI.
38. **Campo `notes`/`reason` (observações/motivo) sem limite de caracteres visível** — `TEXT` no banco aceita praticamente ilimitado, textarea não tem `maxlength`; não é bug, mas nenhum feedback de tamanho ao usuário que escreve muito.
39. **Nenhum campo de agendamento pergunta se é reagendamento de algo cancelado/relacionado** — usuário que teve consulta cancelada e quer remarcar preenche um formulário do zero, sem vínculo com o registro anterior (perde rastreabilidade de "essa é a 2ª tentativa").

**Tela admin (`admin.html`)**
40. **Formulário "Cadastrar doença/alerta": campo `region` é texto livre** (`<input name="region">`), igual ao problema do `job_role` (achado #25) — mesma doença cadastrada por dois admins diferentes vira "Centro", "centro", "Zona Centro" no banco, quebrando filtro por região no dashboard do paciente (`/diseases?active=true` não agrupa por região normalizada). O projeto já tem um catálogo de bairros padronizado (`health_units.neighborhood`, ex.: "Centro", "Salinas", "Vila Boa Esperança") — ação: reaproveitar essa mesma lista como `<select>` em vez de reinventar texto livre.
41. **Reagendamento usa `prompt()` nativo do navegador pedindo data digitada à mão** (`adminReagendar`: `prompt('Nova data/hora (formato: AAAA-MM-DD HH:MM)...')`) — sem datepicker, sem máscara, sem validação de formato antes do envio. E o back (`admin.routes.js` `PATCH /:kind/:id`) também não valida formato: `if (scheduled_at) { updates.push('scheduled_at=?'); ... }` aceita qualquer string. Um admin que digita `20/08/2026` (formato comum no Brasil) em vez de `2026-08-20 14:30` provavelmente grava data inválida ou `NULL`/erro silencioso no MySQL sem feedback claro do motivo. Mesmo problema idêntico em `atendente.html` (`reagendar`). Ação: trocar `prompt()` por um modal com `<input type="datetime-local">` (já usado nos outros formulários do app) + validação de data futura no back.
42. **Duas telas de busca de usuário fazendo quase a mesma coisa com UX diferente** (já sinalizado no plano de UI/UX, achado #13) — reforçando aqui pelo ângulo de dado: `Histórico` exige e-mail (mas back aceita `LIKE`, então parcial já funcionaria), `Usuários` aceita nome/e-mail parcial + filtro de papel. A tela `Histórico` está artificialmente mais restritiva que a própria API permite.
43. **Alteração de status de conta (ativar/inativar usuário) não pede motivo/observação** — o formulário é só um `<select>` + botão "Salvar status"; o audit log grava apenas `status -> inativo`, sem contexto de *por que* (ex.: solicitação do próprio paciente, suspeita de fraude, atendente desligado da rede). Para rastreabilidade real em decisão administrativa sensível, vale um campo de observação opcional que vá para `details` do audit log.
44. **Papel (`role`) do usuário só é mostrado como texto informativo** ("alteração de papel somente via banco de dados diretamente") — correto como decisão de segurança (já sinalizado no achado #14), mas do ponto de vista de dado/operação, cria um processo manual fora do sistema sem trilha de auditoria alguma (mudança direta no banco não gera linha em `audit_log`). Se a intenção é realmente restringir, valeria pelo menos uma rotina/script auditado para promoção de papel, não acesso direto ao banco sem registro.

**Tela atendente (`atendente.html`)**
45. **Mesmo problema de `prompt()` para reagendar** (achado #41) replicado aqui — terceira cópia do mesmo padrão frágil (admin, atendente, e implicitamente qualquer telas futuras que copiarem o padrão).
46. **Busca de paciente (`GET /staff/patients?q=`) só retorna pacientes com `account_status = 'ativo'`** (hardcoded em `staff.routes.js`) — se o atendente busca um paciente inativo ou pendente, a busca simplesmente não retorna nada, sem nenhuma mensagem explicando que existe um cadastro mas está inativo. Do ponto de vista de recepção/atendimento presencial, isso pode ser confundido com "paciente nunca se cadastrou", levando a cadastro duplicado. Ação: back poderia diferenciar "não encontrado" de "encontrado mas inativo" (com mensagem apropriada, sem vazar dado sensível).
47. **Cargo do atendente (`job_role`) é exibido em texto livre no cabeçalho** (`greetingSub`: `SESSION.user.job_role + ' · ' + 'Painel de atendimento'`) — consequência direta de #25: como o dado de origem é texto livre, a saudação também herda qualquer inconsistência de digitação ("recepcionista" minúsculo, com/sem acento, etc.).

## Plano de ação sugerido (ordem recomendada)

### Fase 1 — Segurança básica (deploy)
- [x] Rate limiting em rotas sensíveis (login, recuperação de senha).
- [x] Helmet e CORS configurados.
- [x] Access 15 min + refresh rotativo 30d, logout revoga, MFA TOTP.
- [x] Recuperação de senha (forgot/reset) implementada.
- [ ] HTTPS/HSTS e httpOnly/secure total do access em produção.
- [ ] SMTP de produção configurado e testado.

### Fase 2 — Robustez de dados
- [x] Validação no backend em fluxos críticos (auth, agendamentos, admin).
- [x] Validação de CPF e regras de data/futuro em pontos-chave.
- [x] Geração automática de lembretes (job).
- [x] Paginação em listagens administrativas (parcial).
- [ ] Padronizar validação em todas as rotas POST/PUT/PATCH (zod/express-validator).
- [ ] Substituir `prompt()/confirm()` nativos em alguns fluxos por modais consistentes.
- [ ] Diferenciar "paciente não encontrado" vs "inativo" na busca do atendente sem vazar dados sensíveis.
- [ ] Política de retenção/expurgo e trilha completa conforme LGPD (Fase 1 em andamento).

### Fase 3 — Qualidade e manutenção
- [x] Testes automatizados (`node:test`) + `test:race` + E2E Playwright.
- [x] ESLint + CI com lint/suite/E2E + `npm audit critical`.
- [x] Auditoria encadeada, hardening, rate limit/helmet/CORS, paginação, `admin_level` granular.
- [ ] Ampliar cobertura E2E contínua (agendamentos ponta a ponta, fluxos por papel).

### Fase 4 — Produto / conformidade
- [x] LGPD Fase 1.
- [x] Recuperação de senha, lembretes por e-mail, CI.
- [ ] DPO nominal designado.
- [ ] Revisão jurídica.
- [ ] KMS/Vault para segredos.
- [ ] RNDS/Gov.br credenciados.

## Observação sobre uso de plugins/skills

Este diagnóstico foi feito por leitura direta do código (sem alterar nada), conforme pedido. Skills disponíveis no ambiente que se aplicam a fases futuras deste projeto, caso o usuário queira aprofundar depois:
- `security-review` — auditoria de segurança formal antes de deploy (cobre os itens da Fase 1 com mais profundidade).
- `web-design-guidelines` — revisão de acessibilidade/UX do frontend HTML atual.
- `code-review` — revisão de diff quando as mudanças da Fase 2/3 forem implementadas.

Nenhuma dessas foi executada agora — só citadas como próximo passo natural, já que o pedido foi "só informação".
