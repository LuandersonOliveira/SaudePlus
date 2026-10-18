#!/usr/bin/env node
/* ==========================================================================
   Saúde+ — servidor estático do front com allowlist explícita.

   Por que não `npx serve .`: a raiz do repositório contém server/.env
   (DB_PASSWORD, JWT_SECRET, DATA_ENCRYPTION_KEY), server/backups/ com dumps
   do banco e server/src/. Um servidor genérico na raiz serve tudo isso.
   Aqui só o que é página ou asset do design system sai — o resto é 404.

   Zero dependência: http + fs nativos. CORS não se aplica (mesma origem
   só com a API em outra porta; quem faz CORS é a API, via CORS_ORIGIN).

   Uso:  node scripts/serve-web.js        (porta WEB_PORT, default 8080)
   Teste: require('./serve-web').createWebServer()   (porta 0)
   ========================================================================== */
const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Allowlist de páginas. Uma entrada por linha do topo do site.
const PAGES = [
  'index.html',
  'auth.html',
  'dashboard.html',
  'admin.html',
  'atendente.html',
  'privacy.html',
];

const PAGE_SET = new Set(PAGES);

// Allowlist de extensões de asset, com Content-Type.
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function cacheControlFor(relPath) {
  // A fonte tem hash no nome do arquivo: imutável. HTML e CSS mudam a cada
  // deploy e precisam revalidar, senão o navegador serve versão velha de
  // um bug que já foi corrigido.
  if (relPath.startsWith('assets/fonts/')) return 'public, max-age=31536000, immutable';
  return 'no-cache';
}

// Decide o caminho relativo servido, ou null se não estiver na allowlist.
// Separado do request handler para ser testável sem socket.
function resolveRequest(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  // Backslash vira barra em algunos clientes HTTP; normaliza.
  decoded = decoded.replace(/\\/g, '/');

  if (decoded === '/') return 'index.html';

  const rel = decoded.replace(/^\/+/, '');
  if (!rel || rel.includes('\0')) return null;

  // Traversal: qualquer '..' é recusado antes de tocar o disco. O teste
  // final com path.resolve é a segunda barreira.
  const segments = rel.split('/');
  if (segments.some((s) => s === '..')) return null;
  if (segments.some((s) => s.startsWith('.'))) return null; // .git, .env, .superpowers

  if (PAGE_SET.has(rel)) return rel;

  if (!rel.startsWith('assets/')) return null;
  if (segments.length < 2) return null;

  const ext = path.extname(rel).toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(CONTENT_TYPES, ext)) return null;

  // assets/ tem no máximo 3 níveis (assets/fonts/x.woff2).
  if (segments.length > 3) return null;

  return rel;
}

function createWebServer() {
  return http.createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return sendJson(res, 405, { error: 'Método não permitido.' });
    }

    const urlPath = (req.url || '/').split('?')[0];

    if (urlPath === '/') {
      res.writeHead(301, { Location: '/index.html', 'Cache-Control': 'no-store' });
      return res.end();
    }

    const rel = resolveRequest(urlPath);
    if (!rel) return sendJson(res, 404, { error: 'Rota não encontrada.' });

    // Segunda barreira: mesmo que a allowlist deixasse passar algo, o
    // caminho final precisa estar dentro da raiz do repositório.
    const abs = path.resolve(ROOT, rel);
    if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) {
      return sendJson(res, 404, { error: 'Rota não encontrada.' });
    }

    let stat;
    try {
      stat = await fsp.stat(abs);
    } catch {
      return sendJson(res, 404, { error: 'Rota não encontrada.' });
    }
    if (!stat.isFile()) return sendJson(res, 404, { error: 'Rota não encontrada.' });

    const headers = {
      'Content-Type': CONTENT_TYPES[path.extname(rel).toLowerCase()],
      'Content-Length': stat.size,
      'Cache-Control': cacheControlFor(rel),
      'X-Content-Type-Options': 'nosniff',
    };

    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      return res.end();
    }

    res.writeHead(200, headers);
    const stream = fs.createReadStream(abs);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
}

if (require.main === module) {
  const port = Number(process.env.WEB_PORT) || 8080;
  const host = process.env.WEB_HOST || '127.0.0.1';
  createWebServer().listen(port, host, () => {
    console.log(`Saúde+ front em http://${host}:${port}`);
    console.log('API esperada em http://localhost:4000 — confira CORS_ORIGIN no server/.env');
  });
}

module.exports = { createWebServer, resolveRequest, ROOT, PAGES };
