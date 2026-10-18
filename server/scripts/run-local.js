/* ==========================================================================
   Sobe a API em modo LOCAL, liberando a gravação de documentos em texto puro.

   O fail-closed da crypto (utils/crypto.js) é o padrão: sem
   DATA_ENCRYPTION_KEY, o app RECUSA subir. Quem está só rodando localmente
   não tem a chave — e sem uma forma de liberar, o `npm run dev` de um clone
   novo simplesmente não funcionaria.

   Por que uma variável dedicada em vez de NODE_ENV=production: a versão
   anterior só falhava com NODE_ENV=production, e NADA no projeto definia
   essa variável. Um fail-closed que depende de alguém lembrar de exportar
   outra coisa não é fail-closed — é um aviso que ninguém vê.

   Este arquivo é a forma explícita de dizer "eu sei o que estou fazendo".
   `npm start:api` (produção) NÃO define nada e portanto continua fechado.
   ========================================================================== */
process.env.ALLOW_PLAINTEXT_DEV = '1';

// Importa e chama subir(): o guard `require.main === module` em server.js
// impede o auto-start quando o arquivo é carregado por outro.
const { subir } = require('../src/server.js');

subir().catch((err) => {
  console.error(`Não foi possível subir: ${err.message}`);
  process.exit(1);
});