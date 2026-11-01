# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Paciente + família de Lagoa de Itaenga (PE), incluindo pessoas com baixa familiaridade digital e internet rural instável. Tarefa crítica no piloto: criar conta em ~1 minuto e agendar consulta/exame para si ou família em poucos cliques, depois acompanhar em Meus agendamentos + Alertas da região.

Atendentes e admins operam o piloto no balcão e na gestão; a experiência pública (index + auth) continua sendo a porta de entrada do paciente.

## Product Purpose

Cuidado integrado municipal: agendamento com agenda inteligente (vagas livres de verdade por unidade/dia), fila de atendimento, alertas epidemiológicos por região e lembretes automáticos. Sucesso = morador resolve sem ir ao balcão, sem ligar, sem entender SUS por dentro.

## Positioning

Lagoa conectada ponta-a-ponta: agendar + fila do dia + alertas da região + lembretes na véspera num só lugar, filtrado por usuário e auditado. Vizinho copia uma tela, não o circuito inteiro ligado à rede local (10 unidades CNES seed, ofertas, horários, bloqueios).

## Operating Context

Uso diurno, mobile-first (360px+), sidebar vira barra rolável; balcão com atendente ajudando no cadastro quando preciso. Ambientes: casa com 3G instável, UBS, sala de aula (teste com dados fictícios via ROTEIRO_TESTE_ALUNOS.md). Rituales: wizard 2 passos (Você → Acesso), resto do perfil vai para Minha conta pós-login com barra de progresso.

## Capabilities and Constraints

Capacidades: wizard signup em 2 passos + login + MFA TOTP + recuperação de senha, catálogo/serviços/slots 30 dias, Meus agendamentos com editar/cancelar/reagendar, Alertas ativos, Minha conta LGPD (export/portabilidade, eliminação/anonimização), DPO público; admin com CRUD de usuários/profissionais/unidades/doenças, soft delete, revogação de sessões, relatórios CSV e auditoria verificável; atendente com agenda fail-closed e busca de pacientes; lembretes por e-mail.
Restrições duras (usuário vinculou): vanilla HTML/CSS/JS sem build + identidade lagoa (verde-lagoa, tom simples) preservadas; core funciona offline após instalado; sem dependência externa obrigatória (fonte Inter autohospedada em `assets/fonts/`); LGPD Fase 1 (AES-256-GCM CPF/RG/CNS, consentimento, audit hash encadeado); JWT curto 15min + refresh rotativo; validação real no servidor (booking.js: janela 366 dias, sem overlap 30min, blocks).

## Brand Commitments

Nome Saúde+, marca `brand-dot` radial verde-lagoa + anel `primary-100`, paleta lagoa (`--primary #0F7A6B`, `--primary-600 #0B5C50`, `--accent #E0622E` terracota com moderação), voz simples sem juridiquês (a página /privacy declara não revisada por advogado), assinatura ondulação hero ("a lagoa"). Não redesenhar do zero sem aprovação.

## Evidence on Hand

- `web/src/pages` (landing: hero, como-funciona 3 passos, recursos, trust; `/auth`: login + wizard 2 passos + MFA), `web/src/index.css` (tokens da paleta lagoa) + `web/src/components/ui` (shadcn), `web/src/lib/api.ts` (sessão Bearer)
- `GET /public/stats` e `GET /public/dpo` reais para prova social e encarregado (não usados na landing hoje — lacuna)
- `docs/planos/PLANO_UIUX.md`, `docs/planos/PLANO_MELHORIAS.md`, `docs/tecnico/PROJETO_COMPLETO.md`, `ROTEIRO_TESTE_ALUNOS.md`
- Ausências que não devem ser fabricadas: depoimentos reais de pacientes, números assistenciais verificados, telefones/horários das unidades (seed não confirmada — README avisa validar antes de divulgar)

## Product Principles

1. Baixa fricção primeiro: 1 minuto para conta, poucos cliques para vaga.
2. Verdade da agenda: só mostra vaga livre de verdade, com resumo antes de confirmar.
3. Linguagem simples e reversível: toda ação destrutiva explica consequência e tem desfazer/sair.
4. Local antes de genérico: unidade, bairro e alerta da região vêm antes de abstração SUS.
5. Confiança auditável: isolamento por user_id, trilha verificável, LGPD exercível.

## Accessibility & Inclusion

Público inclui baixa visão, baixa literacia digital e leitores de tela: foco visível 3px sempre, `prefers-reduced-motion`, base 16px/1.55, alvos 44px, contraste AA 4.5:1 obrigatório (detector aponta 3 falhas atuais em index/auth — corrigir na Fase 1). e-MAG/WCAG 2.2 AA como barra.
