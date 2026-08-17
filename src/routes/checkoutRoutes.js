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
  const { json, unauthorized, parseBody, readDb, updateDb, operators, customerPayload, validatePassengerForTrip, paymentMethod, cleanText, domain, paymentConfirmation } = ctx;
  const { ensureCollections, audit, id, now } = domain;
  const { rateLimit } = ctx;
  const { customerSessionEmail, verifyToken } = ctx.auth;

  router.post('/api/checkout', async (req, res) => {
    const limited = rateLimit(req, res, 'checkout', 30, 60 * 1000);
    if (limited) return limited;
    const body = await parseBody(req);
    const db = ensureCollections(await readDb());
    const idemKey = cleanText(req.headers['idempotency-key'] || body.idempotencyKey || '', 160);

    let offer = body.offer || ctx.getOfferById(body.offerId, db.margins);
    if (!offer) return json(res, 404, { ok: false, error: 'Oferta nao encontrada' });

    // Quando a oferta vem do browser (body.offer, reenviado tal como veio
    // da pesquisa), so os precos de dentro do offerToken assinado no
    // momento da pesquisa sao de confianca - nunca costPrice/finalPrice
    // enviados diretamente (ver auditoria: bastava mandar os dois iguais
    // para "provar" que a margem nao tinha sido violada). offerId sozinho
    // (sem offer) continua a vir de getOfferById, calculado de novo no
    // servidor, sem depender de nada vindo do browser.
    if (body.offer) {
      const signed = verifyToken(offer.offerToken);
      if (!signed || signed.scope !== 'offer') {
        return json(res, 400, { ok: false, error: 'Esta oferta expirou ou é inválida - faça a pesquisa novamente.' });
      }
      offer = { ...offer, costPrice: signed.costPrice, finalPrice: signed.finalPrice, operator: signed.operator || offer.operator, tourdiez: signed.tourdiez || undefined };
    }

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
    const rawPassengers = Array.isArray(body.passengers) && body.passengers.length ? body.passengers : customer.passengers;
    const adults = Number(offer.adults || 1);
    const children = Number(offer.children || 0);
    const infants = Number(offer.infants || 0);
    const expectedCount = adults + children + infants;
    if (rawPassengers.length !== expectedCount) return json(res, 400, { ok: false, error: `Esperados ${expectedCount} passageiro(s); recebidos ${rawPassengers.length}.` });
    let passengers;
    try {
      passengers = rawPassengers.map((p, i) => validatePassengerForTrip(p, i < adults ? 'ADT' : i < adults + children ? 'CHD' : 'INF', offer.checkout));
      const docs = passengers.map(p => p.documentNumber.trim().toLowerCase());
      if (new Set(docs).size !== docs.length) throw new Error('O mesmo documento nao pode ser usado por dois passageiros');
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
    customer.passengers = passengers;
    const reservation = {
      id: id('res'),
      createdAt: now(),
      status: 'PENDING_PAYMENT',
      customer,
      passengers,
      offer,
      operator: offer.operator,
      source: 'site',
      notes: 'Reserva criada em modo semi-automatico. Confirmacao no operador exige aprovacao do backoffice.',
      // O site continua exatamente como esta para o cliente (nada disto e
      // visivel/pedido no checkout) - agencia e canal ficam sempre fixos,
      // ver auditoria/multiagencia.
      branchId: 'branch-sede',
      origin: 'WEBSITE'
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


  router.post('/api/payment/method', async (req, res) => {
    const body = await parseBody(req);
    const db = ensureCollections(await readDb());
    const payment = db.payments.find(p => p.id === body.paymentId);
    if (!payment) return json(res, 404, { ok: false, error: 'Pagamento nao encontrado' });
    const reservation = db.reservations.find(r => r.id === payment.reservationId);
    if (!reservation) return json(res, 404, { ok: false, error: 'Reserva nao encontrada' });
    const customerEmail = customerSessionEmail(req);
    if (!customerEmail || customerEmail !== reservation.customer?.email) return unauthorized(res);
    if (payment.status !== 'PENDING') return json(res, 409, { ok: false, error: 'O metodo ja nao pode ser alterado depois de o pagamento ser processado.' });
    let method;
    try { method = paymentMethod(body.method); } catch (err) { return json(res, 400, { ok: false, error: err.message }); }
    let updated;
    await updateDb(d => {
      ensureCollections(d);
      const p = d.payments.find(x => x.id === payment.id);
      if (!p || p.status !== 'PENDING') return;
      p.method = method;
      updated = { ...p };
      audit(d, customerEmail, 'PAYMENT_METHOD_SELECTED', { reservationId: reservation.id, paymentId: p.id, method });
    });
    return json(res, 200, { ok: true, payment: updated });
  });

  router.post('/api/payment/confirm', async (req, res) => {
    const limited = rateLimit(req, res, 'payment-confirm', 40, 60 * 1000);
    if (limited) return limited;
    if ((process.env.PAYMENTS_MODE || 'mock').toLowerCase() !== 'mock') {
      return json(res, 405, { ok: false, error: 'Confirmacao manual de pagamento desativada. Em producao o estado pago so pode vir do gateway.' });
    }
    const body = await parseBody(req);
    const db = ensureCollections(await readDb());
    const payment = db.payments.find(p => p.id === body.paymentId || p.reservationId === body.reservationId);
    if (!payment) return json(res, 404, { ok: false, error: 'Pagamento nao encontrado' });
    const reservation = db.reservations.find(r => r.id === payment.reservationId);
    if (!reservation) return json(res, 404, { ok: false, error: 'Reserva nao encontrada' });
    // O checkout exige email verificado antes de chegar aqui (ver
    // billingStep.js), por isso a sessao do cliente ja deve corresponder ao
    // dono da reserva - sem isto, qualquer pessoa que adivinhasse um
    // paymentId conseguia confirmar o pagamento de outra reserva. So esta
    // verificacao e especifica deste endpoint (chamado pelo browser) - o
    // resto da logica e partilhada com o webhook da Stripe
    // (src/paymentConfirmation.js), que nao tem sessao de cliente nenhuma
    // (a propria assinatura do pedido e a autenticacao).
    const customerEmail = customerSessionEmail(req);
    if (!customerEmail || customerEmail !== reservation.customer?.email) return unauthorized(res);

    const result = await paymentConfirmation.confirmPayment(payment.id);
    if (!result.ok) return json(res, 404, result);
    return json(res, 200, result);
  });

  router.post('/api/payment/confirm-legacy', async (req, res) => {
    return json(res, 410, { ok: false, error: 'Endpoint legado removido. Use /api/payment/confirm.' });
  });
};
