// Sessoes e rate limiting. Sessoes sem estado no servidor: o cookie e o
// proprio token, assinado com HMAC. Necessario em Vercel porque cada pedido
// pode cair numa instancia de funcao serverless diferente - um Map em
// memoria (como se usava antes) so e visivel na instancia que o escreveu,
// causando 401 aleatorios noutras instancias mesmo com sessao valida.

const crypto = require('crypto');
const { json, parseCookies } = require('./httpUtils');
const storage = require('./storage');

const IS_PRODUCTION = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
if (IS_PRODUCTION && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET e obrigatorio em producao. O servidor recusou arrancar com um segredo previsivel.');
}
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) console.warn('[server] SESSION_SECRET temporario gerado para desenvolvimento local. As sessoes deixam de ser validas ao reiniciar.');
const COOKIE_SECURE = IS_PRODUCTION ? '; Secure' : '';

const SESSION_COOKIE = 'bdv_admin_session';
const CUSTOMER_SESSION_COOKIE = 'bdv_customer_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const CUSTOMER_CODE_TTL_MS = 10 * 60 * 1000;

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// Hash de password com scrypt nativo do Node (sem dependencias novas) -
// salt aleatorio por password, guardado junto com o hash no mesmo campo
// ("salt:hash" em hex), como e costume quando nao ha uma coluna dedicada
// so para o salt.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  return safeEqual(candidate, hash);
}

// Guarda so o hash do codigo de login dentro do challenge assinado - nunca
// o codigo em si (ver auditoria). O challenge viaja de volta no browser
// entre o pedido e a verificacao; sendo assinado nao pode ser alterado,
// mas base64 nao e encriptacao, por isso o valor la dentro nao pode dar
// para recuperar o codigo original.
function hashLoginCode(code) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(String(code)).digest('hex');
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

// Tokens de negocio (ofertas, componentes e viagens partilhadas) podem
// conter NET, rateKeys e referencias de fornecedor. Um token HMAC apenas
// impede alteracoes: continua a ser Base64 legivel por qualquer browser.
// Para estes casos usamos AES-256-GCM, que fornece confidencialidade +
// autenticidade sem guardar estado no servidor. A chave e derivada do
// mesmo SESSION_SECRET, mas com contexto proprio para nao reutilizar a
// chave HMAC diretamente.
const SEALED_TOKEN_KEY = crypto.createHash('sha256').update(`boomviagens:sealed:v1:${SESSION_SECRET}`).digest();

function sealToken(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', SEALED_TOKEN_KEY, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${encrypted.toString('base64url')}.${tag.toString('base64url')}`;
}

function openToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const iv = Buffer.from(parts[1], 'base64url');
    const encrypted = Buffer.from(parts[2], 'base64url');
    const tag = Buffer.from(parts[3], 'base64url');
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', SEALED_TOKEN_KEY, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const payload = JSON.parse(decrypted.toString('utf8'));
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

// Identidade completa do colaborador com sessao (id/username/role) - ao
// contrario de sessionUser (so o username, usado como "actor" em todo o
// lado), esta e usada para autorizacao por perfil (ver router.js `roles`)
// e para preencher automaticamente "quem fez isto" com o staffId real.
function sessionStaff(req) {
  const payload = verifyToken(parseCookies(req)[SESSION_COOKIE]);
  if (!payload || payload.scope !== 'admin' || !payload.staffId) return null;
  return { id: payload.staffId, username: payload.user, role: payload.role || 'ADMIN' };
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${COOKIE_SECURE}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${COOKIE_SECURE}`);
}

function customerSessionEmail(req) {
  const payload = verifyToken(parseCookies(req)[CUSTOMER_SESSION_COOKIE]);
  return payload && payload.scope === 'customer' ? payload.email : null;
}

function setCustomerSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `${CUSTOMER_SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${COOKIE_SECURE}`);
}

function clearCustomerSessionCookie(res) {
  res.setHeader('Set-Cookie', `${CUSTOMER_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${COOKIE_SECURE}`);
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'local').split(',')[0].trim();
}

const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'local']);

// Em desenvolvimento local, o mesmo IP e partilhado entre uso real e
// testes automaticos (deste assistente incluido) - isso ja esgotou o
// limite varias vezes sem ter nada a ver com credenciais erradas. No
// Vercel os pedidos nunca vem de loopback (chegam via proxy com um IP
// publico real em x-forwarded-for), por isso isto nao abre nenhuma
// excecao em producao.
// Os buckets vivem no armazenamento partilhado (Supabase/SQLite via
// storage.js#incrementRateBucket) para o limite valer em todas as
// instancias serverless, nao so na que atendeu o pedido anterior; em
// desenvolvimento local (backend JSON) fica o fallback em memoria, que ai
// chega porque ha um unico processo. Passou a ser async por causa disso -
// todos os chamadores fazem `await rateLimit(...)`.
async function rateLimit(req, res, scope, limit, windowMs) {
  if (LOOPBACK_IPS.has(clientIp(req))) return null;
  const key = `${scope}:${clientIp(req)}`;
  const current = await storage.incrementRateBucket(key, windowMs);
  if (current.count > limit) {
    // Nao depender do valor de retorno de json() aqui - devolver
    // explicitamente true garante que o `if (limited) return limited;`
    // nas rotas para mesmo que json() alguma vez volte a mudar.
    json(res, 429, { ok: false, error: 'Demasiados pedidos. Tente novamente dentro de momentos.' });
    return true;
  }
  return null;
}

module.exports = {
  SESSION_TTL_MS,
  CUSTOMER_CODE_TTL_MS,
  safeEqual,
  hashPassword,
  verifyPassword,
  hashLoginCode,
  signToken,
  verifyToken,
  sealToken,
  openToken,
  sessionUser,
  sessionStaff,
  setSessionCookie,
  clearSessionCookie,
  customerSessionEmail,
  setCustomerSessionCookie,
  clearCustomerSessionCookie,
  rateLimit
};
