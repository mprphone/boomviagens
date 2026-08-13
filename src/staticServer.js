// Serve os ficheiros de public/ tal como estao - sem build step nem
// bundler. Uma so responsabilidade: mapear pathname -> ficheiro em disco.

const fs = require('fs');
const path = require('path');

function createStaticServer(publicDir) {
  return function serveStatic(req, res) {
    const parsed = new URL(req.url, `http://${req.headers.host}`);
    const filePath = path.normalize(path.join(publicDir, parsed.pathname === '/' ? 'index.html' : parsed.pathname));
    if (!filePath.startsWith(publicDir)) { res.writeHead(403); return res.end('Forbidden'); }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      const ext = path.extname(filePath).toLowerCase();
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
      res.end(data);
    });
  };
}

module.exports = { createStaticServer };
