// Area de cliente: registo, login por codigo de email (sem password) e
// consulta das proprias reservas.
//
// Nota: o endpoint /api/customer/register-legacy que existia aqui foi
// removido (ver auditoria) - nao passava pela validacao de src/validation.js
// e nao tinha rate limiting, era uma sobra de uma versao anterior que a
// rota /api/customer/register ja substituiu.

const crypto = require('crypto');

module.exports = function registerCustomerRoutes(router, ctx) {
  const { json, unauthorized, parseBody, readDb, updateDb, customerPayload, validateEmail, validatePassword, rateLimit, domain, cleanText, fileStorage } = ctx;
  const { ensureCollections, audit, id, now, missingDocumentsFor, DOCUMENT_TYPES, sanitizeCustomer } = domain;
  const { signToken, verifyToken, customerSessionEmail, setCustomerSessionCookie, clearCustomerSessionCookie, safeEqual, hashPassword, verifyPassword, CUSTOMER_CODE_TTL_MS, SESSION_TTL_MS } = ctx.auth;

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
    return json(res, 200, { ok: true, customer: sanitizeCustomer(customer) });
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

  // Alternativa ao codigo por email - so funciona se o cliente ja tiver
  // definido uma password (ver /api/customer/set-password). Quem nao tem
  // continua a usar o codigo normalmente.
  router.post('/api/customer/login/password', async (req, res) => {
    const limited = rateLimit(req, res, 'customer-login-password', 15, 15 * 60 * 1000);
    if (limited) return limited;
    const body = await parseBody(req);
    const customerEmail = validateEmail(body.email);
    const db = await readDb();
    const customer = (db.customers || []).find(c => c.email === customerEmail);
    if (!customer?.passwordHash || !verifyPassword(body.password, customer.passwordHash)) {
      return json(res, 401, { ok: false, error: 'Email ou password incorretos.' });
    }
    const token = signToken({ scope: 'customer', email: customerEmail, exp: Date.now() + SESSION_TTL_MS });
    setCustomerSessionCookie(res, token);
    await updateDb(d => audit(d, customerEmail, 'CUSTOMER_LOGIN_PASSWORD', {}));
    return json(res, 200, { ok: true, email: customerEmail, name: customer.name || '' });
  });

  // Exige sessao ja autenticada (por codigo ou password) - definir/mudar a
  // password nunca aceita a identidade vinda do corpo do pedido.
  router.post('/api/customer/set-password', async (req, res) => {
    const customerEmail = customerSessionEmail(req);
    if (!customerEmail) return unauthorized(res);
    const limited = rateLimit(req, res, 'customer-set-password', 10, 15 * 60 * 1000);
    if (limited) return limited;
    const body = await parseBody(req);
    const newPassword = validatePassword(body.password);
    const passwordHash = hashPassword(newPassword);
    await updateDb(db => {
      ensureCollections(db);
      let found = db.customers.find(c => c.email === customerEmail);
      if (found) { found.passwordHash = passwordHash; found.updatedAt = now(); }
      else { found = { id: id('cli'), createdAt: now(), email: customerEmail, passwordHash }; db.customers.unshift(found); }
      audit(db, customerEmail, 'CUSTOMER_PASSWORD_SET', {});
    });
    return json(res, 200, { ok: true });
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
    return json(res, 200, { ok: true, customer: sanitizeCustomer(customer), hasPassword: Boolean(customer.passwordHash) });
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
      phone2: cleanText(body.phone2, 40),
      nif: cleanText(body.nif, 20),
      address: cleanText(body.address, 200),
      postalCode: cleanText(body.postalCode, 20),
      city: cleanText(body.city, 100),
      birthdate: cleanText(body.birthdate, 30),
      travelScope: ['LAZER', 'NEGOCIOS', 'AMBOS'].includes(body.travelScope) ? body.travelScope : ''
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
    return json(res, 200, { ok: true, customer: sanitizeCustomer(customer) });
  });

  function ownReservationOrNull(db, reservationId, customerEmail) {
    const reservation = db.reservations.find(r => r.id === reservationId);
    if (!reservation || reservation.customer?.email !== customerEmail) return null;
    return reservation;
  }

  // Sem reservationId, o documento e do cliente diretamente - passaporte de
  // um membro do agregado familiar, reutilizavel em reservas futuras sem
  // ter de o anexar outra vez a cada reserva nova.
  router.get('/api/customer/documents', async (req, res, url) => {
    const customerEmail = customerSessionEmail(req);
    if (!customerEmail) return unauthorized(res);
    const reservationId = cleanText(url.searchParams.get('reservationId'), 120);
    const db = ensureCollections(await readDb());
    let documents;
    if (reservationId) {
      if (!ownReservationOrNull(db, reservationId, customerEmail)) return json(res, 404, { ok: false, error: 'Reserva não encontrada' });
      documents = db.documents.filter(d => d.reservationId === reservationId);
    } else {
      documents = db.documents.filter(d => d.customerEmail === customerEmail);
    }
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
    let folder;
    if (reservationId) {
      if (!ownReservationOrNull(db, reservationId, customerEmail)) return json(res, 404, { ok: false, error: 'Reserva não encontrada' });
      folder = reservationId;
    } else {
      folder = `cliente/${customerEmail.replace('@', '_')}`;
    }

    const buffer = Buffer.from(body.fileBase64, 'base64');
    const docId = id('doc');
    const storagePath = `${folder}/${docId}-${fileName}`;
    try {
      await fileStorage.uploadFile(storagePath, buffer, body.mimeType);
    } catch (err) {
      return json(res, 502, { ok: false, error: `Falha ao guardar documento: ${err.message}` });
    }

    const document = {
      id: docId,
      reservationId: reservationId || undefined,
      customerEmail: reservationId ? undefined : customerEmail,
      type, passengerName, fileName, storagePath, createdAt: now(), uploadedBy: customerEmail
    };
    await updateDb(d => {
      ensureCollections(d);
      d.documents.unshift(document);
      audit(d, customerEmail, 'DOCUMENT_UPLOADED', { reservationId: reservationId || null, documentId: docId });
    });
    return json(res, 200, { ok: true, document });
  });

  function ownDocumentOrNull(db, document, customerEmail) {
    if (!document) return null;
    if (document.reservationId) return ownReservationOrNull(db, document.reservationId, customerEmail) ? document : null;
    return document.customerEmail === customerEmail ? document : null;
  }

  router.post('/api/customer/documents/delete', async (req, res) => {
    const customerEmail = customerSessionEmail(req);
    if (!customerEmail) return unauthorized(res);
    const body = await parseBody(req);
    const documentId = cleanText(body.documentId, 120);
    const db = ensureCollections(await readDb());
    const document = db.documents.find(d => d.id === documentId);
    if (!ownDocumentOrNull(db, document, customerEmail)) return json(res, 404, { ok: false, error: 'Documento não encontrado' });

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
