// Area de cliente: registo, login por codigo de email (sem password) e
// consulta das proprias reservas.
//
// Nota: o endpoint /api/customer/register-legacy que existia aqui foi
// removido (ver auditoria) - nao passava pela validacao de src/validation.js
// e nao tinha rate limiting, era uma sobra de uma versao anterior que a
// rota /api/customer/register ja substituiu.

const crypto = require('crypto');

module.exports = function registerCustomerRoutes(router, ctx) {
  const { json, unauthorized, parseBody, readDb, updateDb, customerPayload, validateEmail, rateLimit, domain, cleanText, fileStorage } = ctx;
  const { ensureCollections, audit, id, now, missingDocumentsFor, DOCUMENT_TYPES } = domain;
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
    // Ver nota equivalente em adminRoutes.js: este limite e partilhado
    // por IP entre testes automaticos e uso real em desenvolvimento local.
    const limited = rateLimit(req, res, 'customer-login-request', 15, 15 * 60 * 1000);
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
    const limited = rateLimit(req, res, 'customer-login-verify', 25, 15 * 60 * 1000);
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
    if (!customerEmail) return unauthorized(res);
    const db = ensureCollections(await readDb());
    const reservations = db.reservations
      .filter(r => r.customer?.email === customerEmail)
      .map(r => ({
        ...r,
        missingDocuments: missingDocumentsFor(r, db.documents),
        payment: db.payments.find(p => p.reservationId === r.id) || null
      }));
    return json(res, 200, { ok: true, reservations });
  });

  router.get('/api/customer/profile', async (req, res) => {
    const customerEmail = customerSessionEmail(req);
    if (!customerEmail) return unauthorized(res);
    const db = ensureCollections(await readDb());
    const customer = db.customers.find(c => c.email === customerEmail) || { email: customerEmail };
    return json(res, 200, { ok: true, customer });
  });

  // A identidade vem sempre da sessao (customerEmail), nunca do corpo do
  // pedido - assim um cliente autenticado nunca consegue editar os dados
  // de outro so por enviar um email diferente no body.
  router.post('/api/customer/profile', async (req, res) => {
    const customerEmail = customerSessionEmail(req);
    if (!customerEmail) return unauthorized(res);
    const body = await parseBody(req);
    const updates = {
      name: cleanText(body.name, 120),
      phone: cleanText(body.phone, 40),
      nif: cleanText(body.nif, 20),
      address: cleanText(body.address, 200)
    };
    const customer = await updateDb(db => {
      ensureCollections(db);
      let found = db.customers.find(c => c.email === customerEmail);
      if (found) Object.assign(found, updates, { updatedAt: now() });
      else {
        found = { id: id('cli'), createdAt: now(), email: customerEmail, ...updates };
        db.customers.unshift(found);
      }
      audit(db, customerEmail, 'CUSTOMER_PROFILE_UPDATED', { customerId: found.id });
      return found;
    });
    return json(res, 200, { ok: true, customer });
  });

  function ownReservationOrNull(db, reservationId, customerEmail) {
    const reservation = db.reservations.find(r => r.id === reservationId);
    if (!reservation || reservation.customer?.email !== customerEmail) return null;
    return reservation;
  }

  router.get('/api/customer/documents', async (req, res, url) => {
    const customerEmail = customerSessionEmail(req);
    if (!customerEmail) return unauthorized(res);
    const reservationId = cleanText(url.searchParams.get('reservationId'), 120);
    const db = ensureCollections(await readDb());
    if (!ownReservationOrNull(db, reservationId, customerEmail)) return json(res, 404, { ok: false, error: 'Reserva não encontrada' });
    const documents = db.documents.filter(d => d.reservationId === reservationId);
    const withUrls = await Promise.all(documents.map(async d => ({ ...d, signedUrl: await fileStorage.signedUrl(d.storagePath) })));
    return json(res, 200, { ok: true, documents: withUrls });
  });

  router.post('/api/customer/documents/upload', async (req, res) => {
    const customerEmail = customerSessionEmail(req);
    if (!customerEmail) return unauthorized(res);
    const body = await parseBody(req);
    const reservationId = cleanText(body.reservationId, 120);
    const type = cleanText(body.type, 20);
    if (!DOCUMENT_TYPES.includes(type)) return json(res, 400, { ok: false, error: 'Tipo de documento inválido' });
    const fileName = cleanText(body.fileName, 200);
    const passengerName = body.passengerName ? cleanText(body.passengerName, 200) : undefined;
    if (!fileName || !body.fileBase64) return json(res, 400, { ok: false, error: 'Ficheiro inválido' });

    const db = ensureCollections(await readDb());
    if (!ownReservationOrNull(db, reservationId, customerEmail)) return json(res, 404, { ok: false, error: 'Reserva não encontrada' });

    const buffer = Buffer.from(body.fileBase64, 'base64');
    const docId = id('doc');
    const storagePath = `${reservationId}/${docId}-${fileName}`;
    try {
      await fileStorage.uploadFile(storagePath, buffer, body.mimeType);
    } catch (err) {
      return json(res, 502, { ok: false, error: `Falha ao guardar documento: ${err.message}` });
    }

    const document = { id: docId, reservationId, type, passengerName, fileName, storagePath, createdAt: now(), uploadedBy: customerEmail };
    await updateDb(d => {
      ensureCollections(d);
      d.documents.unshift(document);
      audit(d, customerEmail, 'DOCUMENT_UPLOADED', { reservationId, documentId: docId });
    });
    return json(res, 200, { ok: true, document });
  });

  router.post('/api/customer/documents/delete', async (req, res) => {
    const customerEmail = customerSessionEmail(req);
    if (!customerEmail) return unauthorized(res);
    const body = await parseBody(req);
    const documentId = cleanText(body.documentId, 120);
    const db = ensureCollections(await readDb());
    const document = db.documents.find(d => d.id === documentId);
    if (!document || !ownReservationOrNull(db, document.reservationId, customerEmail)) return json(res, 404, { ok: false, error: 'Documento não encontrado' });

    try {
      await fileStorage.deleteFile(document.storagePath);
    } catch (err) {
      return json(res, 502, { ok: false, error: `Falha ao remover documento: ${err.message}` });
    }

    await updateDb(d => {
      ensureCollections(d);
      d.documents = d.documents.filter(x => x.id !== documentId);
      audit(d, customerEmail, 'DOCUMENT_DELETED', { reservationId: document.reservationId, documentId });
    });
    return json(res, 200, { ok: true });
  });
};
