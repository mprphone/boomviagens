// Area de cliente: registo, login por codigo de email (sem password) e
// consulta das proprias reservas.
//
// Nota: o endpoint /api/customer/register-legacy que existia aqui foi
// removido (ver auditoria) - nao passava pela validacao de src/validation.js
// e nao tinha rate limiting, era uma sobra de uma versao anterior que a
// rota /api/customer/register ja substituiu.

const crypto = require('crypto');

module.exports = function registerCustomerRoutes(router, ctx) {
  const { json, parseBody, readDb, updateDb, customerPayload, validateEmail, rateLimit, domain } = ctx;
  const { ensureCollections, audit, id, now } = domain;
  const { signToken, verifyToken, customerSessionEmail, setCustomerSessionCookie, clearCustomerSessionCookie, safeEqual, CUSTOMER_CODE_TTL_MS, SESSION_TTL_MS } = ctx.auth;

  router.post('/api/customer/register', async (req, res) => {
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
  });

  router.get('/api/customer/session', async (req, res) => {
    const customerEmail = customerSessionEmail(req);
    return json(res, 200, { ok: true, authenticated: Boolean(customerEmail), email: customerEmail });
  });

  router.post('/api/customer/login/request', async (req, res) => {
    const limited = rateLimit(req, res, 'customer-login-request', 5, 15 * 60 * 1000);
    if (limited) return limited;
    const { loginCodeEmail } = ctx;
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
  });

  router.post('/api/customer/login/verify', async (req, res) => {
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
  });

  router.post('/api/customer/logout', async (req, res) => {
    clearCustomerSessionCookie(res);
    return json(res, 200, { ok: true });
  });

  router.get('/api/customer/reservations', async (req, res) => {
    const customerEmail = customerSessionEmail(req);
    if (!customerEmail) return json(res, 401, { ok: false, error: 'Autenticação necessária' });
    const db = ensureCollections(await readDb());
    const reservations = db.reservations.filter(r => r.customer?.email === customerEmail);
    return json(res, 200, { ok: true, reservations });
  });
};
