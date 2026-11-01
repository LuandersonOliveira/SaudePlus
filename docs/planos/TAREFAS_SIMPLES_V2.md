# Saúde+ — Lista de Ajustes Pendentes (fácil de entender)

> **Substituído por [`TAREFAS_SIMPLES_V3.md`](./TAREFAS_SIMPLES_V3.md).** Esta versão
> fica só como registro histórico do pedido original — o status atual de cada item
> (o que foi feito, o que ficou pela metade, o que ainda falta) está na V3, com o
> "Painel Rápido de Status (V2 → V3)". Não edite este arquivo; edite a V3.

> **Para quem é este documento:** para o time do projeto — vocês não precisam saber programar para entender e decidir sobre estas tarefas. Cada item explica **onde** fica (qual tela, qual campo), **o que muda** e **por que muda**. A parte de programar quem faz é a IA; a parte de decidir "faz sentido ou não" é do time.
>
> Marque a caixinha `[x]` quando o time decidir que aquele item está aprovado e pronto (ou concluído).

---

## Como ler este documento

Cada tarefa segue este formato:

> **Onde:** em qual tela / formulário isso aparece
> **O que muda:** como é hoje → como vai ficar
> **Por que:** o problema que isso resolve

Nada aqui fala de código, banco de dados ou termos técnicos. Se aparecer uma palavra estranha, é porque é o nome oficial de um documento do governo (tipo "CNS") — isso é explicado na hora.

---

## 1. Tela de Cadastro (`auth.html`)

### 1.1 Cargo do atendente

- [ ] **Onde:** tela de cadastro, quando a pessoa se cadastra como **atendente**, campo "Cargo / Função".
  **O que muda:** hoje é um campo de texto livre (a pessoa digita qualquer coisa: "Enfermeira", "enfermeiro", "Enferm.", "ENFERMEIRA(O)"). Vai virar uma lista de opções fixas para escolher: **Recepcionista, Enfermeiro(a), Médico(a), Motorista, Auxiliar Administrativo, Outro**. Se escolher "Outro", aparece um campo para digitar qual.
  **Por que:** hoje o mesmo cargo vira 4 ou 5 palavras diferentes no sistema, o que impede contar "quantos enfermeiros temos" de forma certa.

### 1.2 Nome social

- [ ] **Onde:** tela de cadastro, junto do campo "Nome completo".
  **O que muda:** adicionar um novo campo opcional "Nome social", explicando que é o nome pelo qual a pessoa prefere ser chamada (diferente do nome de documento).
  **Por que:** é uma exigência oficial do sistema de saúde do governo — toda pessoa tem direito de ser chamada pelo nome social, não só pelo nome de registro.

### 1.3 Cartão Nacional de Saúde (CNS)

- [ ] **Onde:** tela de cadastro, junto dos campos CPF/RG.
  **O que muda:** adicionar um novo campo opcional "Cartão Nacional de Saúde (CNS)", com aviso de que é o número que aparece no cartão do SUS, e que quem não tiver em mãos pode deixar em branco.
  **Por que:** é o número que qualquer posto de saúde ou hospital usa de verdade para identificar o paciente — sem ele, o app fica "desconectado" do jeito que o SUS realmente funciona.

### 1.4 Prioridade de atendimento

- [ ] **Onde:** tela de cadastro (ou perfil do paciente).
  **O que muda:** adicionar uma pergunta simples: a pessoa se enquadra em alguma prioridade legal de atendimento? Opções: **Idoso (60+), Gestante, Pessoa com deficiência, Lactante, Nenhuma**. Se a pessoa tiver 60 anos ou mais (calculado pela data de nascimento), a opção "Idoso" já vem marcada sozinha.
  **Por que:** por lei, essas pessoas têm prioridade na fila de atendimento. Hoje o sistema atende todo mundo na mesma ordem, sem considerar isso.

### 1.5 Nome do responsável (para menor de idade)

- [ ] **Onde:** tela de cadastro — só aparece se a data de nascimento mostrar que a pessoa é menor de 18 anos.
  **O que muda:** adicionar campo "Nome do responsável/acompanhante", que só aparece quando o paciente é menor de idade.
  **Por que:** criança/adolescente não se cadastra sozinho na vida real — precisa constar quem é o responsável.

### 1.6 Cor/raça

- [ ] **Onde:** tela de cadastro, junto dos dados pessoais.
  **O que muda:** adicionar campo opcional "Cor/raça" como lista de opções (a pessoa escolhe como se autodeclara): **Branca, Preta, Parda, Amarela, Indígena, Prefiro não informar**.
  **Por que:** é um campo padrão em qualquer cadastro de saúde pública no Brasil, usado para entender se o atendimento está sendo igual para todo mundo.

### 1.7 Ponto de referência obrigatório para todo mundo

- [ ] **Onde:** tela de cadastro, passo de endereço, campo "Ponto de referência".
  **O que muda:** hoje esse campo é obrigatório para **todo mundo**. Vai passar a ser obrigatório só para quem mora em **zona rural** — quem mora em zona urbana e já preencheu CEP, rua e número completos não precisa mais preencher.
  **Por que:** ponto de referência só faz sentido de verdade pra quem mora onde o endereço "oficial" (CEP) não é suficiente para achar a casa. Pra quem já deu endereço completo, é uma pergunta a mais sem necessidade.

### 1.8 Explicar por que cada dado é pedido

- [ ] **Onde:** tela de cadastro, nos campos CPF, RG, e nos novos campos (CNS, cor/raça).
  **O que muda:** adicionar um textinho curto embaixo de cada campo sensível explicando por que aquele dado é pedido (ex.: "Pedimos seu CPF para identificar você de forma única no sistema de saúde").
  **Por que:** hoje a pessoa preenche dado pessoal sensível sem saber por que está sendo pedido — isso deixa qualquer pessoa desconfiada, e é direito da pessoa saber.

---

## 2. Tela do Paciente (`dashboard.html`)

### 2.1 Campo "Outro" no tipo de exame

- [ ] **Onde:** formulário de agendar exame, campo "Tipo de exame".
  **O que muda:** hoje tem as opções Ambulância, Van/Kombi, Carro comum, Cadeirante e Outro — mas quando a pessoa escolhe "Outro", não aparece nenhum campo para escrever qual é. Vai passar a aparecer um campo de texto pra explicar quando escolher "Outro".
  **Por que:** hoje, se a pessoa escolhe "Outro", essa informação simplesmente se perde — ninguém sabe depois o que era.

### 2.2 Campo "Outro" no tipo de exame

- [ ] **Onde:** formulário de agendar exame, campo "Tipo de exame".
  **O que muda:** mesmo problema e mesma solução do item 2.1, mas para exames.
  **Por que:** mesmo motivo — informação que se perde quando a pessoa escolhe "Outro".

### 2.3 Confirmação de cancelamento mais clara

- [ ] **Onde:** botão de cancelar consulta ou exame, na tela do paciente.
  **O que muda:** hoje aparece uma caixinha de confirmação simples e feia do próprio navegador ("Tem certeza?"). Vai virar uma janela bonita do próprio app, explicando a consequência (ex.: "Se você cancelar, pode não haver outra vaga disponível tão cedo").
  **Por que:** cancelar uma consulta é uma decisão importante — a pessoa merece entender a consequência antes de confirmar, não só um "sim/não" seco.

### 2.4 Botão de agendar trava enquanto envia

- [ ] **Onde:** botões de "Agendar consulta" e "Agendar exame".
  **O que muda:** enquanto o pedido está sendo enviado, o botão trava e mostra "Enviando..." — hoje não trava, então se a pessoa clicar duas vezes ou a internet estiver lenta, pode enviar o pedido duas vezes sem querer.
  **Por que:** evita pedido duplicado por engano, principalmente em internet mais lenta (o público do app é bastante de zona rural).

### 2.5 Botão "Cancelar" ao preencher formulário

- [ ] **Onde:** formulários de agendar consulta e exame.
  **O que muda:** adicionar um botão "Cancelar" que limpa o formulário, para quem começou a preencher e desistiu no meio.
  **Por que:** hoje só existe "Cancelar edição" (que só aparece quando a pessoa está editando algo já existente) — quem está criando algo novo não tem um jeito claro de desistir e limpar tudo.

---

## 3. Tela do Administrador (`admin.html`)

### 3.1 Região do alerta de doença

- [ ] **Onde:** formulário "Cadastrar doença/alerta", campo "Região".
  **O que muda:** hoje é um campo de texto livre (a pessoa digita "Centro", "centro", "Zona Centro"...). Vai virar uma lista de bairros já usada em outras partes do sistema (a mesma lista dos postos de saúde), pra ficar tudo igual.
  **Por que:** mesmo problema do cargo do atendente (item 1.1) — texto livre faz a mesma região virar várias "regiões" diferentes no sistema, quebrando os alertas de doença por área.

### 3.2 Reagendar sem digitar data na mão

- [ ] **Onde:** botão de reagendar consulta/exame, na tela do administrador.
  **O que muda:** hoje aparece uma caixinha pedindo pra digitar a nova data manualmente, num formato específico (fácil de errar). Vai virar um seletor de data e hora de verdade (calendário clicável), igual ao que já é usado nos outros formulários do app.
  **Por que:** digitar data à mão é fácil de errar (ex.: escrever no formato brasileiro em vez do formato que o sistema espera) — um calendário clicável não deixa isso acontecer.

### 3.3 Motivo ao mudar status de uma conta

- [ ] **Onde:** tela de administrador, ao ativar/inativar a conta de um usuário.
  **O que muda:** adicionar um campo opcional de "Observação" explicando o motivo da mudança (ex.: "solicitação do próprio paciente", "cadastro duplicado").
  **Por que:** hoje muda o status sem registrar o porquê — se alguém perguntar depois "por que essa conta foi desativada?", ninguém tem resposta guardada.

### 3.4 Unificar as duas telas de busca

- [ ] **Onde:** abas "Histórico" e "Usuários" na tela do administrador.
  **O que muda:** juntar as duas em uma única tela de busca, já que fazem praticamente a mesma coisa hoje (uma busca por nome/e-mail, outra só por e-mail exato).
  **Por que:** ter duas telas parecidas fazendo quase a mesma coisa confunde quem usa e dá mais trabalho de manter.

---

## 4. Tela do Atendente (`atendente.html`)

### 4.1 Reagendar sem digitar data na mão

- [ ] **Onde:** botão de reagendar, na tela do atendente.
  **O que muda:** mesma mudança do item 3.2 (calendário clicável em vez de digitar a data).
  **Por que:** mesmo motivo — hoje esse mesmo problema aparece repetido em duas telas diferentes (admin e atendente).

### 4.2 Avisar quando paciente existe mas está inativo

- [ ] **Onde:** busca de paciente, na tela do atendente.
  **O que muda:** hoje, se o atendente busca um paciente que está com conta inativa ou pendente, a busca simplesmente não mostra nada — como se a pessoa nunca tivesse se cadastrado. Vai passar a avisar "esse paciente existe, mas a conta está inativa/pendente" (sem mostrar dado sensível).
  **Por que:** sem esse aviso, o atendente pode achar que a pessoa nunca se cadastrou e criar um cadastro novo e duplicado.

### 4.3 Cargo do atendente aparece certo no cabeçalho

- [ ] **Onde:** topo da tela do atendente, onde aparece o nome e cargo de quem está logado.
  **O que muda:** consequência direta do item 1.1 — quando o cargo virar uma lista fixa de opções (em vez de texto livre), o cabeçalho vai mostrar sempre o cargo escrito do jeito certo.
  **Por que:** hoje, como o cargo é digitado livre, pode aparecer errado ou com letra maiúscula/minúscula misturada bem na saudação que todo atendente vê ao entrar.

---

## 5. Ajustes gerais de visual e navegação (todas as telas)

### 5.1 Navegar pelas abas com o teclado

- [ ] **Onde:** abas internas do dashboard, admin e atendente (ex.: "Consultas" e "Exames").
  **O que muda:** hoje só dá pra trocar de aba clicando com o mouse. Vai passar a dar pra trocar usando as setas do teclado (esquerda/direita) quando uma aba estiver selecionada.
  **Por que:** ajuda quem usa o computador só pelo teclado ou usa leitor de tela (acessibilidade).

### 5.2 Aviso de erro mais claro nos formulários

- [ ] **Onde:** campos obrigatórios do formulário de cadastro.
  **O que muda:** hoje, quando falta preencher um campo obrigatório, só aparece um aviso genérico. Vai passar a mostrar um aviso bem ao lado do campo que está faltando, explicando exatamente o que falta ali.
  **Por que:** a pessoa que está preenchendo precisa saber exatamente qual campo corrigir, não só "algo está errado".

### 5.3 Indicador de senha fraca/forte

- [ ] **Onde:** campo de senha, na tela de cadastro.
  **O que muda:** adicionar um indicador visual (tipo uma barrinha colorida) mostrando se a senha digitada é fraca, média ou forte.
  **Por que:** hoje qualquer senha com 6 letras passa, mesmo sendo bem fraca (tipo "123456") — o app guarda dado de saúde, então vale incentivar senha melhor.

### 5.4 Limite de data no calendário

- [ ] **Onde:** todos os campos de escolher data e hora (agendar consulta e exame).
  **O que muda:** hoje só existe um limite de "não pode marcar no passado" — vai ganhar também um limite de "não pode marcar muito longe no futuro" (por exemplo, mais de 1 ano).
  **Por que:** evita erro de digitação de data (tipo digitar o ano errado sem perceber) que hoje passa sem nenhum aviso.

### 5.5 Destacar quando está editando algo

- [ ] **Onde:** qualquer formulário de edição (editar consulta ou exame).
  **O que muda:** quando a pessoa clica em "Editar" um item, o formulário já pula a tela até lá, mas hoje não fica visualmente destacado que "isso aqui é o modo de edição". Vai ganhar um destaque visual (tipo uma borda colorida) enquanto estiver editando.
  **Por que:** em telas compridas, é fácil esquecer que está editando algo específico e se perder.

---

## 6. O que NÃO está nesta lista (de propósito)

Este documento é só sobre **mudanças de campo, formulário e tela** — coisas que o time consegue olhar, testar e dizer "sim, isso melhora" ou "não, prefiro do outro jeito".

Ficaram de fora, porque são só a parte de "arrumar o motor por baixo do capô" (trabalho técnico que a IA resolve, sem decisão de produto necessária): segurança de senha e login, testes automáticos, backup, colocar o site no ar de verdade, entre outros. Essas tarefas continuam existindo — só não fazem parte desta lista porque não exigem que vocês entendam de programação para decidir sobre elas.

---

## 7. Como usar este documento nas reuniões do time

1. Leiam um item por vez.
2. Perguntem: "isso faz sentido pro nosso usuário (paciente/atendente/admin)?"
3. Se sim, marquem `[x]` como aprovado e passem pra próxima etapa (a IA implementa).
4. Se não, escrevam do lado por que não, e como vocês prefeririam que fosse.
