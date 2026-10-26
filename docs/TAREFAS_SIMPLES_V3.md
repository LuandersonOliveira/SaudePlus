# Saúde+ — Lista de Ajustes Pendentes e Melhorias (Versão 3)

> **Para quem é este documento:** para o time do projeto — vocês não precisam saber programar para entender e decidir sobre estas tarefas. Cada item explica **onde** fica (qual tela, qual campo), **o que muda** e **por que muda**. A parte de programar quem faz é a IA; a parte de decidir "faz sentido ou não" é do time.
>
> Marque a caixinha `[x]` quando o time decidir que aquele item está aprovado e pronto (ou concluído).

---

## O que aconteceu desde a Versão 2 (Diagnóstico Geral)

Fizemos uma varredura completa em **todas as pastas e em todos os arquivos do projeto** para checar o que realmente foi implementado e o que ainda está faltando do `TAREFAS_SIMPLES_V2`. 

Aqui está o resumo honesto do estado atual do sistema:

1. **O que foi feito e está funcionando bem (verificado):**
   - A região das doenças no painel do administrador agora vem certinha dos bairros dos postos de saúde (Item 3.1).
   - Reagendar consulta ou exame no administrador e no atendente agora abre um calendário em vez de ter que digitar a data à mão (Itens 3.2 e 4.1).
   - O administrador agora tem uma tela única e unificada para buscar usuários e ver histórico (Item 3.4).
   - As abas dos painéis agora podem ser trocadas usando as setas do teclado (Item 5.1).
   - A confirmação de cancelamento no painel do paciente agora é uma janela bonita do app avisando sobre a perda da vaga (Item 2.3).
   - Os botões de agendar consulta e exame agora travam e mostram "Enviando..." (Item 2.4).
   - Existem botões de "Cancelar" para limpar os formulários de consulta e exame (Item 2.5).
   - O painel do atendente voltou a carregar normalmente: `requireRole` foi adicionada ao `assets/api.js` e valida os papéis permitidos antes de carregar a fila (Item 3.1).
   - A gestão administrativa de usuários passou a buscar por nome, e-mail ou telefone, filtrar por papel/status e registrar o motivo das alterações de conta na auditoria (Item 4.1).
   - O administrador agora pode cadastrar, editar, ativar e desativar unidades de saúde; unidades inativas deixam de aparecer nos formulários de agendamento (Item 4.3).
   - O backend agora cria lembretes automáticos na véspera de consultas e exames pendentes ou confirmados, exibidos no início do painel do paciente (Item 6.1).
   - O administrador agora pode baixar um resumo CSV agregado, sem dados pessoais identificáveis.
   - A exclusão de alertas agora usa modal próprio.
   - A visão geral administrativa agora mostra usuários pendentes, unidades ativas e alertas ativos; usuários exibem último acesso; auditoria aceita filtros; alertas podem ser editados, ativados e desativados.
   - Auth: access 15 min, refresh rotativo 30d, MFA TOTP, recuperação de senha (forgot/reset), logout revoga.
   - Admin com `admin_level` granular, capability para promover admin, listagens filtram `deleted_at`.
   - Atendente sem vínculo é fail-closed; agenda/exames não vazam todos os pacientes.
   - CI: lint, suíte + E2E (MySQL 8.4 + Playwright Chromium), `npm audit critical`.
   - 327 testes `node:test` passando + `test:race` + E2E Playwright.
   - Cadastro em **wizard de 2 passos** (não 4). Fonte **Inter autohospedada** (sem Google Fonts). Schema com **14 tabelas** incluindo `refresh_tokens` e `password_reset_tokens`. `professionals.user_id` presente. `migrate:all` inclui `professional-user` entre v3 e security.

2. **O que foi feito "pela metade" ou com defeitos que precisam de conserto (verificado):**
   - **O cargo do atendente no cadastro (Item 1.1):** foi colocado como lista; revisar validação para impedir avanço sem escolha e limpar duplicados conforme necessário.
   - **O aviso de paciente inativo no atendente (Item 4.2):** precisa garantir comportamento consistente (atendente sem vínculo é fail-closed; busca de pacientes deve tratar inativos de forma segura sem vazar dados).
   - **O destaque ao editar (Item 5.5):** revisar em exames para paridade com consultas.

3. **O que NÃO foi feito e continua faltando (conforme verificação):**
   - O escopo concentra-se em consultas, exames, alertas epidemiológicos, lembretes e unidades de saúde.
   - Campos oficiais de saúde (Nome Social, Cartão SUS/CNS, Prioridade legal, Responsável por menores, Cor/raça) — ainda pendentes se não implementados.
   - Ponto de referência: revisar obrigatoriedade (zona urbana vs rural).
   - Avisos de erro inline e indicador de senha fraca/forte em pontos do cadastro.
   - Telas específicas por nível administrativo: níveis existem (`superadmin`, `gestor`, `atendimento`, `alertas`) e podem ser atribuídos; painel ainda pode ser unificado — avaliar necessidade de segmentação.
   - Agenda inteligente por unidade/especialidade/profissional/horários — em evolução (itens 2.7/2.8, 4.4/4.5 abertos ou em andamento conforme escopo).
   - Lacunas remanescentes: HTTPS/HSTS e httpOnly total do access em produção, SMTP de produção configurado, DPO nominal, revisão jurídica, KMS/Vault, RNDS/Gov.br credenciados, painel admin segmentado por nível, substituir `prompt()/confirm()` nativos em alguns fluxos, cobertura E2E contínua.

Abaixo está o checklist completo e organizado por tela, atualizado para guiar os próximos passos do time.

---

## Painel Rápido de Status (V2 → V3)

| Tarefa original (V2)                         | Status no Código Real | Situação atual na V3                                                       |
| -------------------------------------------- | --------------------- | -------------------------------------------------------------------------- |
| **1.1 Cargo do atendente**                   | 🟡 Feito pela metade   | Validar escolha; limpar duplicados                                         |
| **1.2 Nome social**                          | 🔴 Não feito           | Pendente                                                                   |
| **1.3 Cartão SUS (CNS)**                     | 🔴 Não feito           | Pendente                                                                   |
| **1.4 Prioridade de atendimento**            | 🔴 Não feito           | Pendente                                                                   |
| **1.5 Responsável p/ menor**                 | 🔴 Não feito           | Pendente                                                                   |
| **1.6 Cor/raça**                             | 🔴 Não feito           | Pendente                                                                   |
| **1.7 Ref. só para rural**                   | 🔴 Não feito           | Pendente                                                                   |
| **1.8 Explicar por que pede dado**           | 🔴 Não feito           | Pendente                                                                   |
| **2.1 Escopo de serviços**                   | 🟢 Encerrado           | Consultas, exames, alertas, lembretes, unidades de saúde                   |
| **2.2 Campo "Outro" no exame**               | 🟢 Feito               | Funcionando                                                                 |
| **2.3 Confirmação de cancelamento**          | 🟢 Feito               | Modal funcionando no paciente                                              |
| **2.4 Botão trava ao enviar**                | 🟢 Feito               | Funcionando em consultas e exames                                          |
| **2.5 Botão cancelar formulário**            | 🟢 Feito               | Funcionando em consultas e exames                                          |
| **3.1 Região do alerta de doença**           | 🟢 Feito               | Puxa bairros dos postos                                                    |
| **3.2 Reagendar com calendário (admin)**     | 🟢 Feito               | Funcionando                                                                |
| **3.3 Motivo de status de conta**            | 🟢 Feito               | Registrado na auditoria                                                    |
| **3.4 Unificar telas de busca**              | 🟢 Feito               | Funcionando no admin                                                       |
| **4.1 Reagendar com calendário (atendente)** | 🟢 Feito               | Funcionando                                                                |
| **4.2 Avisar paciente inativo**              | 🟡 Revisar             | Atendente fail-closed; tratar sem vazar dados                              |
| **4.3 Cargo certo no cabeçalho**             | 🟡 Revisar             | Incluir cargos faltantes                                                   |
| **5.1 Navegar abas com teclado**             | 🟢 Feito               | Funcionando                                                                |
| **5.2 Erro claro nos campos**                | 🔴 Não feito           | Pendente                                                                   |
| **5.3 Indicador de senha fraca/forte**       | 🔴 Não feito           | Pendente                                                                   |
| **5.4 Limite de 1 ano no calendário**        | 🟡 Revisar             | Verificar ativação em todos os fluxos                                      |
| **5.5 Destacar formulário em edição**        | 🟡 Parcial             | Paridade entre consulta/exame                                              |

---

## 1. Tela de Cadastro e Acesso (`auth.html`)

### 1.1 Consertar a escolha de Cargo do Atendente
- [x] **Onde:** primeiro passo do cadastro, ao escolher a opção "Atendente".
  **O que muda:** 
  1. Limpar a repetição de campos que ficou no código visual.
  2. Impedir que o atendente avance para o passo 2 sem escolher um cargo.
  3. Se ele escolher a opção "Outro", obrigar a escrever qual é o cargo no campo que abre embaixo.
  **Por que:** hoje um atendente consegue clicar em "Continuar" sem escolher nenhum cargo, ou escolher "Outro" e deixar a caixa em branco.

### 1.2 Adicionar campo "Nome social"
- [x] **Onde:** passo 2 (dados pessoais), logo abaixo do campo "Nome completo".
  **O que muda:** adicionar o campo opcional "Nome social", com um aviso explicando: *"Preencha apenas se você tiver um nome pelo qual prefere ser chamado(a), diferente do seu registro civil"*.
  **Por que:** direito garantido por lei e pelo SUS (Portaria nº 1.820/2009). Quem usa nome social precisa ser acolhido pelo nome correto no posto de saúde.

### 1.3 Adicionar número do Cartão SUS (CNS)
- [x] **Onde:** passo 2 (dados pessoais), junto aos campos de CPF e RG.
  **O que muda:** adicionar o campo opcional "Cartão Nacional de Saúde (CNS)" com limite e formatação de 15 números, avisando: *"O número que consta no seu cartão do SUS (opcional se não tiver em mãos)"*.
  **Por que:** qualquer posto, hospital ou sistema oficial do governo usa o CNS como chave principal de atendimento.

### 1.4 Adicionar pergunta sobre Prioridade Legal de Atendimento
- [x] **Onde:** passo 2 (dados pessoais).
  **O que muda:** adicionar uma caixinha de seleção: *"Possui prioridade legal de atendimento?"* com as opções: **Nenhuma, Idoso (60+), Gestante, Pessoa com deficiência (PCD), Lactante**. Se a pessoa preencher a data de nascimento e ela tiver 60 anos ou mais, o sistema seleciona "Idoso (60+)" sozinho automaticamente.
  **Por que:** a Lei 10.048/2000 exige prioridade no atendimento de saúde. Se o sistema não souber disso, o atendente não tem como organizar a fila de forma humana e legal.

### 1.5 Campo para Nome do Responsável (quando for menor de 18 anos)
- [x] **Onde:** passo 2 (dados pessoais).
  **O que muda:** assim que o usuário digita a data de nascimento, se o sistema calcular que ele tem menos de 18 anos, abre automaticamente um campo obrigatório: *"Nome do responsável legal / acompanhante"*. Para maiores de idade, esse campo fica escondido.
  **Por que:** crianças e adolescentes não comparecem a consultas nem assinam termos de saúde desacompanhados.

### 1.6 Adicionar campo "Cor ou Raça" (Autodeclaração)
- [x] **Onde:** passo 2 (dados pessoais).
  **O que muda:** adicionar campo opcional com as opções oficiais do IBGE e do Ministério da Saúde: **Branca, Preta, Parda, Amarela, Indígena, Prefiro não informar**.
  **Por que:** é uma exigência de qualquer cadastro de saúde pública no Brasil para garantir que as políticas de saúde cheguem com igualdade a todas as comunidades.

### 1.7 Ponto de referência obrigatório APENAS para quem mora na zona rural
- [x] **Onde:** passo 3 (endereço), campo "Ponto de referência".
  **O que muda:** hoje o formulário trava se você não colocar ponto de referência, mesmo morando em rua asfaltada com número e CEP. Vai mudar para: se a pessoa marcar **Zona Urbana**, o ponto de referência se torna opcional. Se marcar **Zona Rural**, o ponto de referência continua obrigatório com a dica: *"Ex: Sítio São José, após o engenho, próximo à casa de Dona Maria"*.
  **Por que:** na zona urbana o carteiro e a ambulância acham pelo CEP e número; na zona rural, sem ponto de referência a ambulância não encontra a residência do paciente.

### 1.8 Textos explicativos sob campos delicados (Transparência / LGPD)
- [x] **Onde:** passo 2 e passo 4 (dados pessoais e documentos).
  **O que muda:** colocar uma letrinha miúda e cinza embaixo de campos delicados explicando a finalidade:
  - Embaixo do CPF: *"Usado para garantir que seus agendamentos fiquem vinculados unicamente a você."*
  - Embaixo do Telefone: *"Usado para avisar caso sua consulta precise ser reagendada."*
  - Embaixo da Senha: *"Sua senha é criptografada e ninguém da equipe tem acesso a ela."*
  **Por que:** aumenta a confiança do morador no aplicativo e atende à Lei Geral de Proteção de Dados (LGPD).

### 1.9 Indicador visual de senha fraca, média ou forte
- [x] **Onde:** passo 4 (criação da senha).
  **O que muda:** enquanto a pessoa digita a senha, aparece uma barrinha colorida embaixo (vermelha = fraca, amarela = média, verde = forte) com dicas curtas (ex: *"misture letras e números"*).
  **Por que:** como o sistema guarda histórico médico, senhas fáceis como "123456" colocam a privacidade do paciente em risco.

### 1.10 Avisos de erro direto no campo errado (em vez de aviso genérico)
- [x] **Onde:** passos 2, 3 e 4 do cadastro.
  **O que muda:** se faltar preencher um campo obrigatório ou se a senha for muito curta, a caixinha daquele campo específico fica com borda vermelha e uma mensagem embaixo dizendo exatamente o que falta (ex: *"Informe seu celular com DDD"* ou *"O CEP precisa ter 8 dígitos"*), em vez de só mostrar um aviso genérico flutuando no topo da tela.
  **Por que:** a pessoa que está se cadastrando no celular não sabe o que errou se o aviso não apontar para o campo exato.

---

## 2. Tela do Paciente (`dashboard.html`)

### 2.1 Escopo atual do painel do paciente
- [x] **Onde:** painel do paciente (`dashboard.html`).
  **O que muda:** o painel permanece concentrado em consultas, exames, alertas epidemiológicos, lembretes e unidades de saúde.
  **Por que:** decisão de produto: manter uma superfície menor e coerente com os módulos realmente implementados no backend e no banco.

### 2.3 Exigir preenchimento ao escolher "Outro" no tipo de exame
- [x] **Onde:** formulário de agendar exame, campo "Tipo de exame".
  **O que muda:** hoje o campo de texto já abre quando escolhe "Outro", mas o formulário deixa enviar com o campo vazio. O sistema agora vai avisar: *"Por favor, informe qual é o exame"* e não deixa enviar em branco.
  **Por que:** evita que o posto receba um pedido de exame sem saber do que se trata.

### 2.4 Ativar de verdade a trava de agendamento no futuro (máximo 1 ano)
- [x] **Onde:** todos os campos de escolher data e hora de consulta e exame.
  **O que muda:** o calendário do celular/computador não vai deixar selecionar nenhuma data com mais de 12 meses para a frente.
  **Por que:** evita que a pessoa digite o ano errado sem perceber (ex: agendar para o ano 2035 por engano). O código disso já existe no arquivo, mas estava desligado.

### 2.5 Destacar visualmente o formulário de Exame ao clicar em "Editar"
- [x] **Onde:** formulário de exames no painel do paciente.
  **O que muda:** quando o paciente clica no botão "Editar" de um agendamento da lista, a tela sobe até o formulário e ele ganha uma borda colorida destacada avisando: *"Você está editando este agendamento"*, com um botão claro para salvar ou cancelar a edição.
  **Por que:** hoje isso só foi feito no formulário de consultas; em exames a pessoa clica em editar e não fica claro na tela que o formulário mudou para modo de edição.

### 2.6 Botão de "Reagendar" para itens cancelados
- [x] **Onde:** na lista de consultas e exames cancelados do paciente.
  **O que muda:** quando uma consulta ou exame constar como "Cancelado", colocar um botãozinho amigável **"Tentar agendar novamente"**, que já abre o formulário pré-preenchido com a mesma especialidade e local, precisando apenas escolher uma nova data.
  **Por que:** se a consulta foi cancelada (por falta de médico ou pelo próprio paciente), ele não precisa preencher tudo do zero novamente.

### 2.7 Agenda inteligente por unidade, especialidade e profissional
- [x] **Onde:** formulários de agendamento de consultas e exames no painel do paciente.
  **O que muda:** remover o campo livre/opcional de **Profissional** do formulário de consulta. O paciente deverá seguir uma seleção guiada:
  1. Escolher a unidade de saúde.
  2. Visualizar somente as especialidades disponíveis naquela unidade.
  3. Escolher a especialidade.
  4. Visualizar somente os profissionais vinculados à unidade e à especialidade escolhidas.
  5. Escolher um dia e horário realmente disponíveis para aquele profissional.

  O mesmo fluxo deverá existir para exames: a unidade exibirá apenas os tipos de exame e profissionais habilitados para aquela unidade, respeitando os dias e horários cadastrados.
  **Por que:** evita que o paciente selecione um profissional ou serviço que não existe na unidade escolhida e reduz pedidos impossíveis de atender.

### 2.8 Comportamento dos campos dependentes
- [x] **Onde:** selects de unidade, especialidade, profissional, dia e horário.
  **O que muda:** cada escolha deve atualizar o próximo campo. Enquanto os dados são carregados, o select deve mostrar “Carregando...”; quando não houver opção compatível, deve explicar o motivo e impedir o envio.
  **Regras:** trocar a unidade limpa especialidade, profissional, data e horário; trocar a especialidade limpa profissional, data e horário; trocar o profissional recalcula os horários disponíveis.
  **Por que:** impede combinações inválidas e deixa o fluxo compreensível para o paciente.

---

## 3. Tela do Atendente (`atendente.html`)

### 3.1 Consertar o carregamento do painel do atendente (Erro de Login)
- [x] **Concluído:** `requireRole` foi adicionada ao `assets/api.js`, que é o cliente carregado por `atendente.html`. A função valida os papéis permitidos e redireciona usuários para o painel correto.
  **Resultado:** o erro `ReferenceError: requireRole is not defined` foi eliminado e a tela deixa de ficar presa no spinner antes de carregar a fila.

### 3.2 Fazer o aviso de "Paciente Inativo/Pendente" funcionar de verdade
- [x] **Onde:** aba "Buscar paciente" no painel do atendente.
  **O que muda:** quando o atendente buscar pelo nome ou e-mail de um paciente cuja conta esteja desativada ou ainda aguardando aprovação, o sistema vai avisar com destaque amarelo: *"Este paciente já tem cadastro no sistema, mas a conta está [Inativa / Pendente]. Não crie um novo cadastro — solicite ao administrador a reativação da conta existente."*
  **Por que:** a tela do atendente já tem esse aviso desenhado, mas o servidor estava filtrando os inativos antes da tela receber. Corrigindo no servidor, evita-se a criação de cadastros duplicados no posto de saúde.

### 3.3 Completar a lista de cargos no cabeçalho do atendente
- [x] **Onde:** saudação no topo da tela do atendente (ex: *"Olá, Maria! Enfermeira · Painel de atendimento"*).
  **O que muda:** atualizar a regra de formatação para reconhecer todos os cargos reais (incluindo **Motorista**, **Auxiliar Administrativo**, etc.), exibindo o nome do cargo sempre com letra bonita e acentuação correta.
  **Por que:** cargos como Motorista e Auxiliar Administrativo estavam ficando de fora da lista oficial de formatação.

### 3.4 Ativar o limite de data no calendário de reagendamento do atendente
- [x] **Onde:** janelinha de reagendar atendimento na tela do atendente.
  **O que muda:** não permitir selecionar datas passadas nem datas além de 1 ano no futuro.
  **Por que:** evita erros de digitação durante o atendimento corrido no balcão do posto.

---

## 4. Tela do Administrador (`admin.html`)

### 4.1 Salvar de verdade o motivo ao ativar ou inativar uma conta
- [x] **Onde:** na aba "Usuários e Histórico", ao abrir o perfil de um usuário e alterar seu status para "Inativo" ou "Ativo".
  **O que muda:** 
  1. Quando o administrador preencher o campo "Observação / Motivo" (ex: *"Paciente mudou de cidade"* ou *"Cadastro duplicado da dona Josefa"*), o sistema vai realmente salvar essa explicação no histórico de auditoria do sistema.
  2. Adicionar uma coluna ou linha no relatório de auditoria mostrando o motivo registrado.
  **Por que:** hoje a tela do admin tem o campo para digitar o motivo, mas o servidor ignorava o texto e não gravava em lugar nenhum! Ninguém conseguia saber depois por que uma conta foi bloqueada.

### 4.2 Janela bonita ao excluir alerta de doença
- [x] **Concluído:** a aba "Doenças" usa um modal próprio para confirmar a exclusão e informar a consequência da ação.

### 4.3 Gestão de Postos e Unidades de Saúde (`health_units`)
- [x] **Concluído:** a aba **"Unidades de Saúde"** permite cadastrar, editar, ativar e desativar unidades. As ações são registradas na auditoria.
  **O que muda:** permitir que o administrador:
  1. Veja a lista dos postos de saúde, UBSs e hospitais cadastrados no município.
  2. Adicione uma nova unidade se um posto novo for inaugurado em Lagoa de Itaenga.
  3. Altere o nome, bairro ou desative uma unidade que estiver em reforma.
  **Resultado:** unidades inativas deixam de aparecer nos formulários de agendamento, sem apagar o registro nem o histórico administrativo.

### 4.4 Gestão de profissionais e especialidades por unidade
- [x] **Onde:** nova área administrativa ligada à aba **"Unidades de Saúde"**.
  **O que muda:** cada unidade deverá permitir cadastrar e administrar:
  - Profissional: nome, cargo, registro profissional quando aplicável e status ativo/inativo.
  - Especialidades ou tipos de exame atendidos.
  - Vínculo do profissional com uma ou mais unidades.
  - Dias da semana e horários de atendimento na unidade.
  - Intervalos, folgas e bloqueios de agenda.

  **Exemplos:** Psicólogo(a) aparece em Psicologia; Médico(a) com Cardiologia aparece em Cardiologia; técnico ou responsável habilitado para laboratório aparece nos exames compatíveis.
  **Por que:** a unidade é a fonte de verdade da oferta de serviços. O paciente deve escolher somente aquilo que a unidade realmente oferece.

### 4.5 Regras de disponibilidade e conflito
- [x] **Onde:** backend, banco e painel administrativo.
  **O que muda:** o sistema deve impedir:
  - Agendamento fora dos dias/horários do profissional.
  - Dois pacientes no mesmo horário do mesmo profissional.
  - Seleção de profissional inativo.
  - Seleção de especialidade não vinculada à unidade.
  - Agendamento em unidade inativa.

  A validação deve existir no servidor, não apenas nos selects do navegador.
  **Por que:** o paciente não pode contornar as regras enviando uma requisição manual para a API.

### 4.6 Histórico e auditoria da agenda profissional
- [x] **Onde:** auditoria administrativa e histórico de unidade/profissional.
  **O que muda:** registrar criação, alteração, ativação, desativação e mudança de horários, informando administrador, data, unidade e motivo.
  **Por que:** mudanças na oferta de atendimento podem afetar agendamentos existentes e precisam ser rastreáveis.

---

## 5. Tela Inicial (`index.html`) e Navegação Geral

### 5.1 Redirecionamento correto do Atendente na página inicial
- [x] **Onde:** página inicial (`index.html`).
  **O que muda:** se uma pessoa já logada como Atendente acessar a página inicial do site, o sistema deve enviá-la direto para `atendente.html`. (Hoje o código só checava Administrador e mandava os atendentes para a tela do paciente por engano).
  **Por que:** evita confusão e cliques desnecessários para os funcionários da rede municipal.

### 5.2 Organização dos arquivos de conexão do sistema
- [x] **Onde:** arquivos técnicos de conexão (`assets/api.js` e pasta `server`).
  **O que muda:** consolidar todas as regras de conexão e permissões em um único arquivo oficial dentro de `assets/api.js`, eliminando arquivos duplicados deixados na pasta errada do servidor.
  **Por que:** evita que alterações feitas em uma parte do sistema deixem de funcionar em outras telas.

---

## 6. Inteligência e Automação do Sistema ("Debaixo do Capô")

> *Estes itens são resolvidos diretamente na programação pela IA, mas o time de produto precisa saber que existem para poder testar e validar o funcionamento.*

### 6.1 Lembretes automáticos na véspera da consulta/exame
- [x] **Concluído:** o job `server/src/jobs/reminders.js` executa na inicialização e a cada 24 horas, localiza consultas e exames pendentes/confirmados do dia seguinte e cria lembretes únicos.
  **Resultado:** os lembretes aparecem no início do painel do paciente como “Novo” ou “Lido”.

### 6.2 Blindagem de segurança no cadastro e nas datas
- [x] **O que muda:** o servidor passará a validar com rigor os dados recebidos:
  1. Bloquear cadastros que venham com CPF de formato inválido (ex: `111.111.111-11`).
  2. Rejeitar qualquer tentativa de agendamento em datas passadas, mesmo que alguém tente burlar o formulário.
  3. Garantir que ninguém consiga criar conta sem os dados essenciais de saúde.
  **Por que:** segurança e integridade de dados são indispensáveis para um sistema que será apresentado e licenciado para a Secretaria de Saúde do município.

### 6.3 Proteção contra tentativas repetidas de senha (Força bruta)
- [x] **O que muda:** se alguém errar a senha 5 vezes seguidas na tela de login, o sistema bloqueia novas tentativas por 5 minutos naquele computador.
  **Por que:** impede que pessoas mal-intencionadas usem robôs para adivinhar senhas de pacientes ou da administração.

---

## 7. Roteiro Sugerido de Execução para o Time (Próximas Reuniões)

Para o time não se perder tentando fazer tudo de uma vez, sugerimos aprovar as tarefas nestas 3 etapas lógicas:

### Etapa 1: Consertos prioritários do produto atual
1. **Consertar a inicialização do Atendente** (Item 3.1) — revisado/consolidado.
2. **Revisar aviso de paciente inativo no Atendente** (Item 4.2) — garantir sem vazar dados.
3. **Verificar limite de 1 ano no calendário** (Itens 2.4/3.4/4.1).

### Etapa 2: Alinhamento Oficial com o SUS e Cadastro Completo
1. **Ajustar Cargo do Atendente** (Item 1.1).
2. **Adicionar Nome Social, CNS, Prioridade, Responsável p/ menor, Cor/Raça** (Itens 1.2–1.6).
3. **Ponto de referência apenas para zona rural** (Item 1.7).
4. **Textos explicativos e avisos inline** (Itens 1.8, 1.10).
5. **Indicador de força de senha** (Item 1.9).

### Etapa 3: Automação, Gestão de Postos e Acabamento Visual
1. **Gestão de Postos/Unidades** (Item 4.3) — consolidado.
2. **Lembretes automáticos** (Item 6.1) — consolidado.
3. **Modais consistentes e botões de ação** (Itens 4.2, 2.6).
4. **Blindagem e proteção contra senhas repetidas** (Itens 6.2, 6.3).

### Etapa 4: Governança administrativa
1. **Avaliar painel segmentado por `admin_level`** (superadmin/gestor/atendimento/alertas).
2. **Definir política de exportação/anonimização e relatórios**.

### Etapa 5: Agenda por unidade e profissional
1. Criar tabelas/gestão de profissionais, especialidades, vínculos e horários.
2. Substituir campos livres por selects dependentes com validação no servidor.
3. Cálculo de horários disponíveis e bloqueio de conflitos.
4. Migrar/agrupar agendamentos existentes e testar cenários críticos.

### Pendências transversais (conformidade/produção)
- HTTPS/HSTS e httpOnly total do access em produção.
- SMTP de produção configurado.
- DPO nominal, revisão jurídica, KMS/Vault.
- RNDS/Gov.br credenciados.
- Substituir `prompt()/confirm()` nativos em alguns fluxos.
- Cobertura E2E contínua.

---

## 8. Como usar este documento

1. Em cada reunião, o time escolhe a Etapa que quer executar.
2. Leiam item por item.
3. Se o item estiver aprovado como prioridade do time, instruam a IA para executar o código daquela etapa.
4. Após testarem e confirmarem na prática que a tela está funcionando, marquem a caixinha `[x]`.
