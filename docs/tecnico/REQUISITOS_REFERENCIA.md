# Saúde+ — Requisitos de referência (PDF × sistema atual)

> Levantamento comparativo entre o TCC `docs/referencia/app_saude_referencia.pdf`
> ("Protótipo de sistema de agendamento para consultório médico", FATEC Lins,
> 2023) e o Saúde+. Serve para decidir, requisito por requisito, o que **já
> existe**, o que **precisa de ajuste**, o que deve ser **implementado** e o que
> **não deve ser copiado**.
>
> Escopo: todo o sistema Saúde+, não apenas o que o PDF trata.
> Data: 2026-10-28. Documentos irmãos:
> [`DESCOBERTA_SAUDE_DIGITAL.md`](./DESCOBERTA_SAUDE_DIGITAL.md) e
> [`INTEROPERABILIDADE.md`](./INTEROPERABILIDADE.md).

## 1. Método

- Texto do PDF extraído dos Form XObjects (42 páginas, sem OCR).
- Cada requisito do PDF foi confrontado com o código atual (`server/src`,
  `schema.sql`, páginas HTML) e com os testes existentes.
- Vereditos: **Existe**, **Ajustar**, **Implementar**, **Não copiar**.
- Onde o Saúde+ já faz melhor que o PDF, o requisito é marcado **Existe
  (superior)** e o PDF não é seguido.

### 1.1 Limitações

- O PDF não possui requisitos numerados; os IDs `RF01`–`RF17` foram atribuídos
  aqui a partir dos fluxos básicos dos casos de uso 3.1.1–3.1.7.
- O PDF descreve o sistema de **Lins/SP** e a integração com um fornecedor que
  não foi confirmado em Lagoa de Itaenga (ver `DESCOBERTA_SAUDE_DIGITAL.md`).
- O TCC não relata teste de aceitação com usuários reais; os requisitos são
  declarados, não validados em campo.

## 2. O que o PDF propõe

| Dimensão | PDF |
|---|---|
| Atores | Paciente e administrador/secretaria |
| Casos de uso | Login, Marcar Consulta, Consultas Agendadas, Gerenciar Pacientes, Gerenciar Médicos, Gerenciar Agenda, Gerenciar Consulta |
| Fluxo de marcação | Especialidade → médico → UBS → data → **horário/turno** |
| Agenda | Administrador cadastra médico, UBS, data e turno |
| Cancelamento | Paciente desmarca; administrador desmarca e filtra |
| Stack | PHP, JavaScript, jQuery, Bootstrap, WampServer (Apache/MySQL/PHP) |
| Interface | Website responsivo (celular, tablet, desktop) |
| Integração | Sistema da atenção básica, para evitar conflito de horários |
| Continuidade | Atendimento presencial e telefônico mantidos |
| Qualidade | Sem testes automatizados, sem MFA, sem trilha de auditoria descrita |

## 3. Inventário do Saúde+ (estado verificado)

| Camada | Conteúdo |
|---|---|
| Páginas | `index.html`, `auth.html`, `dashboard.html`, `atendente.html`, `admin.html`, `privacy.html` |
| Assets | `assets/api.js`, `ui.js`, `styles.css` |
| API | `/auth`, `/me/appointments`, `/me/exams`, `/me/reminders`, `/diseases`, `/health-units`, `/staff`, `/catalog`, `/admin/users`, `/admin/professionals`, `/admin`, `/public`, `/interop` |
| Papéis | `paciente`, `atendente`, `admin` |
| Níveis admin | `superadmin`, `gestor`, `atendimento`, `alertas` (capabilities em `server/src/middleware/auth.js`) |
| Tabelas | `users`, `refresh_tokens`, `password_reset_tokens`, `appointments`, `reminders`, `diseases`, `exams`, `health_units`, `audit_log`, `professionals`, `unit_offers`, `professional_offers`, `work_schedules`, `schedule_blocks` |
| Segurança | JWT curto + refresh rotativo, MFA TOTP, throttle de login, reset de senha, auditoria encadeada, cifra de CPF/CNS |
| LGPD | `GET /me/export`, `DELETE /me`, consentimento versionado, anonimização |
| Testes | ~40 arquivos unitários em `server/test` + Playwright em `e2e` |
| Interop | CNES sync, InfoDengue, Gov.br (scaffold), RNDS (camada pronta, sem credenciamento) |

## 4. Matriz de requisitos funcionais

| ID | Requisito (PDF) | Origem | Saúde+ hoje | Veredito | Ação |
|---|---|---|---|---|---|
| RF01 | Login e cadastro do paciente | 3.1.1 | `server/src/routes/auth.routes.js`, `auth.html`; JWT, MFA, reset, Gov.br scaffold | **Existe (superior)** | Manter; revisar textos e acessibilidade |
| RF02 | Selecionar especialidade | 3.1.2 Fb1 | `GET /catalog/offers` + `unit_offers` | **Existe** | — |
| RF03 | Selecionar médico | 3.1.2 Fb2 | `GET /catalog/professionals` + `professional_offers` | **Existe** | — |
| RF04 | Selecionar UBS | 3.1.2 Fb3 | `health_units` (10 unidades, CNES) e `GET /health-units` | **Existe** | Validar dados de contato e horário |
| RF05 | Selecionar data disponível | 3.1.2 Fb4 | `GET /catalog/availability` (`catalog.routes.js:70`); janela de 1 ano em `booking.js` e página de até 30 dias com `offset_days` | **Ajustado (F0-05)** | Paginação por período implementada; UI ainda pede a 1ª página |
| RF06 | Selecionar horário/turno | 3.1.2 Fb5 | `GET /catalog/slots` (`catalog.routes.js:109`) com slots reais de 30 min e duração | **Existe (superior)** | Não copiar o modelo de turno |
| RF07 | Listar consultas agendadas | 3.1.3 Fb1 | `GET /me/appointments` (`me.booking.routes.js:42`) + `dashboard.html` | **Existe** | — |
| RF08 | Desmarcar consulta (paciente) | 3.1.3 Fb2 | `PATCH /me/appointments/:id/cancel` (`me.booking.routes.js:139`) | **Existe** | — |
| RF09 | Administrador consulta paciente | 3.1.4 Fb1 | `GET /admin/users` (`admin.users.routes.js:61`) | **Existe** | — |
| RF10 | Administrador edita paciente | 3.1.4 Fb2 | `PATCH /admin/users/:id` (`admin.users.routes.js:127`) aceita status, cargo, nível, papel, senha e identidade (nome, e-mail, telefones) | **Ajustado (F0-04)** | E-mail único, normalizado e com revogação de sessão |
| RF11 | Administrador exclui paciente | 3.1.4 Fb3 | `DELETE /admin/users/:id` → soft delete (`admin.users.routes.js:315-330`) | **Existe (superior)** | Manter; não copiar exclusão física |
| RF12 | Administrador lista informações do paciente | 3.1.4 Fb4 | `GET /admin/users/:id` e listagem paginada | **Existe** | — |
| RF13 | Gerenciar médicos (consultar, editar, excluir, listar) | 3.1.5 | `admin.professionals.routes.js` (CRUD + `registry` + vínculo com usuário) | **Ajustar** | Validar registro profissional e especialidade (CBO/CNES) |
| RF14 | Gerenciar agenda (médico, UBS, data, turno) | 3.1.6 | `work_schedules` + `schedule_blocks` + `unit_offers`/`professional_offers` (`admin.professionals.routes.js:207-293`) | **Existe (superior)** | Não copiar turno fechado |
| RF15 | Administrador lista consultas marcadas | 3.1.7 Fb1 | `GET /admin/appointments` (`admin.routes.js:104`), paginado | **Existe** | — |
| RF16 | Administrador desmarca consultas | 3.1.7 Fb2 | `PATCH /admin/:kind/:id` (`admin.routes.js:247`) | **Ajustado (F0-01)** | Front passou a usar `apiPatch` |
| RF17 | Filtrar consultas | 3.1.7 Fb3 | Filtro apenas no cliente; `GET /admin/appointments` não aceita filtros | **Implementar** | Adicionar `status`, `unit_id`, `date_from`, `date_to` no servidor |

### 4.1 Achados do front que quebram RF10 e RF16

| # | Defeito | Local | Efeito | Correção | Status |
|---|---|---|---|---|---|
| F0-01 | `apiPut` em rotas que só aceitam `PATCH` | `admin.html:2018`, `admin.html:2171` | 404 ao salvar | Trocar por `apiPatch` (`assets/api.js:122`) | ✅ corrigido — `admin-user-form.test.js` |
| F0-02 | Envio de `admin_level` por quem não pode | `admin.html:2162` | 403 para gestor/atendimento | Enviar só se `superadmin` | ✅ corrigido — `admin-user-form.test.js` |
| F0-03 | Chamada a `/admin/units` inexistente | `admin.html:2033` | Lista vazia silenciosa | Usar `/health-units/manage` (`units.routes.js:25`) | ✅ corrigido — `admin-user-form.test.js` |
| F0-04 | `PATCH /admin/users/:id` não aceita identidade | `admin.users.routes.js:129` | Não corrige nome/e-mail/telefone | Aceitar `full_name`, `email`, `mobile`, `phone` com validação | ✅ corrigido — `admin-user-update.test.js` |
| F0-05 | Janela de agenda inconsistente | `booking.js:13` (366) × `catalog.routes.js:63` (60) | Datas oferecidas e depois rejeitadas | Fonte única de verdade + 30 dias por página | ✅ corrigido — `catalog-window.test.js` |
| F0-06 | Campo `admin_level` visível para quem não gerencia | `admin.html:1886`, `admin.html:1980` | Exposição de estrutura de privilégio | Renderizar só para `superadmin` | ✅ corrigido — `admin-user-form.test.js` |
| F0-07 | Aviso de revisão jurídica pendente | `privacy.html:2` | Risco de publicação | Remover após revisão jurídica | ⛔ bloqueado — depende de revisão jurídica |

## 5. Requisitos não funcionais

| ID | Requisito | Origem | Situação | Ação |
|---|---|---|---|---|
| RNF01 | Interface responsiva (celular, tablet, desktop) | PDF 5.x | **Existe** — CSS próprio + `e2e/admin-responsive.spec.js` | Manter |
| RNF02 | Não gerar conflito de horário com o sistema da atenção básica | PDF 2.1 | **Parcial** — conflito local validado em `booking.js`; integração externa condicionada | Ver `INTEROPERABILIDADE.md` |
| RNF03 | Manter atendimento presencial e telefônico | PDF 2.1 | **Existe** — perfis `atendente` e `admin` operam a mesma agenda | Manter |
| RNF04 | Proteção de dado pessoal sensível (LGPD) | Norma | **Parcial** — cifra, exportação, eliminação, consentimento; falta revisão jurídica e DPA | Fechar gates G1/G2 |
| RNF05 | Trilha de auditoria inviolável | Nosso | **Existe** — `audit_log` com hash chain e `GET /admin/audit-log/verify` | Manter |
| RNF06 | Autenticação forte e resistente a abuso | Nosso | **Existe** — MFA TOTP, throttle, refresh rotativo, reset de uso único | Manter |
| RNF07 | Acessibilidade (WCAG 2.1 AA) | Norma | **Implementar** — sem auditoria registrada | NV08 |
| RNF08 | Desempenho e paginação | Nosso | **Parcial** — paginação nova em rotas admin; agenda sem paginação por período | F0-05 |
| RNF09 | Disponibilidade e observabilidade | Nosso | **Parcial** — `/health`, readiness, doctor; sem métricas de negócio | Após interop |
| RNF10 | Cobertura de testes | Nosso | **Existe** — unitários + e2e; lacunas para os itens F0 | Criar testes junto com F0 |

## 6. O que não copiar do PDF

| Item do PDF | Por quê | O que fazer |
|---|---|---|
| Stack PHP + jQuery + WampServer | Stack diferente, sem testes, sem tipagem, difícil de evoluir | Manter Node/Express + front nativo |
| Turno fechado (manhã/tarde) no lugar de horário | Impede gestão real de vagas e gera conflito | Manter slots de 30 min com duração |
| Exclusão física de paciente | Viola minimização e retenção legal | Manter soft delete + anonimização |
| Papel de usuário alterado direto no banco | Sem auditoria e sem controle de privilégio | Manter `PATCH` com capabilities e auditoria |
| Integração com sistema de outra cidade | Fornecedor não confirmado em Lagoa de Itaenga | Discovery antes de qualquer código |
| Login de administrador em URL separada | Segurança por obscuridade | Manter login único com autorização por capability |
| Ausência de testes e de MFA | Risco operacional e de segurança | Manter suíte e MFA |
| Farmácia, estoque e prontuário no agendador | Cria prontuário paralelo e escopo inviável | Fora de escopo (`INTEROPERABILIDADE.md` §10) |

## 7. Backlog de novas funcionalidades

| ID | Item | Valor | Depende de | Esforço | Status |
|---|---|---|---|---|---|
| NV01 | Reagendar consulta/exame (paciente e atendente) | Alto — hoje só cancela e recria | RF07/RF08 | M | ✅ atendente/admin já tinham; paciente ganhou transação, lock e recálculo de duração — `patient-reschedule.test.js` |
| NV02 | Prioridade legal aplicada à oferta de vagas | Alto — já existe `users.priority`, não usada na fila | Definição da regra | M | ✅ cota de 10% por dia/profissional (mín. 1), liberada 24 h antes — `priority-quota.test.js`, `priority-booking.test.js` |
| NV03 | Lista de espera com liberação automática de vaga | Alto — reduz buraco na agenda | NV01 + cancelamento | G | ✅ fila por serviço, prioridade legal primeiro, conversão no cancelamento e aviso por e-mail — `waitlist.test.js` |
| NV04 | Comprovante de agendamento com código de verificação | Médio — reduz ligação para confirmar | Nenhum | P | ⏳ pronto para iniciar |
| NV05 | Painel "fila do dia" para atendente (check-in/chamada) | Alto — resolve rotina da recepção | RF15/RF17 | M | ⏳ pendente |
| NV06 | Confirmação ativa de presença (lembrete com resposta) | Alto — reduz absenteísmo | Canal definido | G | ⏳ canal não definido |
| NV07 | Relatórios de ocupação e absenteísmo por unidade/profissional | Médio — gestão de oferta | RF17 | M | ⏳ pendente |
| NV08 | Acessibilidade WCAG 2.1 AA e alto contraste | Alto — obrigação legal e inclusão | Nenhum | M | ⏳ pendente |

**NV01 — o que faltava.** Atendente (`/staff/:kind/:id`) e admin (`/admin/:kind/:id`) já reagendavam com validação. O paciente tinha `PUT /me/...`, mas a rota (a) validava fora de transação, sem lock no profissional — corrida com um novo agendamento; (b) mantinha `duration_minutes` do horário antigo ao mudar de grade; (c) devolvia 409 para violação da janela de 1 ano. Corrigido em `me.booking.routes.js`; a UI do paciente usa o botão "Editar" e o backend agora trata como reagendamento seguro.

**NV02 — regra aplicada.** Decisão do usuário: cota reservada com liberação. Para cada par (profissional, unidade, dia), as primeiras `ceil(10% das vagas)` (mínimo 1) ficam reservadas a `idoso`, `gestante`, `pcd` e `lactante` até 24 h antes do atendimento; depois disso, voltam para todos. Não-priority não vê essas vagas em `/catalog/availability` nem em `/catalog/slots` e recebe 409 se tentar agendar direto nelas. O reagendamento de atendente/admin usa a prioridade do **paciente do registro**, não a de quem opera. A cota é calculada sobre a grade de `work_schedules` do dia (horários únicos, agendas sobrepostas não contam duas vezes). Editar o próprio registro sem trocar o horário continua permitido, mesmo que a vaga tenha passado a ser reservada. Limitação conhecida: `priority` é autodeclarado no cadastro; a conferência documental continua na recepção, como já ocorre na fila presencial.

**NV03 — fila e conversão automática.** O paciente entra na lista por serviço (`POST /me/waitlist`), vê e sai pela tela de agendamento. Quando um registro é cancelado — pelo paciente ou por atendente/admin — o servidor procura na mesma transação a primeira entrada `aguardando` compatível com tipo, serviço, unidade e profissional (`NULL` funciona como coringa), sem recolocar a própria pessoa que cancelou. A ordem é prioridade legal (`idoso`, `gestante`, `pcd`, `lactante`) e depois chegada. A vaga só é convertida se passar nas mesmas validações de um agendamento novo (janela de 1 ano, grade, oferta, cota do NV02 e duração real); se não passar, tenta a próxima pessoa. A conversão grava o agendamento e marca a entrada como `convertido` com `record_id`; o aviso por e-mail é best-effort e nunca derruba o cancelamento. Limitação conhecida: a fila é por serviço/unidade/profissional, não por horário específico, e não há expiração automática de entradas antigas.

## 8. Rastreabilidade requisito → teste

| Requisito | Teste existente | Teste a criar |
|---|---|---|
| RF01 | `server/test/api.test.js`, `mfa-setup.test.js`, `password-reset.test.js`, `login-throttle.test.js` | — |
| RF02–RF04 | `catalog-multiprof.test.js`, `catalog-slots.test.js` | — |
| RF05 | `catalog-slots.test.js` | `catalog-window.test.js` (30 dias/página) |
| RF06 | `catalog-slots.test.js`, `booking-duration.test.js` | — |
| RF07–RF08 | `api.test.js`, `dashboard-multiprof.test.js` | `patient-reschedule.test.js`, `e2e/dashboard.spec.js` (cancelar) |
| RF09–RF12 | `admin-user-safety.test.js`, `capabilities.test.js`, `lgpd-anonymization.test.js` | `admin-user-update.test.js` |
| RF13–RF14 | `catalog-multiprof.test.js`, `booking-duration.test.js` | — |
| RF15–RF17 | `admin-silent-failures.test.js` | `admin-appointments-filter.test.js` |
| RNF04 | `lgpd-delete-http.test.js`, `cpf-match.test.js`, `crypto-config.test.js` | — |
| RNF05 | `audit-chain-gaps.test.js`, `audit-lock-sinal.test.js`, `audit-orphan.test.js` | — |
| F0-01 | `admin-user-form.test.js` | — |
| F0-02 | `admin-user-form.test.js` | `admin-user-update.test.js` |
| F0-03 | `admin-user-form.test.js` | — |
| F0-04 | `profile-update.test.js` | `admin-user-update.test.js` |
| F0-05 | — | `catalog-window.test.js` |
| F0-06 | `admin-user-form.test.js` | `admin-user-update.test.js` (gestor não muda nível) |
| NV02 | — | `priority-quota.test.js`, `priority-booking.test.js` |
| NV03 | — | `waitlist.test.js` |

## 9. Questões abertas

1. ~~A janela de 30 dias por página substitui o limite de 366 dias ou apenas
   limita a paginação?~~ Resolvido na F0-05: o limite de 1 ano permanece como
   regra de agendamento; 30 dias é apenas o tamanho da página, paginável por
   `offset_days` até o dia 336.
2. ~~A prioridade legal deve ordenar a fila, reservar vagas ou apenas
   sinalizar?~~ Resolvido no NV02: cota reservada de 10% por dia/profissional
   (mínimo 1), liberada para todos nas 24 h anteriores. Ordenar a fila do dia
   continua em aberto no NV05.
3. Reagendamento cria novo registro ou atualiza o existente com histórico?
4. O comprovante precisa de verificação pública por código?
5. Qual canal para confirmação ativa (e-mail, SMS, WhatsApp)?
6. Quem aprova os textos de `privacy.html` e o RIPD?
