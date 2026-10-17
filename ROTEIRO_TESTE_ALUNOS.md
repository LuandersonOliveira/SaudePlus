# Roteiro de teste — Saúde+ (para usar em sala)

Use dados fictícios (nomes/e-mails inventados). Mesmo sendo um ambiente de
teste, é um bom hábito pegar desde já: nunca digitar dado de saúde real de
ninguém num sistema em desenvolvimento.

## 0) Checklist antes da aula começar

Três comandos, na raiz do projeto:

```bash
npm run setup     # instala as dependências, cria o banco, aplica as migrations e cria o admin
npm run doctor    # deve responder "pronto para rodar"
npm run dev       # sobe a API (:4000) e o front (:8080)
```

- [ ] `npm run doctor` respondeu **pronto para rodar**
- [ ] `http://localhost:4000/health` responde `{"ok":true}`
- [ ] `http://localhost:8080` abre a página inicial
- [ ] Você anotou o `ADMIN_EMAIL` e a `ADMIN_PASSWORD` que estão no `server/.env`

Se `npm run doctor` reclamar de `DATA_ENCRYPTION_KEY`, ele mesmo diz como gerar:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> Não use `npx serve .` nem qualquer outro servidor estático: servido a partir
> da raiz do repositório, ele exporia `server/.env` (senha do MySQL,
> `JWT_SECRET`, `DATA_ENCRYPTION_KEY`). O `npm run dev` usa
> `scripts/serve-web.js`, que só entrega as páginas e `assets/`.

## 1) Papel: aluno (usuário comum)

1. Abrir a página inicial → **Criar conta** → preencher nome, e-mail e senha fictícios.
2. Fazer login com a conta recém-criada.
3. Verificar que caiu em `dashboard.html` (não em `admin.html`).
4. Aba **Consultas** → agendar uma consulta fictícia → confirmar que aparece na lista "Minhas consultas".
5. Aba **Exames** → agendar um exame fictício → confirmar que aparece em "Meus exames".
6. Aba **Início** → confirmar que a consulta e o exame aparecem em "Próximos eventos" e que os números do topo (cards) bateram.
7. Clicar **Sair** → confirmar que volta para a tela de login.

## 2) Papel: você (admin)

1. Login com a conta admin (criada pelo `seed:admin`).
2. Confirmar que caiu direto em `admin.html`.
3. Aba **Visão geral** → confirmar que aparecem as consultas e exames **de todos os alunos que testaram**, não só os seus.
4. Aba **Histórico de consultas** → buscar pelo e-mail de um aluno específico → confirmar que aparece *só* o histórico daquele aluno.
5. Aba **Doenças** → cadastrar um alerta (ex: "Dengue", região "Centro", nível "alto") → salvar.
6. Pedir para um aluno recarregar a aba **Alertas** no painel dele → confirmar que o alerta aparece lá.

## 3) Teste de segurança (a parte que realmente importa)

Esse é o ponto que prova que "usuário só vê o que é dele" não é só uma
promessa da interface — é uma regra do servidor.

1. Com dois alunos logados em navegadores/abas diferentes: o aluno A não
   deve ver, em nenhuma tela, qualquer consulta ou exame do aluno B.
2. Pedir para um aluno (não-admin) digitar a URL `admin.html` diretamente
   na barra de endereço, estando logado → deve ser redirecionado
   automaticamente para `dashboard.html` com um aviso de "acesso restrito".
3. Abrir o DevTools (F12) → aba **Network** → refazer uma ação qualquer →
   mostrar para a turma que toda chamada à API carrega um cabeçalho
   `Authorization: Bearer ...` — é esse token que a API usa para saber
   quem está pedindo o quê, e por isso o front sozinho não basta para
   proteger nada: a regra real está no `server/src/middleware/auth.js`.
4. Deslogar (botão **Sair**) e tentar digitar `dashboard.html` direto na
   URL → deve redirecionar para `auth.html` (ninguém vê nada sem login).

## 4) Problemas comuns

| Sintoma                                                | Causa provável                                                                               |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| "Failed to fetch" no console                           | API não está rodando, ou `CORS_ORIGIN` no `.env` não bate com a porta do front — rode `npm run doctor` |
| `GET /server/.env` devolve 404                         | **Isso está certo.** O front é servido por allowlist; `server/` nunca é exposto             |
| "Muitos intentos de login"                             | Lockout por conta: 5 tentativas travam por 15 min. Espere, ou ajuste `TRUST_PROXY_HOPS` se há proxy |
| Login não pede o segundo fator                         | `migrate:interop` não rodou (o MFA desliga em silêncio). Rode `npm run db:migrate`            |
| "Token inválido ou expirado"                           | O access token expira em 15 min e o front renova sozinho; se persistir, logar de novo         |
| Erro ao instalar dependências                          | Confirme que está usando `bcryptjs` (não `bcrypt`) — já vem assim no `package.json` entregue |
| Porta 4000 ocupada                                     | Mude `PORT` no `.env` **e** `window.API_BASE` no front antes de carregar `assets/api.js`     |
| Aluno cria conta mas não consegue ver alerta de doença | Alertas só aparecem com `active = 1` — confirme no painel admin                              |

## 5) Os 5 defeitos que este roteiro comprova

São bugs que a auditoria encontrou e que foram corrigidos. Se um deles
reaparecer, a correção foi perdida — vale parar a aula e registrar.

1. **Apóstrofo no nome.** Criar um usuário chamado `Maria d'Ávila Souza`, e no
   admin clicar **Abrir histórico**. Antes, o apóstrofo quebrava o script da
   página inteira e o botão morria sem aviso.
2. **Edição parcial.** No painel do atendente, alterar **só o telefone** de um
   aluno e salvar. O cargo (`job_role`) precisa continuar igual — a edição
   parcial não pode apagar o que não está no formulário.
3. **Campos que o formulário não mostra.** No admin, salvar o perfil de um
   paciente e conferir que **tipo sanguíneo** e **prioridade** continuam
   preenchidos: são colunas que o formulário não tem.
4. **Login com MFA.** Logar com MFA ligado e **recarregar a página no meio do
   prompt**. As páginas devem redirecionar para o login, não ficar presas com a
   tela em branco (skeleton eterno).
5. **`admin_level` vazio.** Um admin sem nível definido deve receber **403** em
   rotas de administer usuários — nunca acesso total. O padrão é falhar
   fechado, não aberto.
