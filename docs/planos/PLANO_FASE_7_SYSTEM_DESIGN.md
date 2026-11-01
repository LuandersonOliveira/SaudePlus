# Fase 7 — Atualização do grafo e análise de *system design*

| | |
|---|---|
| **Status** | Planejada (não iniciada) |
| **Criada em** | 2026-11-01 |
| **Depende de** | Fase 6 (análise de estrutura) e A1/A2/A3/A4 concluídos; baseline de e2e verde |
| **Decide** | O que **editar**, **remover** ou **criar** no projeto a partir do que a análise mostrar |
| **Posição na ordem** | **Antes** do 3B (`staff.routes.js`), de `admin.routes.js` e dos itens pequenos do backlog: o resultado pode mudar o corte desses passos |

## 1. Por que esta fase

A Fase 6 olhou o projeto por **arquivos e tabelas** (rotas gordas, FKs, migrations). Depois dela o código mudou muito: camadas novas (`services/`, `repositories/`, `schemas/`), módulos puros, migrations numeradas, legado removido, origem única `/api`. O grafo em `graphify-out/` foi gerado **antes** disso e já não descreve o sistema.

*System design* é definir a arquitetura, os componentes, os módulos, as interfaces e os fluxos de dados para atender a requisitos específicos. Esta fase confere se o que foi construído **atende aos requisitos** (agendamento sem dupla marcação, LGPD, interoperabilidade SUS, operação de uma prefeitura) e se a estrutura certa está no lugar — em vez de continuar refatorando arquivo por arquivo sem uma visão do todo.

## 2. Etapas

### 7.1 Atualizar o grafo
- Pré-condição: árvore limpa e commit de referência registrado.
- **Escopo do grafo:** `server/src`, `server/migrations`, `server/scripts`, `server/test`, `web/src`, `e2e`, `scripts`, `docs/tecnico`, `docs/governanca`, `README.md`. **Fora:** `node_modules`, `web/dist`, `server/backups`, `e2e/.auth`, `.claude/`, `.vscode/` (o manifesto atual mostra `.claude/settings.local.json` indexado: configuração local, sem valor arquitetural e possivelmente sensível).
- Rodar `/graphify . --update` (incremental). Se o manifesto estiver muito defasado ou o escopo mudar, refazer completo (`/graphify .`) e registrar o custo.
- Conferir a cobertura: os arquivos novos (`services/*`, `repositories/*`, `schemas/*`, `utils/booking-*.js`, `migrations/*`) aparecem como nós, com suas arestas de `require`.
- Registrar no relatório: data, commit, nº de nós/arestas/comunidades e custo (`cost.json`).
- Decidir o destino de `graphify-out/` (3 MB gerado): `.gitignore` (recomendado) ou versionar só `GRAPH_REPORT.md`.

### 7.2 Mapear o sistema (modelo C4 + fluxos)
Entregue em `docs/tecnico/SYSTEM_DESIGN.md`, com diagramas Mermaid:
1. **Contexto:** atores (paciente, atendente, admin/superadmin, DPO) e sistemas externos (Gov.br, RNDS, CNES, InfoDengue, SMTP, MySQL).
2. **Contêineres:** front React (Vite), API Express (que também serve o front), job de lembretes (in-process), MySQL, backups.
3. **Componentes da API** por camada: rotas → serviços → repositórios → núcleo puro; middlewares transversais (auth, capacidades, auditoria, rate limit, validação).
4. **Front:** features por papel, camada `lib/` (api, sessão, validadores), contratos com a API.
5. **Sequências dos fluxos críticos:** cadastro e login (com MFA e Gov.br), agendamento (locks, validação, `UNIQUE`), remarcação/cancelamento e liberação de vaga pela fila, desativação de profissional, lembretes, exportação e exclusão LGPD.
6. **Fluxo de dados pessoais:** onde o dado nasce, é cifrado (AES-256-GCM), indexado (HMAC), auditado, exportado e anonimizado — conferido contra `ROPA.md` e `RIPD.md`.

### 7.3 Analisar com o grafo (evidência, não opinião)
**Primeira análise: por entidade.** Antes das consultas ao grafo, cada tabela e suas colunas são examinadas quanto a quem escreve, quem lê, o que valida, o que o banco garante, o que é auditado e como o dado sai (rascunho em `SYSTEM_DESIGN.md`, seção 8). O grafo entra depois para confirmar, com `explain` por entidade.

Consultas ao grafo (`/graphify query`, `path`, `explain`) para responder, cada uma com a evidência anexada:
- **Nós centrais (god nodes):** quais módulos concentram dependências? São os que deveriam?
- **Comunidades:** os agrupamentos que o grafo encontra coincidem com os módulos pretendidos? Onde há comunidades que misturam domínios (ex.: staff × admin × booking)?
- **Violações de camada:** rota importando repositório direto, serviço importando rota, util importando serviço, dependência circular.
- **Código sem arestas de entrada:** módulos, funções e scripts que ninguém usa (candidatos a remover — ex.: `acharPorCpf`).
- **Duplicações estruturais:** lógica parecida em dois lugares (ex.: criação de agendamento do paciente × da recepção; listagens de consultas × exames).
- **Caminhos entre requisitos e código:** de cada requisito crítico até o componente que o garante.

### 7.4 Avaliar contra atributos de qualidade
Matriz **requisito × componente × evidência**, com nota (atende / parcial / não atende) para:
| Atributo | Perguntas principais |
|---|---|
| **Consistência e concorrência** | Toda escrita de agenda passa pelas travas e pelo `UNIQUE`? Há outro caminho de escrita? |
| **Segurança e privacidade** | RBAC e escopo do atendente em *todas* as rotas de staff/admin? Segredos cifrados? Auditoria completa? Relatórios e histórico com escopo? |
| **Interfaces e contratos** | Formato de erro único? Rotas sem validação por esquema? Contrato documentado (OpenAPI) ou só implícito? Versionamento da API? |
| **Desempenho e escala** | Consultas N+1, falta de índice, paginação ausente, relatórios que varrem tabela inteira. |
| **Disponibilidade e operação** | Job in-process e instância única; migrations e rollback; backup e restauração testados; *health/readiness*; configuração por ambiente. |
| **Observabilidade (A5)** | Request id, logs estruturados, métricas mínimas, rastreio de erro. |
| **Testabilidade** | Regra testável sem HTTP? Cobertura dos fluxos críticos no e2e? |
| **Evolução** | Acoplamento entre papéis e módulos; custo de adicionar um serviço, um papel ou uma unidade. |

### 7.5 Decidir: editar, remover, criar, manter
Cada achado entra num **registro de achados** com severidade, evidência (consulta do grafo ou arquivo:linha) e uma destas classes:

| Classe | Critério |
|---|---|
| **Remover** | Sem aresta de entrada no grafo, sem teste, fora da documentação e sem requisito que dependa dele. |
| **Editar** | Existe, mas viola camada, duplica lógica, tem acoplamento alto ou não atende ao requisito. |
| **Criar** | Requisito sem componente, ou capacidade transversal ausente (ex.: observabilidade, contrato OpenAPI, política de retenção do audit log). |
| **Manter** | Atende; fica registrado o porquê, para não ser reaberto. |

Decisões estruturais viram **ADR** novo (`docs/tecnico/adr/`). O backlog resultante substitui, reordena ou cancela os itens pendentes da Fase 6 (3B, `admin.routes.js`, A5, B4…).

### 2.1 Critério de projeto: 4 pilares da POO e SOLID

Decidido em 2026-11-01: toda análise (7.3, 7.4) e toda proposta (7.5) usa os **4 pilares da POO** e os **princípios SOLID** como régua de boas práticas. O backend é feito de módulos e funções, não de classes. Os princípios valem do mesmo jeito: o "objeto" é o módulo (rota, serviço, repositório, util) e a "interface" é o que ele exporta.

| Princípio | Como se lê neste código | Sinal de violação (o que procurar) |
|---|---|---|
| **Encapsulamento** | O módulo esconde SQL, segredos e estado, e expõe poucas funções. Exemplo bom: `services/profile` recebe `{encrypt, decrypt}` e não conhece a chave. | Rota com SQL (`staff`, `admin`, `catalog`, `units`); `process.env` lido em ~15 módulos; estado em memória (`loginAttempts`) acessado de fora. |
| **Abstração** | A regra de negócio tem nome e vive separada de HTTP e de SQL. Exemplo bom: `validateBooking`, `adminHierarchy`. | O mesmo `INSERT` de agendamento em três lugares; regra de prioridade repetida em listagens. |
| **Herança** (em JS: reuso por composição) | Comportamento comum entra uma vez e é composto. Exemplo bom: `createBookingRouter(tipo)`. | Código copiado entre `appointments` e `exams`, entre rota do paciente e da recepção. |
| **Polimorfismo** | O mesmo contrato atende variantes sem `if` espalhado. Exemplo bom: `TIPOS` (consulta/exame), `mailer` com e sem SMTP. | `if (tipo === ...)` repetido em vários arquivos; integrações chamadas de forma diferente entre si. |
| **S**: responsabilidade única | Um módulo, um motivo para mudar. | `staff.routes.js` (590 linhas: agenda, relatórios, criação, listagens, pacientes); `admin.routes.js`. |
| **O**: aberto/fechado | Novo tipo, papel ou capacidade entra sem editar vários arquivos. Exemplo bom: mapa de `capabilities`. | Adicionar um tipo de atendimento exige mexer em rota, serviço e SQL. |
| **L**: substituição de Liskov | Onde se espera um `db`, serve o pool ou a conexão da transação. Exemplo bom: `repositories/*` recebem `db` primeiro. | Função que só funciona com `pool` (usa `getConnection` sem avisar) ou com conexão. |
| **I**: segregação de interfaces | O módulo recebe só o que usa. | Serviço que recebe `req` inteiro; `utils/booking.js` exportando tudo para todos. |
| **D**: inversão de dependência | Regra depende de uma abstração (`db`, `{encrypt, decrypt}`), não de um módulo concreto. | `require('../db')` direto dentro de serviços e rotas; util apontando para serviço (`utils/booking.js` → `services/`). |

Cada achado da 7.5 anota qual princípio viola ou cumpre. A refatoração só é proposta quando o ganho é concreto (menos código repetido, regra testável sem HTTP, risco menor), não para "ficar bonito": SOLID é régua, não meta.

## 3. Entregáveis
1. `graphify-out/` atualizado, com data, commit e custo registrados.
2. `docs/tecnico/SYSTEM_DESIGN.md`: visão do sistema, diagramas e fluxos.
3. `docs/tecnico/SYSTEM_DESIGN_ACHADOS.md`: registro de achados (classe, severidade, evidência) e matriz de atributos.
4. ADRs para cada decisão estrutural.
5. Plano de execução revisado: ordem, esforço e dependências do que for aprovado.

## 4. Critérios de pronto
- O grafo reflete o código do commit registrado (arquivos novos presentes, sem `.claude/`).
- Todo fluxo crítico listado tem diagrama de sequência conferido contra o código.
- Cada achado tem evidência rastreável e uma classe; nenhuma mudança de código é feita nesta fase sem aprovação **item a item** do responsável.
- A análise responde, com evidência, se a estrutura atual atende aos requisitos de `PRODUCT.md`, LGPD e RNDS, e o que falta.

## 5. Pré-requisitos e riscos
- **Baseline de e2e verde antes de começar** (o último resultado, 28/28, é anterior à remoção do legado e à refatoração A1/A2). Rodar em banco descartável, com a API local parada.
- **Custo do grafo:** a extração semântica consome tokens; usar `--update` e registrar `cost.json`. O grafo pode ter ruído (arestas inferidas): toda conclusão importante é confirmada lendo o código.
- **Subjetividade:** "boa arquitetura" depende do requisito. Por isso a matriz parte dos requisitos e cada decisão é do responsável, não do relatório.
- **Escopo:** esta fase **analisa e propõe**; executar as mudanças é a fase seguinte, com planos próprios.

## 6. Checklist
- [x] Baseline: e2e verde em banco descartável (28/28)
- [x] 7.1 Escopo do grafo definido; `.claude/` e dependências fora
- [x] 7.1 `graphify` atualizado; cobertura dos arquivos novos conferida
- [x] 7.1 Destino de `graphify-out/` decidido
- [x] 7.2 `SYSTEM_DESIGN.md`: contexto, contêineres, componentes, sequências, fluxo de dados pessoais (commit de referência `8f8f8f0`)
- [x] 7.2 Análise por entidade (seção 8 do `SYSTEM_DESIGN.md`): 16 tabelas
- [x] Critério de projeto definido: 4 pilares da POO e SOLID (seção 2.1)
- [ ] 7.3 Consultas ao grafo: nós centrais, comunidades, violações de camada, código sem uso, duplicações (parcial: entidades, código sem uso, camadas e duplicações em `SYSTEM_DESIGN_ACHADOS.md`; faltam nós centrais, comunidades e caminhos requisito → código)
- [ ] 7.4 Matriz requisito × componente × evidência
- [ ] 7.5 Registro de achados classificado (remover / editar / criar / manter)
- [ ] 7.5 ADRs das decisões estruturais
- [ ] Plano revisado entregue para aprovação item a item
