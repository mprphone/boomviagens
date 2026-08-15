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
  const { json, unauthorized, parseBody, readDb, updateDb, operators, customerPayload, paymentMethod, cleanText, domain, reservationEmail } = ctx;
  const { ensureCollections, audit, addOperatorLog, id, now } = domain;
  const { rateLimit } = ctx;
  const { customerSessionEmail } = ctx.auth;

  router.post('/api/checkout', async (req, res) => {
    const limited = rateLimit(req, res, 'checkout', 30, 60 * 1000);
    if (limited) return limited;
    const body = await parseBody(req);
    const db = ensureCollections(await readDb());
    const idemKey = cleanText(req.headers['idempotency-key'] || body.idempotencyKey || '', 160);

    let offer = body.offer || ctx.getOfferById(body.offerId, db.margins);
    if (!offer) return json(res, 404, { ok: false, error: 'Oferta nao encontrada' });

    // O offer vem do cliente (o browser reenvia o que recebeu na pesquisa),
    // por isso nada garante que finalPrice nao foi alterado entretanto.
    // applyMargin() nunca produz um finalPrice abaixo do costPrice (a
    // margem e sempre >= 0 e o arredondamento e sempre para cima) - uma
    // oferta que viole isso so pode ter sido manipulada, e e rejeitada
    // aqui, antes de criar reserva ou pagamento.
    const finalPrice = Number(offer.finalPrice);
    const costPrice = Number(offer.costPrice);
    if (!Number.isFinite(finalPrice) || finalPrice <= 0 || (Number.isFinite(costPrice) && finalPrice < costPrice)) {
      return json(res, 400, { ok: false, error: 'Preço da oferta inválido.' });
    }

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
    // O separador "Reservas" (linhas de servico) comeca vazio ate o
    // backoffice tratar o processo junto do fornecedor - mas nao faz
    // sentido a pagina abrir sem nenhuma linha quando o cliente ja
    // escolheu um hotel/pacote concreto na pesquisa. Semeia uma linha
    // ALOJAMENTO a partir da oferta, por confirmar, para o backoffice
    // partir dali em vez de comecar do zero.
    const serviceLine = offer.hotel ? {
      id: id('svc'),
      createdAt: now(),
      reservationId: reservation.id,
      type: 'ALOJAMENTO',
      description: offer.board ? `${offer.hotel} - ${offer.board}` : offer.hotel,
      status: 'NAO_CONFIRMADO',
      supplierName: offer.operator || '',
      reference: '',
      locator: '',
      quantity: 1,
      dateStart: offer.checkin || '',
      dateEnd: offer.checkout || '',
      netValue: costPrice || 0,
      pvpValue: finalPrice,
      discountPercent: 0,
      paid: false,
      notes: 'Linha criada automaticamente a partir da oferta escolhida no checkout.'
    } : null;
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

    // Verificar e inserir a idempotency key tem de acontecer as duas coisas
    // dentro do MESMO updateDb: se a verificacao fosse feita contra uma
    // leitura separada de antemao, dois pedidos quase simultaneos com a
    // mesma idempotency-key (ex.: duplo clique, retry de rede) podiam
    // passar os dois pela verificacao antes de qualquer um escrever,
    // criando duas reservas/pagamentos para o mesmo clique.
    let resultPayload = null;
    await updateDb(d => {
      ensureCollections(d);
      if (idemKey && d.idempotencyKeys[idemKey]) {
        const existingReservation = d.reservations.find(r => r.id === d.idempotencyKeys[idemKey].reservationId);
        const existingPayment = d.payments.find(p => p.id === d.idempotencyKeys[idemKey].paymentId);
        if (existingReservation && existingPayment) {
          resultPayload = { reservation: existingReservation, payment: existingPayment, idempotent: true };
          return;
        }
      }
      d.reservations.unshift(reservation);
      d.payments.unshift(payment);
      if (serviceLine) {
        d.serviceLines.push(serviceLine);
        d.reservationEvents.unshift({ id: id('evt'), createdAt: now(), reservationId: reservation.id, actor: 'site', type: 'SERVICE_ADDED', description: `${serviceLine.description} (linha automatica do checkout)` });
      }
      let existing = d.customers.find(c => c.email === customer.email);
      if (!existing && customer.email) d.customers.unshift({ id: id('cli'), createdAt: now(), ...customer });
      if (idemKey) d.idempotencyKeys[idemKey] = { reservationId: reservation.id, paymentId: payment.id, createdAt: now() };
      audit(d, 'site', 'CHECKOUT_CREATED', { reservationId: reservation.id, paymentId: payment.id, idempotencyKey: idemKey || null });
      resultPayload = { reservation, payment, idempotent: false };
    });
    return json(res, 200, { ok: true, ...resultPayload, next: 'Chamar /api/payment/confirm para simular pagamento. A confirmacao no operador fica pendente de aprovacao no backoffice.' });
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
    // O checkout exige email verificado antes de chegar aqui (ver
    // billingStep.js), por isso a sessao do cliente ja deve corresponder ao
    // dono da reserva - sem isto, qualquer pessoa que adivinhasse um
    // paymentId conseguia confirmar o pagamento de outra reserva.
    const customerEmail = customerSessionEmail(req);
    if (!customerEmail || customerEmail !== reservation.customer?.email) return unauthorized(res);

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
