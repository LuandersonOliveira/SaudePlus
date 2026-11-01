# Saúde+ — O que falta para integrar com e-SUS, RNDS, CNS e Gov.br

> Documento de referência rápida: para cada API/sistema externo citado no projeto,
> o que já funciona, o que está pronto no código mas bloqueado por credencial, e o
> que depende de resposta institucional da Secretaria. Não repete a arquitetura
> (ver [`INTEROPERABILIDADE.md`](./INTEROPERABILIDADE.md)) nem o processo de
> descoberta (ver [`DESCOBERTA_SAUDE_DIGITAL.md`](./DESCOBERTA_SAUDE_DIGITAL.md)) —
> só responde "o que preciso conseguir, de quem, para isso funcionar de verdade".
> Revisão: 2026-10-31 — seções 4, 5 e 7 verificadas ao vivo no portal oficial
> (`portalservicos-datasus.saude.gov.br`), não só por documentação de terceiros.

## 1. Resumo

| Integração | Status hoje | O que falta | Quem resolve |
|---|---|---|---|
| **CNES** (unidades de saúde) | ✅ Funcionando, sem credencial | Nada | — |
| **InfoDengue** (alertas) | ✅ Funcionando, sem credencial | Nada | — |
| **RAC** (RNDS — Registro de Atendimento Clínico) | 🟡 Código pronto, sem credencial | Credenciamento DATASUS (e-CNPJ + certificado) | Secretaria (institucional) + dev (configurar `.env`) |
| **API CADSUS** (o que chamamos de "CNS WebService") | 🟡 Código pronto, sem credencial | Credenciamento DATASUS (mesmo portal da RAC) | Secretaria + dev |
| **Login Gov.br** | 🟡 Scaffold, sem credencial | Client homologado em `sso.acesso.gov.br` | Secretaria — **adiado por decisão do usuário** |
| **e-SUS APS** | ⛔ Não é integração nossa | Confirmar se o `e-Gestor APS` do município já envia pra RNDS | Secretaria (administrador da instalação e-SUS) |

Nenhum desses bloqueios impede o Saúde+ de funcionar hoje — ver seção 2.

> ⚠️ **Achado da verificação ao vivo (2026-10-31):** o portal separa a "RNDS" em
> várias APIs específicas por tipo de registro — RAC, REL, RIA, RIRA, REDFM, SA —
> e trata "CNS" como **API CADSUS** (protocolo PDQ), não como um serviço avulso.
> O Saúde+ só precisa de duas dessas: **RAC** (`server/src/services/rnds.js` já
> constrói exatamente esse Bundle) e **API CADSUS**. Isso já estava certo em
> espírito nas seções 4.1–4.2 abaixo, mas os nomes oficiais mudaram.

## 2. O sistema já funciona sem nenhuma integração externa

O Saúde+ opera em **modo autônomo** (cenário D de `INTEROPERABILIDADE.md`): agenda,
fila, catálogo, auditoria, LGPD — tudo funciona com o banco próprio, sem depender
de nenhum sistema de terceiro. As integrações abaixo **somam** capacidade, não são
pré-requisito para o produto rodar nem para atender pacientes de verdade. Enquanto
não houver decisão institucional, esse é o comportamento esperado e correto — não
é um defeito a corrigir às pressas.

## 3. Já funciona hoje — sem pedir nada a ninguém

### 3.1 CNES — Cadastro Nacional de Estabelecimentos de Saúde
API pública, sem credencial: `apidadosabertos.saude.gov.br/cnes/estabelecimentos`.
Já usado em `server/scripts/sync-cnes.js` → atualiza `health_units`.

### 3.2 InfoDengue (Fiocruz)
API pública, sem credencial. Já usado em `server/scripts/sync-alerts.js` → atualiza
`diseases` com `source='infodengue'`.

Essas duas não têm "requisito" — já estão operacionais e podem ser rodadas (`npm run sync:cnes`, `npm run sync:alerts`) a qualquer momento.

## 4. Prontas no código — bloqueadas por credencial externa

### 4.1 RAC — Registro de Atendimento Clínico (a API da RNDS que usamos)

**O que já existe:** `server/src/services/rnds.js` monta e valida exatamente o
Bundle FHIR do RAC (Patient/Organization/Practitioner/Encounter), com transporte
mTLS. Testado offline (`npm run test:rnds`, 7/7). `POST /interop/rnds/send` envia
o Bundle de um agendamento real.

Base legal confirmada no portal oficial: RNDS instituída pela Portaria GM/MS
nº 1.434/2020 (base atual: Decreto nº 12.560/2025); o modelo de informação do RAC
foi padronizado pela Portaria GM/MS nº 8.347, de 8/10/2025 — é recente, e vale
para atendimento presencial e teleconsulta igualmente.

**O que falta (institucional):**
1. e-CNPJ da Secretaria com certificado ICP-Brasil.
2. Credenciamento em `portalservicos-datasus.saude.gov.br` → serviço **RAC**
   (login Gov.br + e-CNPJ + código CNES do município) — processo da Secretaria,
   não do time técnico.
3. Acesso ao ambiente de homologação (`ehr-services.hmg.saude.gov.br`) para testar
   antes de produção.

**O que falta (nosso, depois do credenciamento):**
- Preencher `RNDS_CERT_PFX_PATH` e `RNDS_CERT_PASS` no `.env`.
- Validar o Bundle gerado no **Validador Local de Profiles do DATASUS** (ferramenta
  oficial, roda fora do Saúde+) antes do primeiro envio real.
- **Novo RIPD** antes de qualquer dado real trafegar (exigido em `PLANO_RNDS_LGPD.md`
  e `INTEROPERABILIDADE.md` §7, gate G5).

> ⚠️ **Achado que precisa de decisão — CPF substituiu CNS como identificador
> prioritário.** Comunicado oficial no portal (verificado ao vivo, página do RAC):
> a SEIDIGI/DATASUS orienta os integradores da RNDS a **priorizar o CPF** na
> identificação de pacientes e profissionais "ao invés do CNS", porque isso reduz
> rejeição por inconsistência cadastral do CNS/CNES. Hoje `buildPatient()` em
> `rnds.js:49` faz o oposto — **exige CNS e lança erro se ausente**
> (`if (!user.cns) throw new Error('RNDS exige CNS do paciente.')`), só inclui CPF
> como identificador secundário se presente. Isso provavelmente precisa inverter
> (CPF obrigatório, CNS opcional/complementar) antes do primeiro envio real — mas
> é uma mudança de contrato de dados, então fica registrada aqui para decisão, não
> alterada sem confirmar.

### 4.2 API CADSUS (o que o projeto chama de "CNS WebService")

**O que já existe:** `server/src/services/cns.js` — normaliza resposta, deduplica
paciente por CNS/CPF+nascimento (nunca resolve conflito sozinho), checksum local
já validado (`isValidCNS`). Testado offline (`npm run test:cns`, 10/10).

**Confirmado ao vivo no portal:** o serviço se chama **API CADSUS**, protocolo
**PDQ (Patient Demographics Query, padrão HL7)** — não é um nome genérico nosso,
é o nome oficial. Modelo de oferta: **Web Service gratuito** (não cobra nada),
só exige autorização específica por interessado.

**O que falta (institucional):** mesmo portal de credenciamento do RAC
(`portalservicos-datasus.saude.gov.br` → serviço **API CADSUS**). O contrato
técnico exato (endpoint, formato) só é conhecido **depois** do credenciamento —
por isso `CNS_WS_BASE_URL` e `CNS_WS_LOOKUP_PATH` ficam vazios no
`.env.example`. O DATASUS disponibiliza, na própria página do serviço: "Manual de
Integração CNS v2.1", "Manual de apoio para solicitação de credenciais", uma
coleção Postman "CNS - PDQ" e um projeto Java de exemplo — todos baixáveis
diretamente na página do serviço depois de abrir `Ver documentação → API CADSUS`.

**O que falta (nosso, depois do credenciamento):** preencher as 4 variáveis
`CNS_WS_*` no `.env` com o que o pacote técnico do credenciamento entregar.

### 4.3 Login Gov.br

**O que já existe:** `server/src/services/govbr.js` — fluxo OIDC completo
(authorize/token/userinfo), nunca cria conta sozinho.

**O que falta:** client homologado em `sso.acesso.gov.br` (conta prata/ouro para
dado de saúde). **Decisão já tomada: fica para depois** — não é prioridade atual.

## 5. e-SUS — por que não é "só configurar uma API"

Essa é a pergunta mais comum e a resposta mais importante deste documento:
**não existe uma API pública do e-SUS APS para sistema terceiro se conectar
diretamente.** Não é falta de credencial — é que essa porta não existe.

Os únicos dois caminhos reais são:

1. **Via RNDS** — se o município usa e-SUS **PEC** (prontuário eletrônico) e ele já
   alimenta a RNDS, o Saúde+ troca dado com a RNDS (seção 4.1), não com o e-SUS
   diretamente. É por isso que credenciar a RNDS é o item de maior valor prático,
   mesmo sem saber ainda se o município usa e-SUS.
2. **Via e-Gestor AB / SISAB** — portal de dados consolidados
   (`apidadosabertos.saude.gov.br`), mas é relatório agregado/em lote, não agenda em
   tempo real. Não substitui a RNDS para agendamento.

Se o município usa só e-SUS **CDS** (coleta simplificada, sem prontuário
eletrônico), **nenhum dos dois caminhos acima resolve** — a única opção seria
exportação/importação manual, e o Saúde+ continua sendo o sistema de agenda
principal (cenário D).

### 5.1 Como o caminho 1 realmente funciona (confirmado ao vivo, página "e-SUS APS" do portal)

A partir da versão 4.2 do Prontuário Eletrônico e-SUS APS, o **envio automatizado
para a RNDS já existe como funcionalidade do próprio e-SUS** — mas só
**"nas instalações onde a integração foi habilitada"**. Habilitar é uma ação que
cabe exclusivamente a quem administra a instalação do e-SUS do município:

1. Gerar um certificado digital no sistema **e-Gestor APS**
   (`acesso-egestoraps.saude.gov.br/login`).
2. Habilitar esse certificado na instalação, usando o perfil
   **"Administrador da Instalação"**.
3. A partir daí, o próprio e-SUS APS passa a empurrar os registros clínicos pra
   RNDS sozinho — sem nenhuma ação do Saúde+.

**Isso significa que o Saúde+ nunca fala com o e-SUS, nem precisa.** Os dois
sistemas são independentes e só se encontram na RNDS: se o e-SUS do município
estiver habilitado, os dados do paciente que vieram de lá aparecem na RNDS; o
Saúde+ manda os seus próprios (via RAC, seção 4.1) pra lá também. Quem consome os
dois juntos é a camada de consulta (SUS Digital Profissional / Meu SUS Digital),
não o Saúde+ diretamente.

**A pergunta de descoberta fica mais específica agora:** não é só "CDS ou PEC?" —
é **"a integração com a RNDS está habilitada no e-Gestor APS da nossa instalação
e-SUS?"**. Essa é uma pergunta objetiva de sim/não que dá pra incluir no e-mail à
Secretaria (`DESCOBERTA_SAUDE_DIGITAL.md` §8.2).

**O bloqueio real é saber qual modalidade o município usa e se essa integração já
foi habilitada — isso ainda não tem resposta.** O pedido de acesso à informação
(LAI) e o e-mail à Secretaria descritos em
[`DESCOBERTA_SAUDE_DIGITAL.md`](./DESCOBERTA_SAUDE_DIGITAL.md) §8 ainda não têm
protocolo registrado. Enquanto isso não for respondido, qualquer código de
integração com "o sistema do município" seria putativo — por isso
`INTEROPERABILIDADE.md` trava esse código até os gates G1–G7 fecharem.

## 6. Ordem de ação recomendada

1. **Enviar o LAI/ofício/e-mail** à Secretaria (minutas prontas em
   `DESCOBERTA_SAUDE_DIGITAL.md` §8.1/8.2) — não depende de nada técnico, só de
   alguém da equipe assinar e protocolar.
2. **Em paralelo, iniciar o credenciamento RNDS + CNS WebService** em
   `servicos-datasus.saude.gov.br` — é rota nacional, não depende da resposta do
   item 1 (o município não precisa ser identificado para a Secretaria se
   credenciar como instituição no barramento nacional).
3. **Preparar o novo RIPD** (gate G5) em paralelo, para não ser o item que atrasa
   tudo quando o credenciamento chegar.
4. **Login Gov.br**: não entra nesta rodada — retomar quando as prioridades acima
   fecharem.
5. **Só depois** de 1–3: decidir formalmente o cenário (A/B/C/D em
   `DESCOBERTA_SAUDE_DIGITAL.md` §7) e, se A, ativar o primeiro envio real pela
   RNDS em shadow mode (`INTEROPERABILIDADE.md` §8).

## 7. Onde pedir cada coisa

| O quê | Onde | Precisa de |
|---|---|---|
| Credenciamento RAC + API CADSUS | `portalservicos-datasus.saude.gov.br/home` (o "Portal de Serviços 2.6"; o botão de solicitar credencial ainda redireciona pra versão anterior do portal, em transição) | Login Gov.br da Secretaria + certificado ICP-Brasil (e-CNPJ) + código CNES do município (`260850`) |
| Ambiente de homologação RNDS | `ehr-services.hmg.saude.gov.br` | Credenciamento Fase 1 aprovado |
| Guia de implementação FHIR (IG) + passo a passo oficial | `rnds-guia.saude.gov.br/docs/passo-a-passo/` | Público, sem login |
| FAQ/suporte RNDS | `webatendimento.saude.gov.br/faq/rnds` | Público |
| FAQ/suporte CADSUS | `webatendimento.saude.gov.br/faq/cadsus` | Público |
| e-Gestor APS (habilita e-SUS → RNDS) | `acesso-egestoraps.saude.gov.br/login` | Login do administrador da instalação e-SUS do município |
| Client Gov.br (login único) | `sso.acesso.gov.br` | Processo de habilitação de serviço público digital |
| Dados abertos CNES/SUS (já em uso) | `apidadosabertos.saude.gov.br` | Nada — público |

### 7.1 Processo de credenciamento RAC/API CADSUS — verificado AO VIVO no portal (2026-10-31)

Não é dedução de manual de terceiro: isso foi navegado de verdade no
`portalservicos-datasus.saude.gov.br/home` nesta sessão (com Claude for Chrome),
abrindo a página de cada serviço e lendo "Requisitos e orientações para o
acesso". O catálogo completo visto no portal, por secretaria:

- **SEIDIGI** (Informação e Saúde Digital): API CADSUS, CNS Operadoras ANS, REL,
  RIA, **RAC**, RIRA, REDFM, SA, SUS Digital, SOA-SIGTAP, OBM.
- **SAES** (Atenção Especializada): API SISCAN, API SISREG, API e-SUS Regulação, SOA-CNES.
- **SVSA** (Vigilância): e-SUS Notifica, e-SUS Sinan, Vacinação.
- **SCTIE**: SI-BNAFAR.
- **SAPS** (Atenção Primária): **e-SUS APS**.

Só RAC e API CADSUS interessam ao Saúde+ hoje.

**Antes de começar, ter em mãos:**
- Certificado digital **ICP-Brasil** da Secretaria (e-CNPJ, `.pfx` ou `.cer`).
- Conta **Gov.br** ativa de quem vai solicitar.
- Código **CNES** do município (`260850`, já confirmado no projeto).

**Processo idêntico para RAC e para API CADSUS (texto quase igual nas duas
páginas do portal — "REQUISITOS E ORIENTAÇÕES PARA O ACESSO"):**

**1. Ambiente de Homologação**
- A liberação do acesso à homologação ocorre depois da análise e aprovação da
  solicitação de acesso (ao RAC, ou ao CNS, conforme o serviço).
- A autenticação no ambiente de homologação usa o **mesmo certificado digital**
  informado na solicitação.

**2. Ambiente de Produção** — passos literais do portal:
1. Acessar, na aba **"Gerenciar Credenciais"**, a opção **"Homologação"**.
2. Selecionar o botão **"Solicitar acesso ao ambiente de produção"**.
3. Fazer upload de um arquivo (`.png` ou `.pdf`) que evidencie os testes feitos
   em homologação.
4. A liberação de produção ocorre após análise e aprovação dessa solicitação.
5. A autenticação em produção usa o mesmo certificado digital da solicitação.

**API CADSUS especificamente:** modelo de oferta é **Web Service gratuito com
autorização específica** — não tem custo, só autorização por interessado.

**Para abrir a solicitação:** na página do serviço (RAC ou API CADSUS), clicar em
**"Solicitar credencial de acesso"** (canto superior direito). No momento desta
verificação, esse botão redireciona para a versão anterior do portal — um aviso
no próprio site confirma que o "Portal de Serviços está evoluindo" e o serviço
"ainda está disponível temporariamente na versão anterior".

## 8. Referências

- [`INTEROPERABILIDADE.md`](./INTEROPERABILIDADE.md) — arquitetura, contrato de adaptador, gates G1–G7.
- [`DESCOBERTA_SAUDE_DIGITAL.md`](./DESCOBERTA_SAUDE_DIGITAL.md) — perguntas, evidências e minutas de LAI/e-mail.
- [`../planos/PLANO_RNDS_LGPD.md`](../planos/PLANO_RNDS_LGPD.md) — fases 0–2 e checklist de código por integração.
- `server/.env.example` — todas as variáveis de ambiente citadas aqui.
