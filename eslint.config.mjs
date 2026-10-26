import js from '@eslint/js';

/**
 * ESLint — primeira passada, deliberadamente estreita.
 *
 * A tentação aqui é ligar `eslint:recommended` e corrigir o que aparecer. Isso
 * seria um erro de leitura do problema: o portão de qualidade deste projeto
 * já existe e é `npm test`, com 317 asserções sobre o comportamento real.
 * O lint entra para pegar o que a suíte não pega —_variable não usada_,
 * _sintaxe quebrada_, _API de Promise usada errado_ — e não para reescrever
 * código que já tem uma decisão por trás.
 *
 * Por isso o conjunto é `js.configs.recommended` (que só aponta erros reais)
 * mais três regras que pegam erro de digitação silencioso neste projeto. Se
 * um dia alguém ligar `no-unused-vars` para os argumentos de callback não
 * usados, vai encontrar centenas de falsos positivos: nos handlers de rota o
 * próximo erro é o terceiro parâmetro e quase ninguém usa `next`.
 */
export default [
  {
    ignores: [
      'node_modules/**',
      'server/node_modules/**',
      'test-results/**',
      'playwright-report/**',
      'server/backups/**',
      // `marked` vendorizado: o próprio arquivo avisa "DO NOT EDIT THIS
      // FILE / generated from files in ./src/". Não é código nosso — seguir
      // o estilo dele não diz nada sobre o nosso.
      'server/scripts/temp_marked.js',
    ],
  },

  js.configs.recommended,

  // O front é script de página e o servidor é CommonJS: os dois rodam no
  // navegador/Node sem `type: module`. Ajustei `sourceType` por cima em vez
  // de reescrever os arquivos.
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        // Node (servidor, scripts, testes)
        require: 'readonly', module: 'writable', exports: 'writable',
        process: 'readonly', __dirname: 'readonly', __filename: 'readonly',
        Buffer: 'readonly', console: 'readonly', setTimeout: 'readonly',
        clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
        setImmediate: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
        TextEncoder: 'readonly', TextDecoder: 'readonly', fetch: 'readonly',
        structuredClone: 'readonly',
        //describe/test dos arquivos node:test
        describe: 'readonly', it: 'readonly', before: 'readonly', after: 'readonly',
        beforeEach: 'readonly', afterEach: 'readonly',
      },
    },
    rules: {
      // Erro de digitação que passa pelo teste: variável declarada e nunca
      // lida é sempre bug ou código morto.
      'no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],

      // `== null` cobre null e undefined de propósito; `!=` idem. Mas
      // `==` com outro tipo é bug de conversão.
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      // Uma variável de ambiente lida sem tratamento é o caminho mais curto
      // para um `undefined` silencioso em produção.
      'no-eval': 'error',
      'no-implied-eval': 'error',

      // Promessa sem await/catch e sem retorno é erro perdido.
      'no-async-promise-executor': 'error',

      // Duplicata acidental de require é código inútil.
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-duplicate-case': 'error',

      // Número inválido é bug silencioso (NaN se propaga).
      'no-self-compare': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',

      // `delete` em array/parametro é quase sempre erro.
      'no-delete-var': 'error',

      // Bloco vazio esconde forgot de volta.
      'no-empty': ['error', { allowEmptyCatch: true }],

      // Dependência de prototype é porta de porta aberta.
      'no-proto': 'error',
      'no-script-url': 'error',
    },
  },

  // O front (HTML inline + assets) roda no navegador.
  {
    files: ['assets/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        window: 'readonly', document: 'readonly', location: 'readonly',
        history: 'readonly', localStorage: 'readonly', sessionStorage: 'readonly',
        fetch: 'readonly', navigator: 'readonly', alert: 'readonly',
        confirm: 'readonly', prompt: 'readonly', FormData: 'readonly',
        URL: 'readonly', URLSearchParams: 'readonly', Promise: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', console: 'readonly',
        File: 'readonly', Blob: 'readonly', Headers: 'readonly',

        // `assets/api.js` publica a API em `window.*` e chama os nomes
        // sem o prefixo dentro do próprio arquivo. No navegador isso
        // resolve pelo objeto global; o ESLint não enxerga. Declarar aqui é
        // dizer a verdade sobre o padrão, não silenciar um problema.
        getSession: 'readonly',
      },
    },
  },

  // Config e testes E2E: ESM rodando em Node.
  {
    files: ['e2e/**/*.js', 'scripts/**/*.js', '*.config.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        process: 'readonly', console: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly',
        URL: 'readonly', URLSearchParams: 'readonly', Buffer: 'readonly',
        fetch: 'readonly', expect: 'readonly', test: 'readonly',
        describe: 'readonly', beforeAll: 'readonly', afterAll: 'readonly',
        device: 'readonly',
        // Só existem dentro de page.evaluate(), que roda no navegador. Não
        // são globais do Node — declarar aqui é dizer a verdade sobre o
        // padrão, no mesmo espírito do getSession em assets/.
        document: 'readonly', window: 'readonly', getComputedStyle: 'readonly',
        location: 'readonly',
      },
    },
  },

  // Testes: `test`/`describe` são globais do runner.
  {
    files: ['server/test/**/*.js', 'e2e/**/*.spec.js'],
    languageOptions: {
      globals: {
        test: 'readonly', describe: 'readonly', it: 'readonly',
        expect: 'readonly', beforeAll: 'readonly', beforeEach: 'readonly',
        afterAll: 'readonly', afterEach: 'readonly',
      },
    },
  },
];