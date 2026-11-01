# Saúde+ — Descoberta do ecossistema de saúde digital de Lagoa de Itaenga/PE

> Documento de processo, não de arquitetura. Objetivo: descobrir **com quais
> sistemas o Saúde+ pode se integrar** e **sob quais condições legais e
> técnicas**, antes de escrever qualquer código de integração.
>
> Status: **aberto** — nenhuma resposta institucional obtida até 2026-10-28.
> Documento irmão: [`INTEROPERABILIDADE.md`](./INTEROPERABILIDADE.md).
> Plano de referência: [`PLANO_RNDS_LGPD.md`](../planos/PLANO_RNDS_LGPD.md).

## 0. Por que este documento existe

O levantamento inicial partiu do TCC `docs/referencia/app_saude_referencia.pdf`, produzido
na FATEC de **Lins/SP**, que descreve a integração com o **Apollo**, sistema da
JC Sistemas usado pela Secretaria de Saúde de Lins. A pesquisa pública mostrou
que:

- a JC Sistemas é sediada em Lins/SP e suas instâncias públicas do Apollo
  (`lins`, `platina`, `guaranta`, `garca`, `ocaucu`) são todas de municípios
  paulistas;
- **não há indício público** de que Lagoa de Itaenga/PE use o Apollo;
- o município aparece em relato acadêmico usando o **sistema e-SUS** na
  atenção primária.

Conclusão: **o Apollo foi removido do escopo**. Não há justificativa para
construir integração com um fornecedor que provavelmente não atende o
município. O alvo de integração passa a ser "sistema municipal a identificar",
com e-SUS/RNDS como hipótese principal — a ser **confirmada**, não assumida.

## 1. Objetivo e limites

### Objetivo

Produzir evidência suficiente para decidir, com base em fatos e não em
suposições:

1. Qual sistema o município usa hoje na APS, na regulação e nas especialidades.
2. Se existe API, contrato e responsável técnico com quem integrar.
3. Se o Saúde+ deve ser sistema principal, sistema complementar ou camada de
   agendamento sobre outro sistema.
4. Quais obrigações de LGPD e de contrato precisam estar fechadas antes do
   primeiro dado real trafegar.

### Limites

- Não acessar área logada de terceiros, não procurar credenciais, não fazer
  scraping de sistema autenticado.
- Não prometer integração a ninguém antes dos gates da seção 7 de
  `INTEROPERABILIDADE.md`.
- Não tratar ausência de evidência pública como prova de inexistência. A
  resposta oficial é a única que encerra a pergunta.

## 2. Perguntas a responder

| # | Bloco | Pergunta | Por que importa |
|---|---|---|---|
| P01 | Institucional | Quais sistemas informatizados a Secretaria usa hoje (APS, regulação, especialidades, laboratório, farmácia)? | Define o alvo real de integração |
| P02 | Institucional | Existe contrato vigente de software de saúde? Qual o objeto, o fornecedor, a vigência e o valor? | Define quem é o operador e se há API contratada |
| P03 | Institucional | Existe termo de referência ou edital que exija interoperabilidade? | Pode ser a base legal para exigir a API |
| P04 | Técnico | O sistema possui API documentada? Em que padrão (REST, SOAP, FHIR)? | Define viabilidade e esforço |
| P05 | Técnico | Existe ambiente de homologação/sandbox? Há credenciais de teste? | Sem sandbox não há desenvolvimento seguro |
| P06 | Técnico | Quem é o interlocutor técnico do fornecedor e da Secretaria? | Sem interlocutor, integração não anda |
| P07 | e-SUS | A APS usa e-SUS APS em **CDS** ou em **PEC**? Quantas UBS têm PEC implantado? | Distingue integração automática de exportação assistida |
| P08 | e-SUS | Quem alimenta o e-SUS hoje e com que frequência? | Define qualidade e latência dos dados |
| P09 | Regulação | Como é feita a fila de consultas especializadas e exames? Sistema próprio, SISREG/estadual ou planilha? | A fila é o coração do produto; pode já estar resolvida por outro sistema |
| P10 | Regulação | Como são registrados os credenciamentos e mutirões de especialidades? | Explica o modelo atual de oferta |
| P11 | Operacional | Qual a conectividade das UBS (link, queda, redundância)? | Define se o Saúde+ pode depender de nuvem |
| P12 | Operacional | Quantos computadores/tablets há por UBS e quem opera? | Define usabilidade e treinamento |
| P13 | Operacional | Qual o horário real de atendimento e de marcação? | Define janela de agendamento e lembretes |
| P14 | Dados | A identificação do paciente é por CNS, CPF ou ambos? Há duplicidade conhecida? | Define chave de identidade e deduplicação |
| P15 | Dados | A base de profissionais e especialidades está atualizada? Existe CBO/CNES por profissional? | Define catálogo e alocação de agenda |
| P16 | Dados | Os 10 estabelecimentos do CNES usados no seed estão corretos e ativos? | Evita agenda em unidade inexistente |
| P17 | LGPD | Quem é o controlador, quem é o operador e quem é o DPO/Encarregado? | Define papéis e canal do titular |
| P18 | LGPD | Existe DPA/contrato de tratamento com fornecedores? Há RIPD? | Sem isso, dado sensível não pode circular |
| P19 | LGPD | Qual a política de retenção e de resposta a incidentes? | Define expurgo e playbook |
| P20 | Identidade | Há uso de Gov.br pelos cidadãos? Há cadastro municipal unificado? | Define login e vínculo de identidade |

## 3. Instrumentos e fontes

| Instrumento | Serve para | Prazo típico | Observação |
|---|---|---|---|
| Pedido de acesso à informação (LAI) | P01–P03, P17–P19 | até 20 dias, prorrogável por 10 | Instrumento formal; garante resposta registrada |
| E-mail institucional à SMS (APS/Regulação) | P07–P10, P13, P20 | dias | Bom para perguntas operacionais |
| Ofício/comunicação oficial da SEMAG | P06, P11, P12 | semanas | Necessário para visita e entrevistas |
| Entrevista semiestruturada | P07–P10, P13, P20 | 1 sessão por área | Roteiro na seção 8.3 |
| Visita técnica a 1–2 UBS | P11–P13, P15 | 1 dia | Ver o que está na tela é a evidência mais forte |
| CNES / DATASUS / e-Gestor AB | P16, P07 (parcial) | imediato | Público, sem necessidade de pedido |
| PNCP, Portal da Transparência, Diário Oficial, TCE-PE | P02, P03 | imediato | Contratos e licitações |
| RNDS / e-SUS APS (documentação pública) | P04, P07 (referência) | imediato | Define o que é possível tecnicamente |

### 3.1 Regras do pedido LAI

- Identificar o requerente e o endereço de resposta (art. 10 da Lei 12.527/2011).
- Descrever o pedido de forma objetiva e delimitada; não pedir "todos os dados".
- Não exigir motivação — a lei não permite exigi-la para informação pública.
- Guardar protocolo, data e resposta; anexar ao registro de evidências.
- Se houver negativa, registrar o motivo e avaliar recurso administrativo.
- **Não** pedir dado pessoal de terceiro nem informação sob sigilo; o que se
  quer é o **catálogo de sistemas e contratos**, não o conteúdo dos prontuários.

## 4. Evidências já levantadas (públicas)

| # | Evidência | Fonte | Data da consulta | Confiança |
|---|---|---|---|---|
| E01 | O Apollo é da JC Sistemas, sediada em Lins/SP; contato `suporte@jcsistemas.com`, (14) 3523-2306 | site da JC Sistemas e páginas `*.jcsistema.com` | 2026-10-28 | Alta |
| E02 | Instâncias públicas do Apollo estão em municípios paulistas (Lins, Platina, Guarantã, Garça, Ocaçu) | `lins.jcsistema.com`, `platina.jcsistema.com`, `guaranta.jcsistema.com`, `garca.jcsistema.com`, `ocaucu.jcsistema.com` | 2026-10-28 | Alta |
| E03 | O sistema roda em Java/JSF (`.xhtml`) sobre WildFly; não há portal público de API ou documentação para desenvolvedores | páginas públicas das instâncias | 2026-10-28 | Alta |
| E04 | O PDF de referência é um TCC da FATEC Lins e descreve o Apollo como sistema **de Lins** | `docs/referencia/app_saude_referencia.pdf`, cap. 2 | 2026-10-28 | Alta |
| E05 | Não foi localizado contrato, instância ou menção pública ligando o Apollo a Lagoa de Itaenga | buscas públicas, PNCP, portais de transparência | 2026-10-28 | Média (ausência de evidência) |
| E06 | Relato de experiência na UBS Noêmia Aragão (Lagoa de Itaenga) usou dados de "prontuários" e do "sistema e-SUS"; a modalidade (CDS/PEC) **não é explicitada** | VICTOR, B.V.O. (2021), Repositório LAIS/UFRN | 2026-10-28 | Média |
| E07 | O CNES lista, entre outros, Central de Regulação, CAPS, CEO, NASF, 10 PSF, policlínica e SAMU no município | CNES/DATASUS | 2026-10-28 | Alta |
| E08 | Há credenciamentos recentes de laboratório e de consultas especializadas em regime de mutirão | publicações municipais | 2026-10-28 | Média |
| E09 | O Saúde+ já sincroniza CNES (`CNES_MUNICIPIO_CODE=260850`) e alertas InfoDengue | `server/scripts/sync-cnes.js`, `sync-alerts.js` | 2026-10-28 | Alta (código) |

### 4.1 O que essas evidências permitem concluir

- É **improvável** que o Apollo seja o sistema do município, mas isso não está
  provado. A hipótese não sustenta decisão de arquitetura.
- O uso de e-SUS na APS é **provável**, mas a modalidade é desconhecida — e a
  diferença entre CDS e PEC muda completamente o desenho da integração.
- O município tem **regulação formalizada** (CNES), o que sugere fila e
  autorização de procedimentos como parte do fluxo real.
- A ausência de contrato localizado no PNCP pode significar contrato antigo,
  dispensa, adesão a ata ou simples falha de indexação.

## 5. Cronograma

| Semana | Atividade | Saída |
|---|---|---|
| 1 | Enviar LAI, e-mail à SMS e ofício à SEMAG; abrir o registro de evidências | Protocolos e mensagens enviadas |
| 1–2 | Verificação em CNES, PNCP, transparência, diário oficial, TCE-PE | Tabela de evidências preenchida |
| 2–3 | Entrevistas (APS, regulação, DPO) e visita a 1–2 UBS | Notas + checklist assinado |
| 3–4 | Consolidar respostas, atualizar cenário e matriz de decisão | Versão 1.0 deste documento |
| 4 | Revisar `INTEROPERABILIDADE.md` e `REQUISITOS_REFERENCIA.md` com base nas respostas | Escopo repriorizado |

Enquanto o discovery corre, a **Fase 0** (correções e testes) e a **Etapa 1**
(documentos) seguem em paralelo. O discovery **não bloqueia** o desenvolvimento
do núcleo do produto.

## 6. Critérios de conclusão

O discovery é considerado concluído quando:

- [ ] P01–P03 têm resposta oficial registrada (LAI ou ofício).
- [ ] P04–P06 têm resposta do fornecedor ou da Secretaria.
- [ ] P07 está respondido com a modalidade do e-SUS e o número de UBS em PEC.
- [ ] P09 está respondido com o fluxo real da fila de especialidades.
- [ ] P17–P19 têm DPO, papéis LGPD e existência de DPA/RIPD registrados.
- [ ] O cenário (A, B, C ou D) está escolhido e justificado.
- [ ] `INTEROPERABILIDADE.md` reflete o cenário escolhido.

## 7. Cenários e consequências

| Cenário | Descrição | Consequência para o Saúde+ |
|---|---|---|
| **A** | e-SUS PEC + RNDS homologados | Integração por FHIR/RNDS; Saúde+ é camada de agenda e fila, não prontuário |
| **B** | Apenas e-SUS CDS (offline) | Sem integração automática; exportação/importação assistida; Saúde+ assume a agenda local |
| **C** | Fornecedor terceiro com API | Adaptador dedicado atrás de feature flag, com contrato, DPA e sandbox |
| **D** | Nada informatizado | Saúde+ é o sistema principal; prioridade total em Fase 0, testes e usabilidade |

Observação: **B** e **D** são os cenários mais prováveis hoje. Isso **aumenta**
a importância do Saúde+, mas **reduz** o risco de integração prematura.

## 8. Minutas

### 8.1 Pedido de acesso à informação (LAI)

> **Ao Serviço de Informação ao Cidadão — Prefeitura Municipal de Lagoa de Itaenga/PE**
>
> Assunto: Pedido de acesso à informação — sistemas de informação em saúde
>
> Prezados, com fundamento na Lei nº 12.527/2011 e na norma municipal de acesso
> à informação, solicito:
>
> 1. Relação dos sistemas informatizados utilizados pela Secretaria Municipal de
>    Saúde, por área (atenção primária, regulação, especialidades, laboratório,
>    farmácia, vigilância), com o nome do sistema e do fornecedor.
> 2. Relação dos contratos vigentes de licença, manutenção ou prestação de
>    serviços de software de saúde, com número do contrato, fornecedor, objeto,
>    vigência e valor.
> 3. Indicação de qual sistema é utilizado para agendamento de consultas e para
>    a fila de consultas especializadas.
> 4. Informação sobre a existência de documentação de interface (API) e de
>    ambiente de homologação dos sistemas indicados.
> 5. Identificação do setor e do responsável técnico pela gestão desses
>    sistemas.
> 6. Identificação do Encarregado pelo Tratamento de Dados Pessoais (DPO) do
>    município e do canal de atendimento ao titular.
>
> Não se solicita acesso a prontuários, dados pessoais de pacientes ou
> informação protegida por sigilo. Solicito resposta em formato eletrônico para
> o endereço informado abaixo.
>
> Nome completo: ______________________
> CPF: ______________________
> Endereço: ______________________
> E-mail: ______________________
> Telefone: ______________________
> Data: ____/____/______

### 8.2 E-mail à Secretaria Municipal de Saúde (APS e Regulação)

> Assunto: Levantamento técnico para projeto de agendamento online — Saúde+
>
> Prezados(as),
>
> Estamos desenvolvendo o Saúde+, uma aplicação de agendamento de consultas
> voltada ao SUS de Lagoa de Itaenga, e precisamos de algumas informações
> operacionais para que o sistema reflita a rotina real das unidades. Pedimos
> que as respostas sejam encaminhadas ao responsável técnico indicado.
>
> 1. A atenção primária usa o e-SUS APS na modalidade **CDS** (coleta de dados
>    simplificada) ou **PEC** (prontuário eletrônico do cidadão)? Quantas UBS
>    utilizam PEC?
> 2. Quem alimenta o e-SUS hoje e com que frequência?
> 3. Se usa e-SUS APS versão 4.2 ou superior: a integração com a RNDS já foi
>    **habilitada no e-Gestor APS**, pelo perfil "Administrador da Instalação"?
>    (Essa é uma funcionalidade pronta do próprio e-SUS — pergunta de sim/não.)
> 4. Como é feita a fila de consultas especializadas e de exames: sistema
>    próprio, sistema estadual/federal, planilha ou livro?
> 5. Como funcionam os mutirões e credenciamentos de especialidades?
> 6. Qual o horário real de marcação e de atendimento em cada unidade?
> 7. Qual a qualidade da conexão de internet nas UBS e quantos computadores ou
>    tablets há por unidade?
> 8. Quem é o Encarregado (DPO) e qual o canal para assuntos de LGPD?
>
> Não solicitamos dados de pacientes; as perguntas são sobre processo e
> infraestrutura. Colocamo-nos à disposição para uma visita técnica e para
> apresentar o projeto.
>
> Atenciosamente,
> [nome] — [cargo] — [contato]

### 8.3 Roteiro de entrevista (40–50 min)

**Bloco 1 — Fluxo atual (15 min)**

1. Descreva o caminho de um paciente que precisa de consulta com especialista,
   do primeiro contato até a consulta.
2. Onde esse fluxo trava hoje? O que mais gera reclamação?
3. Quem decide a prioridade? Existe fila por gravidade?
4. O que acontece quando o paciente falta? A vaga é reaproveitada?

**Bloco 2 — Sistemas (15 min)**

5. Quais telas você abre durante o dia de trabalho?
6. O que é digitado duas vezes (no papel e no sistema)?
7. O que o e-SUS resolve e o que ele não resolve para a agenda?
8. Existe relatório que você gostaria de ter e não tem?

**Bloco 3 — Restrições (10 min)**

9. Qual o horário em que a internet costuma cair?
10. Quantas pessoas operam o sistema por turno?
11. O que não pode mudar no processo atual, por exigência de norma ou costume?

**Bloco 4 — LGPD e governança (10 min)**

12. Quem autoriza compartilhar dados de agendamento com terceiros?
13. Já houve incidente ou pedido de titular? Como foi tratado?
14. Existe orientação jurídica sobre contratos de tecnologia?

### 8.4 Checklist de visita técnica

- [ ] Sistema aberto na tela: nome, versão, fornecedor, se é web ou local.
- [ ] Como o agendamento é registrado (sistema, planilha, livro, papel).
- [ ] Se há integração visível entre recepção e sala do profissional.
- [ ] Impressão de comprovante e lista do dia.
- [ ] Velocidade real da internet (teste simples de latência).
- [ ] Quantidade e estado dos equipamentos.
- [ ] Rotina de falta, atraso e encaixe.
- [ ] Armazenamento de documentos com dado pessoal (armário, sala, descarte).
- [ ] Quem tem acesso ao sistema e como o acesso é concedido/revogado.

## 9. Registro de evidências

Preencher uma linha por resposta obtida. Sem fonte e data, não é evidência.

| # | Pergunta | Resposta | Fonte | Data | Confiança | Impacto |
|---|---|---|---|---|---|---|
| 1 | | | | | | |

### 9.1 Diário de decisões

| Data | Decisão | Justificativa | Quem decidiu |
|---|---|---|---|
| 2026-10-28 | Remover o Apollo do escopo | TCC é de Lins/SP; sem vínculo público com Lagoa de Itaenga | Product owner |
| | | | |

## 10. O que não faremos

- Não acessar sistemas de terceiros sem autorização formal.
- Não procurar, testar ou armazenar credenciais de terceiros.
- Não raspar áreas autenticadas nem contornar controles de acesso.
- Não usar dado real de paciente em ambiente de desenvolvimento.
- Não iniciar integração antes dos gates da seção 7 de
  `INTEROPERABILIDADE.md`.

## 11. Referências

- Lei nº 12.527/2011 — Lei de Acesso à Informação.
- Lei nº 13.709/2018 — LGPD, em especial arts. 7º, 11, 23, 37, 38, 39, 46 e 48.
- Ministério da Saúde — e-SUS APS (CDS e PEC) e RNDS/FHIR.
- CNES/DATASUS — estabelecimentos de saúde do município.
- VICTOR, B. V. O. *Promoção de ações estratégicas para aprimorar o
  acolhimento e a saúde da criança na UBS Noêmia Aragão, Lagoa de Itaenga/PE*.
  Repositório LAIS/UFRN, 2021.
- JC Sistemas — páginas públicas das instâncias Apollo (Lins, Platina,
  Guarantã, Garça, Ocaçu), consultadas em 2026-10-28.
