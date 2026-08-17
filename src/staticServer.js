// Serve os ficheiros de public/ tal como estao - sem build step nem
// bundler. Uma so responsabilidade: mapear pathname -> ficheiro em disco.

const fs = require('fs');
const path = require('path');
const { securityHeaders } = require('./httpUtils');

function safeStaticPath(publicDir, urlPathname) {
  let decoded;
  try { decoded = decodeURIComponent(String(urlPathname || '/')); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const pathname = decoded.endsWith('/') ? `${decoded}index.html` : decoded;
  // O ponto inicial força o pathname a ser relativo à raiz pública mesmo
  // quando começa por '/'. A verificação por path.relative evita o erro
  // clássico de usar startsWith('/.../public'), que também aceitaria um
  // irmão chamado '/.../public-secret'.
  const root = path.resolve(publicDir);
  const candidate = path.resolve(root, `.${pathname}`);
  const relative = path.relative(root, candidate);
  if (!relative || relative === '.') return path.join(root, 'index.html');
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return candidate;
}

function createStaticServer(publicDir) {
  return function serveStatic(req, res) {
    if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
      res.writeHead(405, { ...securityHeaders(), Allow: 'GET, HEAD', 'Cache-Control': 'no-store' });
      return res.end('Method Not Allowed');
    }
    // Só precisamos do pathname; não usar Host como base evita que um
    // cabeçalho Host malformado lance exceção fora do router de API.
    let parsed;
    try { parsed = new URL(req.url || '/', 'http://localhost'); }
    catch { res.writeHead(400, securityHeaders()); return res.end('Bad Request'); }
    const filePath = safeStaticPath(publicDir, parsed.pathname);
    if (!filePath) { res.writeHead(403, securityHeaders()); return res.end('Forbidden'); }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        if (String(req.headers.accept || '').includes('text/html')) {
          return fs.readFile(path.join(publicDir, '404.html'), (err404, page) => {
            if (err404) { res.writeHead(404, securityHeaders()); return res.end('Not found'); }
            res.writeHead(404, { ...securityHeaders(), 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            if (req.method === 'HEAD') return res.end();
            res.end(page);
          });
        }
        res.writeHead(404, securityHeaders()); return res.end('Not found');
      }
      const ext = path.extname(filePath).toLowerCase();
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json; charset=utf-8' };
      res.writeHead(200, { ...securityHeaders(), 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      if (req.method === 'HEAD') return res.end();
      res.end(data);
    });
  };
}

module.exports = { createStaticServer, safeStaticPath };
