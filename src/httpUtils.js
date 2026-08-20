// Utilitarios genericos de HTTP, sem nada especifico de nenhuma rota.

function isProduction() {
  return String(process.env.VERCEL_ENV || '').toLowerCase() === 'production' || (!process.env.VERCEL && String(process.env.NODE_ENV || '').toLowerCase() === 'production');
}

// Politica pragmatica: o frontend usa scripts/estilos inline nas paginas
// publicas e de backoffice (sem infraestrutura de nonce) e carrega tipos de
// letra do Google Fonts - uma politica mais estrita partia o site em vez de
// o proteger.
const CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://images.unsplash.com; connect-src 'self'";

function securityHeaders() {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
    'Content-Security-Policy': CONTENT_SECURITY_POLICY
  };
  if (isProduction()) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return headers;
}

// Mensagens de excecao internas (falhas de bibliotecas, erros de rede,
// respostas inesperadas de APIs externas) podem conter detalhes que nao
// devem chegar ao cliente em producao (stack traces, identificadores
// internos, mensagens de driver de base de dados). Em desenvolvimento
// mantem a mensagem real para facilitar depuracao.
function safeError(err, fallback) {
  return isProduction() ? fallback : ((err && err.message) || fallback);
}

function json(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, { ...securityHeaders(), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
  // Sem isto, json(...) devolve undefined (falsy) mesmo depois de ja ter
  // enviado a resposta - qualquer chamador que faca `if (json(...))
  // return` (ex.: rateLimit) nunca curto-circuitava, continuava a
  // executar e tentava enviar uma segunda resposta na mesma ligacao,
  // rebentando o processo inteiro com ERR_HTTP_HEADERS_SENT.
  return true;
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

// Corpo tal como chegou, sem JSON.parse - parseBody() so devolve o objeto ja
// interpretado, insuficiente para verificar assinaturas (ex.: webhook da
// Stripe) que exigem os bytes exatos que o remetente assinou.
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 12_000_000) { req.destroy(); reject(new Error('Pedido demasiado grande')); }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

module.exports = { json, unauthorized, parseCookies, parseBody, readRawBody, clientIp, securityHeaders, safeError, isProduction };
