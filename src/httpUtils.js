// Utilitarios genericos de HTTP, sem nada especifico de nenhuma rota.

function json(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function unauthorized(res) {
  return json(res, 401, { ok: false, error: 'Autenticação necessária' });
}

function parseCookies(req) {
  return String(req.headers.cookie || '').split(';').reduce((acc, part) => {
    const idx = part.indexOf('=');
    if (idx > -1) acc[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1));
    return acc;
  }, {});
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 12_000_000) { req.destroy(); reject(new Error('Pedido demasiado grande')); }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      const type = req.headers['content-type'] || '';
      try {
        if (type.includes('application/json')) return resolve(JSON.parse(body));
        const params = new URLSearchParams(body);
        const out = {};
        for (const [k, v] of params.entries()) out[k] = v;
        resolve(out);
      } catch (e) { reject(e); }
    });
  });
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'local').split(',')[0].trim();
}

module.exports = { json, unauthorized, parseCookies, parseBody, clientIp };
