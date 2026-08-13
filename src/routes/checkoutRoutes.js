// Checkout e pagamento (simulado). A confirmacao real no operador so
// acontece depois de aprovacao manual no backoffice (ver adminRoutes.js).
//
// Nota: /api/checkout-legacy e /api/payment/confirm-legacy que existiam
// aqui foram removidos (ver auditoria) - o checkout-legacy nao validava
// nada, e o confirm-legacy ja nem sequer era alcancavel (o primeiro return
// da funcao ja devolvia 410 antes do resto do codigo, que ainda por cima
// referenciava uma variavel `tourdiez` que nao existe em lado nenhum).

const crypto = require('crypto');

module.exports = function registerCheckoutRoutes(router, ctx) {
  const { json, parseBody, readDb, updateDb, operators, customerPayload, paymentMethod, cleanText, domain, reservationEmail } = ctx;
  const { ensureCollections, audit, addOperatorLog, id, now } = domain;
  const { rateLimit } = ctx;

  router.post('/api/checkout', async (req, res) => {
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

    let offer = body.offer || ctx.getOfferById(body.offerId, db.margins);
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
  });

  router.post('/api/payment/confirm', async (req, res) => {
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
  });

  router.post('/api/payment/confirm-legacy', async (req, res) => {
    return json(res, 410, { ok: false, error: 'Endpoint legado removido. Use /api/payment/confirm.' });
  });
};
