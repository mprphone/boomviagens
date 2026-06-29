require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readDb, updateDb } = require('./src/storage');
const { baseOffers, searchOffers, getOfferById } = require('./src/mockOperators');
const { proposalEmail, reservationEmail, loginCodeEmail } = require('./src/emailTemplates');
const { OperatorRegistry, TourDiezAdapter } = require('./src/operatorAdapters');
const { cleanText, searchPayload, customerPayload, paymentMethod, numberInRange, email: validateEmail } = require('./src/validation');
const fileStorage = require('./src/fileStorage');

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update(`${process.env.ADMIN_PASSWORD || 'admin123'}::boomviagens-session-fallback`).digest('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('[server] SESSION_SECRET nao definido no .env - a usar um valor derivado de ADMIN_PASSWORD. Defina SESSION_SECRET (valor aleatorio) para maior seguranca em producao.');
}

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, 'public');
const tourdiezAdapter = new TourDiezAdapter(process.env);
const operators = new OperatorRegistry([tourdiezAdapter]);
const SESSION_COOKIE = 'bdv_admin_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const rateBuckets = new Map();
const CUSTOMER_SESSION_COOKIE = 'bdv_customer_session';
const CUSTOMER_CODE_TTL_MS = 10 * 60 * 1000;
const RESERVATION_STATUSES = ['NEW_LEAD', 'PROPOSAL_SENT', 'PENDING_PAYMENT', 'PAYMENT_RECEIVED', 'IN_VALIDATION', 'HUMAN_REVIEW', 'CONFIRMED', 'CANCELLED', 'OPERATOR_ERROR'];
const LEAD_STAGES = ['NOVA', 'EM_CONSULTA', 'FECHADA', 'PERDIDA'];
const DOCUMENT_TYPES = ['PASSPORT', 'INSURANCE', 'OTHER'];

function id(prefix) {
  return `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function now() { return new Date().toISOString(); }

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

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// Sessoes sem estado no servidor: o cookie e o proprio token, assinado com
// HMAC. Necessario em Vercel porque cada pedido pode cair numa instancia de
// funcao serverless diferente - um Map em memoria (como se usava antes) so
// e visivel na instancia que o escreveu, causando 401 aleatorios noutras
// instancias mesmo com sessao valida.
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

function ensureCollections(db) {
  db.customers ||= [];
  db.leads ||= [];
  db.reservations ||= [];
  db.payments ||= [];
  db.emails ||= [];
  db.operatorLogs ||= [];
  db.auditLogs ||= [];
  db.idempotencyKeys ||= {};
  db.documents ||= [];
  return db;
}

function missingDocumentsFor(reservation, documents) {
  const docs = documents.filter(d => d.reservationId === reservation.id);
  const missing = [];
  const passengers = reservation.passengers?.length ? reservation.passengers : [{ name: reservation.customer?.name || 'Titular' }];
  for (const passenger of passengers) {
    const passengerName = passenger.name || 'Titular';
    const hasPassport = docs.some(d => d.type === 'PASSPORT' && d.passengerName === passengerName);
    if (!hasPassport) missing.push(`Passaporte/cartao de cidadao de ${passengerName}`);
  }
  const hasInsurance = docs.some(d => d.type === 'INSURANCE');
  if (!hasInsurance) missing.push('Seguro de viagem');
  return missing;
}

function audit(db, actor, action, payload = {}) {
  ensureCollections(db).auditLogs.unshift({ id: id('audit'), createdAt: now(), actor, action, payload });
  db.auditLogs = db.auditLogs.slice(0, 200);
}

function statusLabel(status) {
  return ({
    NEW_LEAD: 'Nova lead',
    PROPOSAL_SENT: 'Proposta enviada',
    PENDING_PAYMENT: 'Em pagamento',
    PAYMENT_RECEIVED: 'Pagamento recebido',
    IN_VALIDATION: 'Em validacao',
    CONFIRMED: 'Confirmada',
    CANCELLED: 'Cancelada',
    OPERATOR_ERROR: 'Erro no operador',
    HUMAN_REVIEW: 'Pendente de intervencao humana'
  })[status] || status;
}

function leadStageLabel(stage) {
  return ({ NOVA: 'Nova', EM_CONSULTA: 'Em consulta', FECHADA: 'Fechada', PERDIDA: 'Perdida' })[stage] || 'Nova';
}

function leadStage(lead) {
  return LEAD_STAGES.includes(lead.status) ? lead.status : 'NOVA';
}

const offerImages = {
  'tdz-puj-001': 'https://images.unsplash.com/photo-1510414842594-a61c69b5ae57?auto=format&fit=crop&w=900&q=80',
  'sol-puj-002': 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=80',
  'w2m-rm-003': 'https://images.unsplash.com/photo-1512813195386-6cf811ad3542?auto=format&fit=crop&w=900&q=80',
  'tdz-cv-004': 'https://images.unsplash.com/photo-1540202404-a2f29016b523?auto=format&fit=crop&w=900&q=80',
  'tdz-mal-005': 'https://images.unsplash.com/photo-1573843981267-be1999ff37cd?auto=format&fit=crop&w=900&q=80',
  'eur-dis-006': 'https://images.unsplash.com/photo-1499856871958-5b9627545d1a?auto=format&fit=crop&w=900&q=80',
  'mad-007': 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80'
};

function publicDeals(db) {
  return baseOffers.map((offer, index) => {
    const priced = getOfferById(offer.id, db.margins) || offer;
    return {
      id: offer.id,
      title: offer.destination,
      subtitle: offer.country,
      hotel: offer.hotel,
      board: offer.board,
      nights: offer.nights,
      origin: index % 2 ? 'Porto' : 'Lisboa',
      price: priced.finalPrice || offer.base,
      operator: offer.operator,
      image: offerImages[offer.id],
      tag: index < 3 ? 'Last call' : 'Novidade'
    };
  }).sort((a, b) => a.price - b.price);
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

function serveStatic(req, res) {
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  let filePath = path.normalize(path.join(PUBLIC, parsed.pathname === '/' ? 'index.html' : parsed.pathname));
  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(filePath).toLowerCase();
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function addOperatorLog(db, type, payload) {
  db.operatorLogs.unshift({ id: id('log'), createdAt: now(), type, payload });
  db.operatorLogs = db.operatorLogs.slice(0, 100);
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method;

  try {
    if (method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, { ok: true, service: 'Boomviagens', time: now(), mode: process.env.TOURDIEZ_MODE || 'mock' });
    }

    if (method === 'GET' && url.pathname === '/api/config') {
      const db = await readDb();
      return json(res, 200, { company: db.company, margins: db.margins, paymentsMode: process.env.PAYMENTS_MODE || 'mock', operators: operators.list(), tourdiezConfigured: operators.list().some(o => o.name === 'TourDiez' && o.configured) });
    }

    if (method === 'GET' && url.pathname === '/api/deals') {
      const db = await readDb();
      return json(res, 200, { ok: true, deals: publicDeals(db) });
    }

    if (method === 'GET' && url.pathname === '/api/admin/session') {
      const user = sessionUser(req);
      return json(res, 200, { ok: true, authenticated: Boolean(user), user });
    }

    if (method === 'POST' && url.pathname === '/api/admin/login') {
      const limited = rateLimit(req, res, 'admin-login', 10, 15 * 60 * 1000);
      if (limited) return limited;
      const body = await parseBody(req);
      const expectedUser = process.env.ADMIN_USERNAME || 'admin';
      const expectedPassword = process.env.ADMIN_PASSWORD || 'admin123';
      if (!safeEqual(body.username, expectedUser) || !safeEqual(body.password, expectedPassword)) {
        return json(res, 401, { ok: false, error: 'Credenciais inválidas' });
      }
      const token = signToken({ scope: 'admin', user: expectedUser, exp: Date.now() + SESSION_TTL_MS });
      setSessionCookie(res, token);
      return json(res, 200, { ok: true, user: expectedUser });
    }

    if (method === 'POST' && url.pathname === '/api/admin/logout') {
      clearSessionCookie(res);
      return json(res, 200, { ok: true });
    }

    if (url.pathname.startsWith('/api/admin/') && !sessionUser(req)) return unauthorized(res);

    if (method === 'GET' && url.pathname === '/api/admin/dashboard') {
      const db = ensureCollections(await readDb());
      const totalReservations = db.reservations.length;
      const confirmed = db.reservations.filter(r => r.status === 'CONFIRMED').length;
      const revenue = db.reservations.filter(r => r.status === 'CONFIRMED').reduce((sum, r) => sum + (r.offer?.finalPrice || 0), 0);
      const margin = db.reservations.filter(r => r.status === 'CONFIRMED').reduce((sum, r) => sum + (r.offer?.marginValue || 0), 0);
      return json(res, 200, {
        company: db.company,
        stats: { leads: db.leads.length, customers: db.customers.length, reservations: totalReservations, confirmed, revenue, margin },
        latest: { leads: db.leads.slice(0, 10), reservations: db.reservations.slice(0, 10), payments: db.payments.slice(0, 10), emails: db.emails.slice(0, 10), logs: db.operatorLogs.slice(0, 10), audit: db.auditLogs.slice(0, 10) },
        margins: db.margins,
        operators: operators.list(),
        statuses: RESERVATION_STATUSES.map(value => ({ value, label: statusLabel(value) }))
      });
    }

    if (method === 'GET' && url.pathname === '/api/admin/margins') return json(res, 200, { margins: (await readDb()).margins });

    if (method === 'POST' && url.pathname === '/api/admin/margins') {
      const body = await parseBody(req);
      const saved = await updateDb(db => {
        ensureCollections(db);
        const margin = {
          id: cleanText(body.id || id('margin'), 80),
          name: cleanText(body.name || 'Nova margem', 120),
          match: cleanText(body.match || '*', 500),
          percent: numberInRange(body.percent, 'Percentagem', 0, 80, 7),
          min: numberInRange(body.min, 'Margem minima', 0, 10000, 50),
          roundTo: numberInRange(body.roundTo, 'Arredondamento', 1, 1000, 5),
          active: body.active !== false
        };
        const idx = db.margins.findIndex(m => m.id === margin.id);
        if (idx >= 0) db.margins[idx] = margin; else db.margins.unshift(margin);
        audit(db, sessionUser(req), 'MARGIN_UPSERT', { marginId: margin.id });
        return margin;
      });
      return json(res, 200, { ok: true, margin: saved });
    }

    if (method === 'POST' && url.pathname === '/api/search') {
      const limited = rateLimit(req, res, 'search', 60, 60 * 1000);
      if (limited) return limited;
      const body = searchPayload(await parseBody(req));
      const db = await readDb();
      const { parsed, results } = searchOffers(body, db.margins);
      const lead = { id: id('lead'), createdAt: now(), search: { ...parsed, name: body.name, email: body.email }, source: body.source || 'site', status: 'PROPOSAL_SENT', topResult: results[0] };
      const email = proposalEmail({ customer: { name: body.name || 'Cliente' }, results, search: parsed });
      await updateDb(d => {
        ensureCollections(d);
        d.leads.unshift(lead);
        d.emails.unshift({ id: id('email'), createdAt: now(), to: body.email || 'cliente@exemplo.pt', status: 'GERADO_DEMO', ...email });
        audit(d, 'site', 'SEARCH_CREATED', { leadId: lead.id, destination: parsed.destination });
      });
      return json(res, 200, { ok: true, parsed, results, leadId: lead.id, message: 'Pesquisa feita, proposta gerada e lead criado.' });
    }

    if (method === 'POST' && url.pathname === '/api/customer/register') {
      const body = customerPayload(await parseBody(req));
      const customer = await updateDb(db => {
        ensureCollections(db);
        let found = db.customers.find(c => c.email === body.email);
        if (found) Object.assign(found, body, { updatedAt: now() });
        else {
          found = { id: id('cli'), createdAt: now(), ...body };
          db.customers.unshift(found);
        }
        audit(db, 'site', 'CUSTOMER_REGISTERED', { customerId: found.id });
        return found;
      });
      return json(res, 200, { ok: true, customer });
    }

    if (method === 'POST' && url.pathname === '/api/customer/register-legacy') {
      const body = await parseBody(req);
      if (!body.email) return json(res, 400, { ok: false, error: 'Email obrigatório' });
      const customer = await updateDb(db => {
        let found = db.customers.find(c => c.email === body.email);
        if (found) Object.assign(found, body, { updatedAt: now() });
        else {
          found = { id: id('cli'), createdAt: now(), name: body.name || '', email: body.email, phone: body.phone || '', passengers: body.passengers || [] };
          db.customers.unshift(found);
        }
        return found;
      });
      return json(res, 200, { ok: true, customer });
    }

    if (method === 'GET' && url.pathname === '/api/customer/session') {
      const customerEmail = customerSessionEmail(req);
      return json(res, 200, { ok: true, authenticated: Boolean(customerEmail), email: customerEmail });
    }

    if (method === 'POST' && url.pathname === '/api/customer/login/request') {
      const limited = rateLimit(req, res, 'customer-login-request', 5, 15 * 60 * 1000);
      if (limited) return limited;
      const body = await parseBody(req);
      const customerEmail = validateEmail(body.email);
      const code = crypto.randomInt(100000, 999999).toString();
      const challenge = signToken({ scope: 'customer-code', email: customerEmail, code, exp: Date.now() + CUSTOMER_CODE_TTL_MS });
      const mail = loginCodeEmail({ email: customerEmail, code });
      await updateDb(d => {
        ensureCollections(d);
        d.emails.unshift({ id: id('email'), createdAt: now(), to: customerEmail, status: 'GERADO_DEMO', ...mail });
        audit(d, customerEmail, 'CUSTOMER_LOGIN_CODE_REQUESTED', {});
      });
      return json(res, 200, { ok: true, message: 'Codigo gerado. Em produção seria enviado por email.', demoCode: code, challenge });
    }

    if (method === 'POST' && url.pathname === '/api/customer/login/verify') {
      const limited = rateLimit(req, res, 'customer-login-verify', 10, 15 * 60 * 1000);
      if (limited) return limited;
      const body = await parseBody(req);
      const customerEmail = validateEmail(body.email);
      const pending = verifyToken(body.challenge);
      if (!pending || pending.scope !== 'customer-code' || pending.email !== customerEmail || !safeEqual(String(body.code || ''), String(pending.code || ''))) {
        return json(res, 401, { ok: false, error: 'Codigo invalido ou expirado' });
      }
      const token = signToken({ scope: 'customer', email: customerEmail, exp: Date.now() + SESSION_TTL_MS });
      setCustomerSessionCookie(res, token);
      const db = await readDb();
      const customer = (db.customers || []).find(c => c.email === customerEmail) || null;
      await updateDb(d => audit(d, customerEmail, 'CUSTOMER_LOGIN', {}));
      return json(res, 200, { ok: true, email: customerEmail, name: customer?.name || '' });
    }

    if (method === 'POST' && url.pathname === '/api/customer/logout') {
      clearCustomerSessionCookie(res);
      return json(res, 200, { ok: true });
    }

    if (method === 'GET' && url.pathname === '/api/customer/reservations') {
      const customerEmail = customerSessionEmail(req);
      if (!customerEmail) return unauthorized(res);
      const db = ensureCollections(await readDb());
      const reservations = db.reservations.filter(r => r.customer?.email === customerEmail);
      return json(res, 200, { ok: true, reservations });
    }

    if (method === 'POST' && url.pathname === '/api/checkout') {
      const limited = rateLimit(req, res, 'checkout', 30, 60 * 1000);
      if (limited) return limited;
      const body = await parseBody(req);
      const db = ensureCollections(await readDb());
      const idemKey = cleanText(req.headers['idempotency-key'] || body.idempotencyKey || '', 160);
      if (idemKey && db.idempotencyKeys[idemKey]) {
        const existingReservation = db.reservations.find(r => r.id === db.idempotencyKeys[idemKey].reservationId);
        const existingPayment = db.payments.find(p => p.id === db.idempotencyKeys[idemKey].paymentId);
        if (existingReservation && existingPayment) return json(res, 200, { ok: true, reservation: existingReservation, payment: existingPayment, idempotent: true });
      }

      let offer = body.offer || getOfferById(body.offerId, db.margins);
      if (!offer) return json(res, 404, { ok: false, error: 'Oferta nao encontrada' });
      const customer = customerPayload(body.customer || { name: body.name || 'Cliente Teste', email: body.email || 'cliente@exemplo.pt', phone: body.phone || '' });
      const passengers = Array.isArray(body.passengers) && body.passengers.length ? body.passengers : customer.passengers;
      const reservation = {
        id: id('res'),
        createdAt: now(),
        status: 'PENDING_PAYMENT',
        customer,
        passengers,
        offer,
        operator: offer.operator,
        source: 'site',
        notes: 'Reserva criada em modo semi-automatico. Confirmacao no operador exige aprovacao do backoffice.'
      };
      const payment = {
        id: id('pay'),
        createdAt: now(),
        reservationId: reservation.id,
        method: paymentMethod(body.paymentMethod),
        amount: offer.finalPrice,
        status: 'PENDING',
        reference: crypto.randomInt(100000000, 999999999).toString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString()
      };
      await updateDb(d => {
        ensureCollections(d);
        d.reservations.unshift(reservation);
        d.payments.unshift(payment);
        let existing = d.customers.find(c => c.email === customer.email);
        if (!existing && customer.email) d.customers.unshift({ id: id('cli'), createdAt: now(), ...customer });
        if (idemKey) d.idempotencyKeys[idemKey] = { reservationId: reservation.id, paymentId: payment.id, createdAt: now() };
        audit(d, 'site', 'CHECKOUT_CREATED', { reservationId: reservation.id, paymentId: payment.id, idempotencyKey: idemKey || null });
      });
      return json(res, 200, { ok: true, reservation, payment, next: 'Chamar /api/payment/confirm para simular pagamento. A confirmacao no operador fica pendente de aprovacao no backoffice.' });
    }

    if (method === 'POST' && url.pathname === '/api/checkout-legacy') {
      const body = await parseBody(req);
      const db = await readDb();
      let offer = body.offer || getOfferById(body.offerId, db.margins);
      if (!offer) return json(res, 404, { ok: false, error: 'Oferta não encontrada' });
      const customer = body.customer || { name: body.name || 'Cliente Teste', email: body.email || 'cliente@exemplo.pt', phone: body.phone || '' };
      const reservation = {
        id: id('res'), createdAt: now(), status: 'PENDING_PAYMENT', customer, offer,
        operator: offer.operator, source: 'site', notes: 'Reserva criada pelo fluxo automático de teste.'
      };
      const payment = {
        id: id('pay'), createdAt: now(), reservationId: reservation.id, method: body.paymentMethod || 'MB WAY', amount: offer.finalPrice,
        status: 'PENDING', reference: crypto.randomInt(100000000, 999999999).toString(), expiresAt: new Date(Date.now() + 86400000).toISOString()
      };
      await updateDb(d => {
        d.reservations.unshift(reservation);
        d.payments.unshift(payment);
        let existing = d.customers.find(c => c.email === customer.email);
        if (!existing && customer.email) d.customers.unshift({ id: id('cli'), createdAt: now(), ...customer });
      });
      return json(res, 200, { ok: true, reservation, payment, next: 'Chamar /api/payment/confirm para simular pagamento e confirmar operador.' });
    }

    if (method === 'POST' && url.pathname === '/api/payment/confirm') {
      const limited = rateLimit(req, res, 'payment-confirm', 40, 60 * 1000);
      if (limited) return limited;
      const body = await parseBody(req);
      let resultPayload = null;
      const db = ensureCollections(await readDb());
      const payment = db.payments.find(p => p.id === body.paymentId || p.reservationId === body.reservationId);
      if (!payment) return json(res, 404, { ok: false, error: 'Pagamento nao encontrado' });
      const reservation = db.reservations.find(r => r.id === payment.reservationId);
      if (!reservation) return json(res, 404, { ok: false, error: 'Reserva nao encontrada' });

      const adapter = operators.getForOffer(reservation.offer);
      const validation = await adapter.value({ offer: reservation.offer, reservation });

      await updateDb(d => {
        ensureCollections(d);
        const p = d.payments.find(x => x.id === payment.id);
        if (p.status !== 'PAID') {
          p.status = 'PAID';
          p.paidAt = now();
        }
        const r = d.reservations.find(x => x.id === reservation.id);
        r.status = validation.priceStillValid && validation.availabilityStillValid ? 'IN_VALIDATION' : 'HUMAN_REVIEW';
        r.paymentReceivedAt = p.paidAt;
        r.operatorValidation = validation.raw?.mock ? 'MOCK_VALUE_OK' : 'VALUE_SENT';
        r.operatorValidationAt = now();
        const email = reservationEmail({ reservation: r, payment: p });
        d.emails.unshift({ id: id('email'), createdAt: now(), to: r.customer?.email || 'cliente@exemplo.pt', status: 'GERADO_DEMO', ...email });
        addOperatorLog(d, 'VALUE', validation);
        audit(d, 'system', 'PAYMENT_CONFIRMED_PENDING_OPERATOR', { reservationId: r.id, paymentId: p.id, status: r.status });
        resultPayload = { payment: p, reservation: r, validation, next: 'Aguardando aprovacao do backoffice para confirmar no operador.' };
      });
      return json(res, 200, { ok: true, ...resultPayload });
    }

    if (method === 'POST' && url.pathname === '/api/payment/confirm-legacy') {
      const body = await parseBody(req);
      let resultPayload = null;
      await updateDb(asyncDb => asyncDb);
      const db = await readDb();
      const payment = db.payments.find(p => p.id === body.paymentId || p.reservationId === body.reservationId);
      if (!payment) return json(res, 404, { ok: false, error: 'Pagamento não encontrado' });
      const reservation = db.reservations.find(r => r.id === payment.reservationId);
      if (!reservation) return json(res, 404, { ok: false, error: 'Reserva não encontrada' });

      const validation = await tourdiez.value({ optionID: reservation.offer.id, rateKey: reservation.offer.id });
      const confirmation = await tourdiez.confirm({ optionID: reservation.offer.id, agencyReference: reservation.id, holder: reservation.customer?.name, passengers: [{ name: reservation.customer?.name || 'Cliente' }] });

      await updateDb(d => {
        const p = d.payments.find(x => x.id === payment.id);
        p.status = 'PAID'; p.paidAt = now();
        const r = d.reservations.find(x => x.id === reservation.id);
        r.status = 'CONFIRMED'; r.confirmedAt = now(); r.operatorLocator = `BDV-${crypto.randomInt(100000, 999999)}`;
        r.operatorValidation = validation.mock ? 'MOCK_VALUE_OK' : 'REAL_VALUE_SENT';
        r.operatorConfirmation = confirmation.mock ? 'MOCK_CONFIRM_OK' : 'REAL_CONFIRM_SENT';
        const email = reservationEmail({ reservation: r, payment: p });
        d.emails.unshift({ id: id('email'), createdAt: now(), to: r.customer?.email || 'cliente@exemplo.pt', status: 'GERADO_DEMO', ...email });
        addOperatorLog(d, 'VALUE', validation);
        addOperatorLog(d, 'CONFIRM', confirmation);
        resultPayload = { payment: p, reservation: r, validation, confirmation };
      });
      return json(res, 200, { ok: true, ...resultPayload });
    }

    if (method === 'POST' && url.pathname === '/api/admin/reservations/approve') {
      const body = await parseBody(req);
      const reservationId = cleanText(body.reservationId, 120);
      const db = ensureCollections(await readDb());
      const reservation = db.reservations.find(r => r.id === reservationId);
      if (!reservation) return json(res, 404, { ok: false, error: 'Reserva nao encontrada' });
      const payment = db.payments.find(p => p.reservationId === reservation.id);
      if (!payment || payment.status !== 'PAID') return json(res, 409, { ok: false, error: 'A reserva ainda nao tem pagamento confirmado' });
      if (reservation.status === 'CONFIRMED') return json(res, 200, { ok: true, reservation, payment, alreadyConfirmed: true });

      const adapter = operators.getForOffer(reservation.offer);
      const confirmation = await adapter.confirm({ reservation, payment });
      let resultPayload = null;

      await updateDb(d => {
        ensureCollections(d);
        const r = d.reservations.find(x => x.id === reservation.id);
        const p = d.payments.find(x => x.id === payment.id);
        r.status = 'CONFIRMED';
        r.confirmedAt = now();
        r.operatorLocator = confirmation.locator;
        r.operatorConfirmation = confirmation.raw?.mock ? 'MOCK_CONFIRM_OK' : 'CONFIRM_SENT';
        const email = reservationEmail({ reservation: r, payment: p });
        d.emails.unshift({ id: id('email'), createdAt: now(), to: r.customer?.email || 'cliente@exemplo.pt', status: 'GERADO_DEMO', ...email });
        addOperatorLog(d, 'CONFIRM', confirmation);
        audit(d, sessionUser(req), 'RESERVATION_APPROVED', { reservationId: r.id, operatorLocator: r.operatorLocator });
        resultPayload = { reservation: r, payment: p, confirmation };
      });
      return json(res, 200, { ok: true, ...resultPayload });
    }

    if (method === 'GET' && url.pathname === '/api/admin/reservations') {
      const db = ensureCollections(await readDb());
      const reservations = db.reservations.map(r => ({ ...r, missingDocuments: missingDocumentsFor(r, db.documents) }));
      return json(res, 200, { ok: true, reservations });
    }

    if (method === 'POST' && url.pathname === '/api/admin/reservations/update') {
      const body = await parseBody(req);
      const reservationId = cleanText(body.reservationId, 120);
      const status = cleanText(body.status, 40);
      if (!RESERVATION_STATUSES.includes(status)) return json(res, 400, { ok: false, error: 'Estado invalido' });
      const db = ensureCollections(await readDb());
      const reservation = db.reservations.find(r => r.id === reservationId);
      if (!reservation) return json(res, 404, { ok: false, error: 'Reserva nao encontrada' });
      let resultPayload = null;

      await updateDb(d => {
        ensureCollections(d);
        const r = d.reservations.find(x => x.id === reservationId);
        const previousStatus = r.status;
        r.status = status;
        r.updatedAt = now();
        if (body.notes !== undefined) r.notes = cleanText(body.notes, 1000);
        if (status === 'CONFIRMED' && !r.confirmedAt) r.confirmedAt = now();
        const p = d.payments.find(x => x.reservationId === r.id);
        const email = reservationEmail({ reservation: r, payment: p });
        d.emails.unshift({ id: id('email'), createdAt: now(), to: r.customer?.email || 'cliente@exemplo.pt', status: 'GERADO_DEMO', ...email });
        audit(d, sessionUser(req), 'RESERVATION_STATUS_UPDATED', { reservationId: r.id, from: previousStatus, to: status });
        resultPayload = { reservation: r };
      });
      return json(res, 200, { ok: true, ...resultPayload });
    }

    if (method === 'POST' && url.pathname === '/api/admin/documents/upload') {
      const body = await parseBody(req);
      const reservationId = cleanText(body.reservationId, 120);
      const type = cleanText(body.type, 20);
      if (!DOCUMENT_TYPES.includes(type)) return json(res, 400, { ok: false, error: 'Tipo de documento invalido' });
      const fileName = cleanText(body.fileName, 200);
      const passengerName = body.passengerName ? cleanText(body.passengerName, 200) : undefined;
      if (!fileName || !body.fileBase64) return json(res, 400, { ok: false, error: 'Ficheiro invalido' });

      const db = ensureCollections(await readDb());
      const reservation = db.reservations.find(r => r.id === reservationId);
      if (!reservation) return json(res, 404, { ok: false, error: 'Reserva nao encontrada' });

      const buffer = Buffer.from(body.fileBase64, 'base64');
      const docId = id('doc');
      const storagePath = `${reservationId}/${docId}-${fileName}`;
      try {
        await fileStorage.uploadFile(storagePath, buffer, body.mimeType);
      } catch (err) {
        return json(res, 502, { ok: false, error: `Falha ao guardar documento: ${err.message}` });
      }

      const document = { id: docId, createdAt: now(), reservationId, type, passengerName, fileName, storagePath, uploadedBy: sessionUser(req) };
      await updateDb(d => {
        ensureCollections(d);
        d.documents.unshift(document);
        audit(d, sessionUser(req), 'DOCUMENT_UPLOADED', { reservationId, documentId: docId, type });
      });
      return json(res, 200, { ok: true, document });
    }

    if (method === 'GET' && url.pathname === '/api/admin/documents') {
      const reservationId = cleanText(url.searchParams.get('reservationId'), 120);
      const db = ensureCollections(await readDb());
      const documents = db.documents.filter(d => d.reservationId === reservationId);
      const withUrls = await Promise.all(documents.map(async d => ({ ...d, signedUrl: await fileStorage.signedUrl(d.storagePath) })));
      return json(res, 200, { ok: true, documents: withUrls });
    }

    if (method === 'POST' && url.pathname === '/api/admin/documents/delete') {
      const body = await parseBody(req);
      const documentId = cleanText(body.documentId, 120);
      const db = ensureCollections(await readDb());
      const document = db.documents.find(d => d.id === documentId);
      if (!document) return json(res, 404, { ok: false, error: 'Documento nao encontrado' });

      try {
        await fileStorage.deleteFile(document.storagePath);
      } catch (err) {
        return json(res, 502, { ok: false, error: `Falha ao remover documento: ${err.message}` });
      }

      await updateDb(d => {
        ensureCollections(d);
        d.documents = d.documents.filter(x => x.id !== documentId);
        audit(d, sessionUser(req), 'DOCUMENT_DELETED', { reservationId: document.reservationId, documentId });
      });
      return json(res, 200, { ok: true });
    }

    if (method === 'GET' && url.pathname === '/api/admin/customers') {
      const db = ensureCollections(await readDb());
      const customers = db.customers.map(c => ({
        ...c,
        leadsCount: db.leads.filter(l => l.search?.email === c.email).length,
        reservationsCount: db.reservations.filter(r => r.customer?.email === c.email).length
      }));
      return json(res, 200, { ok: true, customers });
    }

    if (method === 'GET' && url.pathname === '/api/admin/customers/detail') {
      const customerEmail = cleanText(url.searchParams.get('email'), 254);
      const db = ensureCollections(await readDb());
      const customer = db.customers.find(c => c.email === customerEmail);
      if (!customer) return json(res, 404, { ok: false, error: 'Cliente nao encontrado' });
      const leads = db.leads.filter(l => l.search?.email === customerEmail);
      const reservations = db.reservations.filter(r => r.customer?.email === customerEmail);
      return json(res, 200, { ok: true, customer, leads, reservations });
    }

    if (method === 'POST' && url.pathname === '/api/admin/customers/notes') {
      const body = await parseBody(req);
      const customerEmail = cleanText(body.email, 254);
      const notes = cleanText(body.notes, 2000);
      const saved = await updateDb(d => {
        ensureCollections(d);
        const customer = d.customers.find(c => c.email === customerEmail);
        if (!customer) return null;
        customer.notes = notes;
        customer.updatedAt = now();
        audit(d, sessionUser(req), 'CUSTOMER_NOTES_UPDATED', { email: customerEmail });
        return customer;
      });
      if (!saved) return json(res, 404, { ok: false, error: 'Cliente nao encontrado' });
      return json(res, 200, { ok: true, customer: saved });
    }

    if (method === 'GET' && url.pathname === '/api/admin/leads') {
      const db = ensureCollections(await readDb());
      const leads = db.leads.map(l => ({ ...l, stage: leadStage(l) }));
      return json(res, 200, { ok: true, leads, leadStages: LEAD_STAGES.map(value => ({ value, label: leadStageLabel(value) })) });
    }

    if (method === 'POST' && url.pathname === '/api/admin/leads/update') {
      const body = await parseBody(req);
      const leadId = cleanText(body.leadId, 120);
      const stage = cleanText(body.status, 40);
      if (!LEAD_STAGES.includes(stage)) return json(res, 400, { ok: false, error: 'Estagio invalido' });
      const saved = await updateDb(d => {
        ensureCollections(d);
        const lead = d.leads.find(l => l.id === leadId);
        if (!lead) return null;
        const previousStatus = lead.status;
        lead.status = stage;
        lead.updatedAt = now();
        audit(d, sessionUser(req), 'LEAD_STAGE_UPDATED', { leadId: lead.id, from: previousStatus, to: stage });
        return lead;
      });
      if (!saved) return json(res, 404, { ok: false, error: 'Lead nao encontrado' });
      return json(res, 200, { ok: true, lead: saved });
    }

    if (method === 'POST' && url.pathname === '/api/chat') {
      const limited = rateLimit(req, res, 'chat', 60, 60 * 1000);
      if (limited) return limited;
      const body = await parseBody(req);
      const msg = String(body.message || '').toLowerCase();
      let answer = 'Posso ajudar a encontrar férias por destino, orçamento, datas e nº de passageiros. Exemplo: “7 noites em Punta Cana em agosto, tudo incluído, até 2500€”.';
      if (msg.includes('pag')) answer = 'Aceitamos, em modo de teste, MB WAY, referência Multibanco e cartão. Em produção deve ligar a SIBS, Easypay ou Stripe.';
      if (msg.includes('cancel')) answer = 'Antes da confirmação final mostramos as condições de cancelamento do operador. Na API TourDiez existe fluxo de cancelamento/simulação.';
      if (msg.includes('rn') || msg.includes('rnavt')) answer = 'O rodapé e os termos já estão preparados para indicar o RNAVT da About Destiny / Boomviagens. Deve inserir o número final na configuração.';
      if (msg.includes('cara') || msg.includes('punta') || msg.includes('caribe')) answer = 'Para Caraíbas, recomendo começar por Punta Cana ou Riviera Maya. O motor compara preço, regime, avaliação, cancelamento e margem.';
      return json(res, 200, { ok: true, answer, handoff: /humano|operador|urgente|problema/.test(msg) });
    }

    if (method === 'POST' && url.pathname === '/api/admin/operator/tourdiez/test') {
      const body = await parseBody(req);
      const login = await tourdiezAdapter.client.login();
      const avail = await tourdiezAdapter.search(body || { destination: 'Punta Cana', nights: 7, adults: 2 });
      await updateDb(db => { addOperatorLog(db, 'TEST_LOGIN', login); addOperatorLog(db, 'TEST_AVAIL', avail); });
      return json(res, 200, { ok: true, configured: tourdiezAdapter.isConfigured(), login, availability: avail });
    }

    return json(res, 404, { ok: false, error: 'Endpoint não encontrado' });
  } catch (e) {
    return json(res, 500, { ok: false, error: e.message, stack: process.env.NODE_ENV === 'development' ? e.stack : undefined });
  }
}

function appHandler(req, res) {
  if (req.url.startsWith('/api/')) return handleApi(req, res);
  return serveStatic(req, res);
}

if (require.main === module) {
  const server = http.createServer(appHandler);
  server.listen(PORT, () => {
    console.log(`Boomviagens operacional em http://localhost:${PORT}`);
    console.log(`Modo TourDiez: ${process.env.TOURDIEZ_MODE || 'mock'}`);
  });
}

module.exports = { appHandler, handleApi };
