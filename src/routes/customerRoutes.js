// Area de cliente: registo, login por codigo de email (sem password) e
// consulta das proprias reservas.
//
// Nota: o endpoint /api/customer/register-legacy que existia aqui foi
// removido (ver auditoria) - nao passava pela validacao de src/validation.js
// e nao tinha rate limiting, era uma sobra de uma versao anterior que a
// rota /api/customer/register ja substituiu.

const crypto = require('crypto');
const { isProductionDeployment } = require('../runtimeConfig');

module.exports = function registerCustomerRoutes(router, ctx) {
  const { json, unauthorized, parseBody, readDb, updateDb, customerPayload, validateEmail, validatePassword, rateLimit, domain, cleanText, fileStorage, mailer, operators, offerRevalidation, offerTokens } = ctx;
  const { ensureCollections, audit, id, now, missingDocumentsFor, DOCUMENT_TYPES, sanitizeCustomer, customerReservationView, customerReservationDetailView, isCustomerVisibleDocument } = domain;
  const { signToken, verifyToken, customerSessionEmail, setCustomerSessionCookie, clearCustomerSessionCookie, safeEqual, hashPassword, verifyPassword, hashLoginCode, CUSTOMER_CODE_TTL_MS, SESSION_TTL_MS } = ctx.auth;

  // So cria clientes novos. Quem ja existe so pode ser alterado por quem
  // tem sessao autenticada como esse email (ver auditoria) - antes disto,
  // bastava conhecer o email de outra pessoa para reescrever o seu perfil
  // (nome/telefone/NIF/morada/passageiros) atraves deste endpoint.
  router.post('/api/customer/register', async (req, res) => {
    const limited = rateLimit(req, res, 'customer-register', 20, 15 * 60 * 1000);
    if (limited) return limited;
    const body = customerPayload(await parseBody(req));
    const sessionEmail = customerSessionEmail(req);
    const db = ensureCollections(await readDb());
    const existing = db.customers.find(c => c.email === body.email);
    if (existing && sessionEmail !== body.email) {
      // Resposta deliberadamente genérica: conhecer um email não pode dar
      // acesso ao nome, telefone, NIF, morada ou passageiros desse cliente.
      // O utilizador deve autenticar-se e usar /api/customer/profile.
      return json(res, 200, { ok: true, existing: true, message: 'Se já existe uma conta com este email, entre para continuar.' });
    }
    const customer = await updateDb(d => {
      ensureCollections(d);
      let found = d.customers.find(c => c.email === body.email);
      if (found) Object.assign(found, body, { updatedAt: now() });
      else {
        found = { id: id('cli'), createdAt: now(), ...body };
        d.customers.unshift(found);
      }
      audit(d, 'site', 'CUSTOMER_REGISTERED', { customerId: found.id });
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
    // O challenge guarda so o hash do codigo, nunca o codigo em si (ver
    // auditoria) - de outro modo bastava descodificar o proprio challenge
    // (base64, nao encriptado) para ficar com o codigo, mesmo sem aceder
    // ao email.
    const challenge = signToken({ scope: 'customer-code', email: customerEmail, codeHash: hashLoginCode(code), exp: Date.now() + CUSTOMER_CODE_TTL_MS });
    const mail = loginCodeEmail({ email: customerEmail, code });
    const sent = await mailer.sendMail({ to: customerEmail, subject: mail.subject, body: mail.body });
    if (isProductionDeployment(process.env) && sent.mode !== 'smtp') {
      return json(res, 503, { ok: false, error: 'O login por código está temporariamente indisponível. O envio de email não está configurado.' });
    }
    await updateDb(d => {
      ensureCollections(d);
      d.emails.unshift({ id: id('email'), createdAt: now(), to: customerEmail, status: sent.mode === 'smtp' ? 'ENVIADO' : 'GERADO_DEMO', ...mail });
      audit(d, customerEmail, 'CUSTOMER_LOGIN_CODE_REQUESTED', {});
    });
    // demoCode so sai na resposta quando nao ha envio real (EMAIL_MODE!=smtp) -
    // sem isso o login de teste/dev deixaria de ser possivel sem caixa de
    // correio real. Em modo smtp o cliente tem mesmo de ir ver o email.
    return json(res, 200, {
      ok: true,
      message: sent.mode === 'smtp' ? 'Codigo enviado por email.' : 'Codigo gerado. Em produção seria enviado por email.',
      challenge,
      ...(!isProductionDeployment(process.env) && sent.mode === 'mock' ? { demoCode: code } : {})
    });
  });

  router.post('/api/customer/login/verify', async (req, res) => {
    const limited = rateLimit(req, res, 'customer-login-verify', 25, 15 * 60 * 1000);
    if (limited) return limited;
    const body = await parseBody(req);
    const customerEmail = validateEmail(body.email);
    const pending = verifyToken(body.challenge);
    if (!pending || pending.scope !== 'customer-code' || pending.email !== customerEmail || !safeEqual(hashLoginCode(body.code || ''), String(pending.codeHash || ''))) {
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
      .map(r => customerReservationView(r, {
        missingDocuments: missingDocumentsFor(r, db.documents),
        payment: db.payments.find(p => p.reservationId === r.id) || null
      }));
    return json(res, 200, { ok: true, reservations });
  });

  // Pagina propria de uma viagem ("As minhas viagens" > clicar numa) -
  // mais rica que a listagem (customerReservationDetailView em vez de
  // customerReservationView), mas so para UMA reserva de cada vez e so
  // depois de confirmar que pertence mesmo a este cliente.
  router.get('/api/customer/reservations/detail', async (req, res, url) => {
    const customerEmail = customerSessionEmail(req);
    if (!customerEmail) return unauthorized(res);
    const reservationId = cleanText(url.searchParams.get('reservationId'), 120);
    const db = ensureCollections(await readDb());
    const reservation = ownReservationOrNull(db, reservationId, customerEmail);
    if (!reservation) return json(res, 404, { ok: false, error: 'Reserva não encontrada' });

    const serviceLines = db.serviceLines.filter(l => l.reservationId === reservationId);
    const payments = db.payments.filter(p => p.reservationId === reservationId);
    const detail = customerReservationDetailView(reservation, {
      serviceLines, payments, missingDocuments: missingDocumentsFor(reservation, db.documents)
    });
    return json(res, 200, { ok: true, reservation: detail });
  });

  router.post('/api/customer/reservations/resume', async (req, res) => {
    const customerEmail = customerSessionEmail(req);
    if (!customerEmail) return unauthorized(res);
    const limited = rateLimit(req, res, 'customer-reservation-resume', 20, 60 * 1000);
    if (limited) return limited;
    const body = await parseBody(req);
    const reservationId = cleanText(body.reservationId, 120);
    const db = ensureCollections(await readDb());
    const reservation = db.reservations.find(item => item.id === reservationId && item.customer?.email === customerEmail);
    if (!reservation) return json(res, 404, { ok: false, error: 'Reserva não encontrada.' });
    if (reservation.status !== 'PENDING_PAYMENT') {
      return json(res, 409, { ok: false, error: 'Esta viagem já está em processamento. Abra os detalhes para a acompanhar.' });
    }
    const previousPrice = Number(reservation.offer?.finalPrice || 0);
    let result;
    try {
      result = await offerRevalidation.revalidate(reservation.offer, db.margins, { allowPriceChange: true, forceHotelCheck: true });
      const components = reservation.offer?.components;
      const hasDirectSupplierReference = Boolean(components?.flight?.offerId || components?.hotel?.rateKey || reservation.offer?.hbx?.rateKey);
      const hasUnverifiedCoreComponent = Boolean(
        (components?.flight && !components.flight.offerId) ||
        (components?.hotel && !components.hotel.rateKey)
      );
      if (!hasDirectSupplierReference || hasUnverifiedCoreComponent) {
        const adapter = operators.getForOffer(reservation.offer);
        if (!adapter) throw Object.assign(new Error('Esta oferta não tem uma referência de fornecedor que permita nova validação automática.'), { code: 'SUPPLIER_REVALIDATION_UNAVAILABLE' });
        const validation = await adapter.value({ offer: reservation.offer, reservation });
        if (!validation?.availabilityStillValid || !validation?.priceStillValid) throw Object.assign(new Error('O fornecedor já não confirma a disponibilidade ou o preço desta viagem.'), { code: 'SUPPLIER_UNAVAILABLE' });
      }
    } catch (err) {
      const unavailable = ['SUPPLIER_PRICE_CHANGED', 'DUFFEL_OFFER_EXPIRED', 'HBX_RATE_UNAVAILABLE', 'SUPPLIER_UNAVAILABLE'].includes(err.code);
      return json(res, unavailable ? 409 : 503, { ok: false, code: err.code || 'SUPPLIER_REVALIDATION_FAILED', error: err.message || 'Não foi possível validar novamente a viagem.' });
    }
    const latestPrice = Number(result.offer.finalPrice || 0);
    const priceChanged = Math.abs(previousPrice - latestPrice) > 0.02;
    const resume = { reservationId: reservation.id, checkedAt: result.checkedAt, previousPrice, latestPrice, priceChanged, changes: result.changes || [], passengers: reservation.passengers || [] };
    const offer = offerTokens.publicOffer(result.offer, { resumeReservationId: reservation.id, resumeCustomerEmail: customerEmail, resume });
    await updateDb(data => audit(data, customerEmail, 'CUSTOMER_RESERVATION_REVALIDATED', { reservationId: reservation.id, previousPrice, latestPrice, priceChanged }));
    return json(res, 200, { ok: true, offer, resume });
  });

  router.get('/api/customer/profile', async (req, res) => {
    const customerEmail = customerSessionEmail(req);
    if (!customerEmail) return unauthorized(res);
    const db = ensureCollections(await readDb());
    const customer = db.customers.find(c => c.email === customerEmail) || { email: customerEmail };
    return json(res, 200, { ok: true, customer: sanitizeCustomer(customer), hasPassword: Boolean(customer.passwordHash) });
  });

  router.get('/api/customer/support-requests', async (req, res) => {
    const customerEmail = customerSessionEmail(req);
    if (!customerEmail) return unauthorized(res);
    const db = ensureCollections(await readDb());
    const requests = db.leads
      .filter(lead => lead.source === 'CUSTOMER_AREA' && lead.email === customerEmail)
      .map(lead => ({ id: lead.id, createdAt: lead.createdAt, kind: lead.kind, status: lead.status, reservationId: lead.reservationId || '', notes: lead.notes || '' }))
      .slice(0, 50);
    return json(res, 200, { ok: true, requests });
  });

  router.post('/api/customer/support-request', async (req, res) => {
    const customerEmail = customerSessionEmail(req);
    if (!customerEmail) return unauthorized(res);
    const limited = rateLimit(req, res, 'customer-support-request', 12, 60 * 60 * 1000);
    if (limited) return limited;
    const body = await parseBody(req);
    const allowedKinds = new Set(['APOIO', 'ALTERACAO', 'CANCELAMENTO', 'RECLAMACAO', 'PAGAMENTO', 'DOCUMENTOS']);
    const kind = allowedKinds.has(String(body.kind || '').toUpperCase()) ? String(body.kind).toUpperCase() : 'APOIO';
    const reservationId = cleanText(body.reservationId, 120);
    const notes = cleanText(body.notes, 1500);
    if (notes.length < 10) return json(res, 400, { ok: false, error: 'Descreva o pedido com um pouco mais de detalhe.' });
    const db = ensureCollections(await readDb());
    const reservation = reservationId ? ownReservationOrNull(db, reservationId, customerEmail) : null;
    if (reservationId && !reservation) return json(res, 404, { ok: false, error: 'Reserva não encontrada.' });
    const customer = db.customers.find(item => item.email === customerEmail) || { email: customerEmail };
    const requestId = id('lead');
    await updateDb(data => {
      ensureCollections(data);
      data.leads.unshift({
        id: requestId,
        createdAt: now(),
        source: 'CUSTOMER_AREA',
        kind,
        status: 'NOVO',
        reservationId: reservationId || undefined,
        name: customer.name || reservation?.customer?.name || 'Cliente',
        email: customerEmail,
        phone: customer.phone || reservation?.customer?.phone || '',
        destination: reservation?.offer?.destination || '',
        notes
      });
      audit(data, customerEmail, 'CUSTOMER_SUPPORT_REQUESTED', { requestId, kind, reservationId: reservationId || null });
    });
    return json(res, 200, { ok: true, requestId, status: 'NOVO' });
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
      nationality: cleanText(body.nationality, 60),
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

  // Carteira de passageiros do proprio cliente - mesma forma/validacao da
  // rota equivalente do backoffice (POST /api/admin/customers/passengers),
  // mas a identidade vem sempre da sessao. Grava a lista completa de cada
  // vez (poucos registos por cliente, nao justifica CRUD por linha).
  router.post('/api/customer/passengers', async (req, res) => {
    const customerEmail = customerSessionEmail(req);
    if (!customerEmail) return unauthorized(res);
    const body = await parseBody(req);
    if (!Array.isArray(body.passengers)) return json(res, 400, { ok: false, error: 'Lista de passageiros inválida' });
    const passengers = body.passengers.map(p => ({
      id: cleanText(p.id, 60) || id('pax'),
      name: cleanText(p.name, 120),
      birthdate: cleanText(p.birthdate, 30),
      nationality: cleanText(p.nationality, 80),
      documentType: cleanText(p.documentType, 30),
      documentNumber: cleanText(p.documentNumber, 60),
      documentExpiry: cleanText(p.documentExpiry, 30),
      relationship: cleanText(p.relationship, 60),
      notes: cleanText(p.notes, 500)
    })).filter(p => p.name);
    const customer = await updateDb(db => {
      ensureCollections(db);
      let found = db.customers.find(c => c.email === customerEmail);
      if (found) { found.passengers = passengers; found.updatedAt = now(); }
      else { found = { id: id('cli'), createdAt: now(), email: customerEmail, passengers }; db.customers.unshift(found); }
      audit(db, customerEmail, 'CUSTOMER_PASSENGERS_UPDATED', { customerId: found.id, count: passengers.length });
      return found;
    });
    return json(res, 200, { ok: true, customer: sanitizeCustomer(customer) });
  });

  // Preferencias comerciais do proprio cliente - mesmos campos da rota
  // admin equivalente, exceto commercialNotes (notas internas da equipa,
  // nunca editaveis nem visiveis ao cliente) - o valor existente e sempre
  // preservado tal como estava, nunca apagado por o formulario do cliente
  // nao o incluir.
  router.post('/api/customer/preferences', async (req, res) => {
    const customerEmail = customerSessionEmail(req);
    if (!customerEmail) return unauthorized(res);
    const body = await parseBody(req);
    const p = body.preferences || {};
    const customer = await updateDb(db => {
      ensureCollections(db);
      let found = db.customers.find(c => c.email === customerEmail);
      if (!found) { found = { id: id('cli'), createdAt: now(), email: customerEmail }; db.customers.unshift(found); }
      found.preferences = {
        preferredDestinations: cleanText(p.preferredDestinations, 300),
        tripType: cleanText(p.tripType, 200),
        hotelCategory: cleanText(p.hotelCategory, 100),
        boardPreference: cleanText(p.boardPreference, 100),
        preferredAirline: cleanText(p.preferredAirline, 100),
        seatPreference: cleanText(p.seatPreference, 100),
        roomType: cleanText(p.roomType, 100),
        usualBudget: cleanText(p.usualBudget, 100),
        preferredPeriods: cleanText(p.preferredPeriods, 200),
        departureAirport: cleanText(p.departureAirport, 100),
        specialNeeds: cleanText(p.specialNeeds, 500),
        commercialNotes: found.preferences?.commercialNotes || ''
      };
      found.updatedAt = now();
      audit(db, customerEmail, 'CUSTOMER_PREFERENCES_UPDATED', { customerId: found.id });
      return found;
    });
    return json(res, 200, { ok: true, customer: sanitizeCustomer(customer) });
  });

  function ownReservationOrNull(db, reservationId, customerEmail) {
    const reservation = db.reservations.find(r => r.id === reservationId);
    if (!reservation || reservation.customer?.email !== customerEmail) return null;
    return reservation;
  }

  const identityDocumentTypes = new Set(['PASSPORT', 'IDENTITY_CARD']);
  const normalizePerson = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
  const passengerFullName = passenger => [passenger?.name, passenger?.surname].filter(Boolean).join(' ').trim() || 'Titular';

  function selectablePassengers(db, customerEmail, reservation = null) {
    const customer = db.customers.find(item => item.email === customerEmail) || { id: 'customer', email: customerEmail, passengers: [] };
    const wallet = Array.isArray(customer.passengers) ? customer.passengers : [];
    if (!reservation) {
      const family = wallet.map(passenger => ({
        id: passenger.id,
        name: passenger.name,
        documentType: passenger.documentType,
        documentNumber: passenger.documentNumber,
        documentExpiry: passenger.documentExpiry,
        documentCountry: passenger.documentCountry || passenger.nationality || 'Portugal'
      })).filter(passenger => passenger.id && passenger.name);
      if (customer.name && !family.some(passenger => normalizePerson(passenger.name) === normalizePerson(customer.name))) {
        family.unshift({ id: `owner:${customer.id}`, name: customer.name, documentType: 'CC', documentCountry: 'Portugal' });
      }
      return family;
    }
    const reservationPassengers = reservation.passengers?.length ? reservation.passengers : [{ name: reservation.customer?.name || customer.name || 'Titular', documentType: 'CC' }];
    return reservationPassengers.map((passenger, index) => {
      const name = passengerFullName(passenger);
      const walletMatch = wallet.find(saved =>
        (passenger.documentNumber && saved.documentNumber && normalizePerson(passenger.documentNumber) === normalizePerson(saved.documentNumber)) ||
        normalizePerson(saved.name) === normalizePerson(name)
      );
      return {
        id: passenger.passengerId || passenger.id || walletMatch?.id || `${reservation.id}:passenger:${index}`,
        name,
        documentType: passenger.documentType || walletMatch?.documentType || '',
        documentNumber: passenger.documentNumber || walletMatch?.documentNumber || '',
        documentExpiry: passenger.documentExpiry || walletMatch?.documentExpiry || '',
        documentCountry: passenger.documentCountry || walletMatch?.documentCountry || passenger.nationality || walletMatch?.nationality || 'Portugal'
      };
    });
  }

  function validateIdentityMetadata(body, passengers, reservation = null) {
    const type = cleanText(body.type, 30);
    if (!identityDocumentTypes.has(type)) return { type };
    const passengerId = cleanText(body.passengerId, 120);
    const passenger = passengers.find(item => item.id === passengerId);
    if (!passenger) throw new Error('Escolha o passageiro a quem pertence este documento.');
    const documentNumber = cleanText(body.documentNumber, 40).toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9 .\/-]{3,39}$/.test(documentNumber)) throw new Error('Indique um número de documento válido.');
    const expiryDate = cleanText(body.expiryDate, 10);
    const parsedExpiry = new Date(`${expiryDate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryDate) || Number.isNaN(parsedExpiry.getTime()) || parsedExpiry.toISOString().slice(0, 10) !== expiryDate) throw new Error('Indique uma data de validade válida.');
    const minimumDate = reservation?.offer?.checkout || new Date().toISOString().slice(0, 10);
    if (expiryDate < minimumDate) throw new Error(reservation ? 'O documento caduca antes do regresso da viagem.' : 'O documento já está caducado.');
    const issuingCountry = cleanText(body.issuingCountry, 80);
    if (issuingCountry.length < 2) throw new Error('Indique o país emissor do documento.');
    return { type, passengerId: passenger.id, passengerName: passenger.name, documentNumber, expiryDate, issuingCountry };
  }

  function isDuplicateIdentityDocument(db, customerEmail, metadata, excludedId = '') {
    if (!identityDocumentTypes.has(metadata.type)) return false;
    return db.documents.some(doc => doc.id !== excludedId && identityDocumentTypes.has(doc.type) && (
      doc.customerEmail === customerEmail || ownReservationOrNull(db, doc.reservationId, customerEmail)
    ) && (
      normalizePerson(doc.documentNumber) === normalizePerson(metadata.documentNumber) ||
      (doc.type === metadata.type && doc.passengerId && doc.passengerId === metadata.passengerId)
    ));
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
    let reservation = null;
    if (reservationId) {
      reservation = ownReservationOrNull(db, reservationId, customerEmail);
      if (!reservation) return json(res, 404, { ok: false, error: 'Reserva não encontrada' });
      const passengers = selectablePassengers(db, customerEmail, reservation);
      documents = db.documents.filter(doc => doc.reservationId === reservationId || (doc.customerEmail === customerEmail && identityDocumentTypes.has(doc.type) && passengers.some(passenger =>
        (doc.passengerId && passenger.id === doc.passengerId) ||
        (doc.documentNumber && passenger.documentNumber && normalizePerson(doc.documentNumber) === normalizePerson(passenger.documentNumber)) ||
        normalizePerson(doc.passengerName) === normalizePerson(passenger.name)
      )));
    } else {
      documents = db.documents.filter(d => d.customerEmail === customerEmail);
    }
    // So documentos de viagem (ou o que o proprio cliente anexou) - nunca
    // faturas de compra, documentacao interna ou de ocorrencia/reclamacao
    // (ver auditoria).
    documents = documents.filter(d => isCustomerVisibleDocument(d, customerEmail));
    const withUrls = await Promise.all(documents.map(async d => {
      const { storagePath, ...safe } = d;
      return { ...safe, reusable: Boolean(reservationId && d.customerEmail === customerEmail && !d.reservationId), signedUrl: await fileStorage.signedUrl(storagePath) };
    }));
    return json(res, 200, { ok: true, documents: withUrls, passengers: selectablePassengers(db, customerEmail, reservation) });
  });

  router.post('/api/customer/documents/upload', async (req, res) => {
    const customerEmail = customerSessionEmail(req);
    if (!customerEmail) return unauthorized(res);
    const limited = rateLimit(req, res, 'customer-document-upload', 20, 60 * 60 * 1000);
    if (limited) return limited;
    const body = await parseBody(req);
    const reservationId = cleanText(body.reservationId, 120);
    const type = cleanText(body.type, 20);
    if (!DOCUMENT_TYPES.includes(type)) return json(res, 400, { ok: false, error: 'Tipo de documento inválido' });
    // O cliente não pode classificar um upload como fatura/recibo interno
    // ou fotografia de ocorrência: isso poluiria o circuito financeiro e
    // podia fazer um anexo comum aparecer em áreas reservadas à equipa.
    const forbiddenCustomerTypes = new Set(['INVOICE_PURCHASE', 'INVOICE_SALE', 'RECEIPT', 'CREDIT_NOTE', 'OCCURRENCE_PHOTO']);
    if (forbiddenCustomerTypes.has(type)) return json(res, 400, { ok: false, error: 'Tipo de documento não disponível para carregamento pelo cliente.' });
    const fileName = cleanText(body.fileName, 200);
    if (!fileName || !body.fileBase64) return json(res, 400, { ok: false, error: 'Ficheiro inválido' });

    const db = ensureCollections(await readDb());
    const reservation = reservationId ? ownReservationOrNull(db, reservationId, customerEmail) : null;
    if (reservationId && !reservation) return json(res, 404, { ok: false, error: 'Reserva não encontrada' });
    const passengers = selectablePassengers(db, customerEmail, reservation);
    let metadata;
    try { metadata = validateIdentityMetadata({ ...body, type }, passengers, reservation); }
    catch (err) { return json(res, 400, { ok: false, error: err.message }); }
    if (isDuplicateIdentityDocument(db, customerEmail, metadata)) {
      return json(res, 409, { ok: false, error: 'Este documento já está guardado para este passageiro. Atualize os dados existentes em vez de o anexar novamente.' });
    }
    let folder;
    if (reservationId) {
      folder = reservationId;
    } else {
      folder = `cliente/${customerEmail.replace('@', '_')}`;
    }

    const buffer = Buffer.from(body.fileBase64, 'base64');
    if (buffer.length < 4 || buffer.length > 7 * 1024 * 1024) return json(res, 400, { ok: false, error: 'O documento deve ter entre 4 bytes e 7 MB.' });
    const isPdf = buffer.subarray(0, 4).toString('ascii') === '%PDF';
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isPng = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (!isPdf && !isJpeg && !isPng) return json(res, 400, { ok: false, error: 'Formato não permitido. Use PDF, JPG ou PNG.' });
    const verifiedMimeType = isPdf ? 'application/pdf' : isPng ? 'image/png' : 'image/jpeg';
    const docId = id('doc');
    const storagePath = `${folder}/${docId}-${fileStorage.sanitizeFileName(fileName)}`;
    try {
      await fileStorage.uploadFile(storagePath, buffer, verifiedMimeType);
    } catch (err) {
      return json(res, 502, { ok: false, error: `Falha ao guardar documento: ${err.message}` });
    }

    const document = {
      id: docId,
      reservationId: reservationId || undefined,
      customerEmail: reservationId ? undefined : customerEmail,
      ...metadata,
      fileName, storagePath, createdAt: now(), uploadedBy: customerEmail
    };
    try {
      await updateDb(d => {
        ensureCollections(d);
        d.documents.unshift(document);
        audit(d, customerEmail, 'DOCUMENT_UPLOADED', { reservationId: reservationId || null, documentId: docId });
      });
    } catch (err) {
      try { await fileStorage.deleteFile(storagePath); } catch { /* compensacao de melhor esforco */ }
      return json(res, 502, { ok: false, error: `Falha ao registar documento: ${err.message}` });
    }
    const { storagePath: _storagePath, ...safeDocument } = document;
    return json(res, 200, { ok: true, document: safeDocument });
  });

  // Ver auditoria: nao basta pertencer a uma reserva do cliente - um
  // documento interno/financeiro ligado a essa mesma reserva (ex.: fatura
  // de compra ao fornecedor) nao pode ser visto nem apagado pelo cliente,
  // mesmo sabendo o documentId.
  function ownDocumentOrNull(db, document, customerEmail) {
    if (!document || !isCustomerVisibleDocument(document, customerEmail)) return null;
    if (document.reservationId) return ownReservationOrNull(db, document.reservationId, customerEmail) ? document : null;
    return document.customerEmail === customerEmail ? document : null;
  }

  router.post('/api/customer/documents/update', async (req, res) => {
    const customerEmail = customerSessionEmail(req);
    if (!customerEmail) return unauthorized(res);
    const body = await parseBody(req);
    const documentId = cleanText(body.documentId, 120);
    const db = ensureCollections(await readDb());
    const document = ownDocumentOrNull(db, db.documents.find(item => item.id === documentId), customerEmail);
    if (!document) return json(res, 404, { ok: false, error: 'Documento não encontrado' });
    const type = cleanText(body.type, 30);
    if (!identityDocumentTypes.has(type)) return json(res, 400, { ok: false, error: 'Só pode editar os dados de Passaporte ou Cartão de Cidadão nesta área.' });
    const reservation = document.reservationId ? ownReservationOrNull(db, document.reservationId, customerEmail) : null;
    const passengers = selectablePassengers(db, customerEmail, reservation);
    let metadata;
    try { metadata = validateIdentityMetadata({ ...body, type }, passengers, reservation); }
    catch (err) { return json(res, 400, { ok: false, error: err.message }); }
    if (isDuplicateIdentityDocument(db, customerEmail, metadata, document.id)) {
      return json(res, 409, { ok: false, error: 'Já existe outro documento com estes dados para este passageiro.' });
    }
    let updated;
    await updateDb(data => {
      ensureCollections(data);
      const target = data.documents.find(item => item.id === document.id);
      if (!target) return;
      Object.assign(target, metadata, { updatedAt: now() });
      updated = { ...target };
      audit(data, customerEmail, 'DOCUMENT_METADATA_UPDATED', { reservationId: target.reservationId || null, documentId: target.id, type: target.type, passengerId: target.passengerId });
    });
    const { storagePath: _storagePath, ...safeDocument } = updated || {};
    return json(res, 200, { ok: true, document: safeDocument });
  });

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
