// Serve os ficheiros de public/ tal como estao - sem build step nem
// bundler. Uma so responsabilidade: mapear pathname -> ficheiro em disco.

const fs = require('fs');
const path = require('path');

function createStaticServer(publicDir) {
  return function serveStatic(req, res) {
    const parsed = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsed.pathname.endsWith('/') ? `${parsed.pathname}index.html` : parsed.pathname;
    const filePath = path.normalize(path.join(publicDir, pathname));
    if (!filePath.startsWith(publicDir)) { res.writeHead(403); return res.end('Forbidden'); }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        if (String(req.headers.accept || '').includes('text/html')) {
          return fs.readFile(path.join(publicDir, '404.html'), (err404, page) => {
            if (err404) { res.writeHead(404); return res.end('Not found'); }
            res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(page);
          });
        }
        res.writeHead(404); return res.end('Not found');
      }
      const ext = path.extname(filePath).toLowerCase();
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
      // Sem isto o browser pode servir HTML/JS/CSS antigos do cache sem
      // pedir nada ao servidor - ja causou confusao real (pagina a
      // mostrar uma seccao que ja tinha sido removida do codigo).
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  };
}

module.exports = { createStaticServer };
