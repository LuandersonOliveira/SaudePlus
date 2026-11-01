/* ==========================================================================
   Saúde+ — entrega do front React (web/dist) pelo próprio Express.

   Em produção há UMA origem: o Express serve o build do Vite e a API sob
   `/api` (o cliente já usa `/api` como base). Sem CORS, sem segundo servidor.

   Quando liga (SERVE_WEB):
     - `1`  liga (se não houver build, avisa e segue só com a API);
     - `0`  desliga;
     - vazio: liga só com NODE_ENV=production E build presente.
   Desligado, a API continua nas rotas da raiz (/auth, /admin, ...) que o front
   legado e o `npm run dev:legacy` esperam. Ligado, a raiz é do React — /auth e
   /admin são páginas dele — e a API vive só em /api.
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const express = require('express');

function distDir() {
  return process.env.WEB_DIST
    ? path.resolve(process.env.WEB_DIST)
    : path.resolve(__dirname, '..', '..', 'web', 'dist');
}

function webEnabled() {
  const flag = String(process.env.SERVE_WEB || '').trim();
  if (flag === '0') return false;
  const built = fs.existsSync(path.join(distDir(), 'index.html'));
  if (flag === '1') {
    if (!built) console.warn(`SERVE_WEB=1, mas ${distDir()} não tem index.html (rode "npm run build:web"). Servindo só a API.`);
    return built;
  }
  return process.env.NODE_ENV === 'production' && built;
}

/**
 * CSP do helmet para o React. O padrão do helmet já cobre script/style/font/img próprios;
 * só falta liberar o ViaCEP (o formulário de cadastro consulta o CEP direto do navegador).
 * `upgrade-insecure-requests` só em produção (atrás de TLS): em http://localhost quebraria os assets.
 */
function cspDirectives() {
  const directives = { 'connect-src': ["'self'", 'https://viacep.com.br'] };
  if (process.env.NODE_ENV !== 'production') directives['upgrade-insecure-requests'] = null;
  return directives;
}

/** Arquivos com hash no nome (assets/) cacheiam para sempre; o index.html nunca. */
function mountWeb(app) {
  const dist = distDir();
  app.use(
    express.static(dist, {
      index: false,
      setHeaders(res, file) {
        const isAsset = path.relative(dist, file).split(path.sep)[0] === 'assets';
        res.setHeader('Cache-Control', isAsset ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    })
  );
  // Rota do React (sem extensão, fora de /api): devolve o index.html e o roteador do cliente decide.
  // Arquivo que não existe (ex.: /assets/velho.js) continua 404 em vez de virar HTML.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path === '/api' || req.path.startsWith('/api/')) return next();
    if (path.extname(req.path)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(path.join(dist, 'index.html'));
  });
}

module.exports = { webEnabled, mountWeb, cspDirectives, distDir };
