// Sessoes e rate limiting. Sessoes sem estado no servidor: o cookie e o
// proprio token, assinado com HMAC. Necessario em Vercel porque cada pedido
// pode cair numa instancia de funcao serverless diferente - um Map em
// memoria (como se usava antes) so e visivel na instancia que o escreveu,
// causando 401 aleatorios noutras instancias mesmo com sessao valida.

const crypto = require('crypto');
const { json, parseCookies } = require('./httpUtils');

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update(`${process.env.ADMIN_PASSWORD || 'admin123'}::boomviagens-session-fallback`).digest('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('[server] SESSION_SECRET nao definido no .env - a usar um valor derivado de ADMIN_PASSWORD. Defina SESSION_SECRET (valor aleatorio) para maior seguranca em producao.');
}

const SESSION_COOKIE = 'bdv_admin_session';
const CUSTOMER_SESSION_COOKIE = 'bdv_customer_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const CUSTOMER_CODE_TTL_MS = 10 * 60 * 1000;

// Nota (ver auditoria): em memoria, nao sobrevive a multiplas instancias
// serverless - o mesmo problema que as sessoes ja tiveram e foram
// corrigidas para HMAC sem estado. Aceitavel como "melhor esforco" por
// agora; para ficar correto em Vercel precisa de um backend partilhado
// (ex.: uma tabela no Supabase/SQLite com TTL).
const rateBuckets = new Map();

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  if (!safeEqual(sig, expectedSig)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function sessionUser(req) {
  const payload = verifyToken(parseCookies(req)[SESSION_COOKIE]);
  return payload && payload.scope === 'admin' ? payload.user : null;
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function customerSessionEmail(req) {
  const payload = verifyToken(parseCookies(req)[CUSTOMER_SESSION_COOKIE]);
  return payload && payload.scope === 'customer' ? payload.email : null;
}

function setCustomerSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `${CUSTOMER_SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
}

function clearCustomerSessionCookie(res) {
  res.setHeader('Set-Cookie', `${CUSTOMER_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'local').split(',')[0].trim();
}

function rateLimit(req, res, scope, limit, windowMs) {
  const key = `${scope}:${clientIp(req)}`;
  const current = rateBuckets.get(key) || { count: 0, resetAt: Date.now() + windowMs };
  if (current.resetAt < Date.now()) {
    current.count = 0;
    current.resetAt = Date.now() + windowMs;
  }
  current.count += 1;
  rateBuckets.set(key, current);
  if (current.count > limit) {
    return json(res, 429, { ok: false, error: 'Demasiados pedidos. Tente novamente dentro de momentos.' });
  }
  return null;
}

module.exports = {
  SESSION_TTL_MS,
  CUSTOMER_CODE_TTL_MS,
  safeEqual,
  signToken,
  verifyToken,
  sessionUser,
  setSessionCookie,
  clearSessionCookie,
  customerSessionEmail,
  setCustomerSessionCookie,
  clearCustomerSessionCookie,
  rateLimit
};
