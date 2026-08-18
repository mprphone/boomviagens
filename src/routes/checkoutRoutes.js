const { mockPaymentsAllowed, paymentsMode, gatewayPaymentsEnabled } = require('../runtimeConfig');
// Checkout e pagamentos mock/gateway. Mesmo num pagamento real, a emissao
// no operador so acontece depois da validacao operacional/backoffice.
//
// Nota: endpoints legacy de checkout/pagamento foram removidos (ver auditoria) - o checkout-legacy nao validava
// nada, e o confirm-legacy ja nem sequer era alcancavel (o primeiro return
// da funcao ja devolvia 410 antes do resto do codigo, que ainda por cima
// referenciava uma variavel `tourdiez` que nao existe em lado nenhum).

const crypto = require('crypto');

module.exports = function registerCheckoutRoutes(router, ctx) {
  const { json, unauthorized, parseBody, readDb, updateDb, operators, customerPayload, validatePassengerForTrip, paymentMethod, cleanText, domain, paymentConfirmation, paymentGateways } = ctx;
  const { ensureCollections, audit, id, now } = domain;
  const { rateLimit } = ctx;
  const { customerSessionEmail, openToken } = ctx.auth;

  function publicBaseUrl() {
    const value = String(process.env.PUBLIC_BASE_URL || process.env.BASE_URL || '').trim().replace(/\/$/, '');
    if (!value) throw new Error('Defina PUBLIC_BASE_URL para criar pagamentos no gateway.');
    let parsed;
    try { parsed = new URL(value); } catch { throw new Error('PUBLIC_BASE_URL não é um endereço válido.'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('PUBLIC_BASE_URL tem de usar HTTP ou HTTPS.');
    return parsed.toString().replace(/\/$/, '');
  }

  function safePayment(payment) {
    if (!payment) return null;
    const { gatewaySession: _secretSession, ...safe } = payment;
    return safe;
  }

  function safeReservation(reservation) {
    const offer = reservation?.offer || {};
    return reservation ? {
      id: reservation.id,
      status: reservation.status,
      offer: { destination: offer.destination || '', hotel: offer.hotel || '', checkin: offer.checkin || '', checkout: offer.checkout || '', nights: Number(offer.nights || 0), finalPrice: Number(offer.finalPrice || 0) }
    } : null;
  }

  // Antes de criar a reserva/pagamento, volta a consultar apenas os
  // componentes que o respetivo fornecedor manda revalidar nesta fase.
  // Isto não executa booking: confirma que o preço que o cliente viu ainda
  // corresponde ao estado mais recente disponível no fornecedor.
  async function revalidateSelectedSupplierPrices(offer, margins) {
    if (!ctx.offerRevalidation?.revalidate) throw new Error('Serviço de revalidação indisponível.');
    return (await ctx.offerRevalidation.revalidate(offer, margins, { allowPriceChange: false, forceHotelCheck: false })).offer;
  }

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
      const signed = openToken(offer.offerToken);
      if (!signed || signed.scope !== 'offer') {
        return json(res, 400, { ok: false, error: 'Esta oferta expirou ou é inválida - faça a pesquisa novamente.' });
      }
      offer = {
        ...offer,
        // Identidade e preço vêm do token selado, não do JSON editável do browser.
        id: signed.id || offer.id,
        destination: signed.destination || '', country: signed.country || '', hotel: signed.hotel || '', board: signed.board || '', roomName: signed.roomName || '',
        nights: Number(signed.nights || 0), rating: Number(signed.rating || 0),
        freeCancellation: Boolean(signed.freeCancellation), nonRefundable: Boolean(signed.nonRefundable), freeCancellationUntil: signed.freeCancellationUntil || null,
        origin: signed.origin || '', checkin: signed.checkin || '', checkout: signed.checkout || '',
        adults: Number(signed.adults || 1), children: Number(signed.children || 0), infants: Number(signed.infants || 0),
        childAges: Array.isArray(signed.childAges) ? signed.childAges : [], infantAges: Array.isArray(signed.infantAges) ? signed.infantAges : [],
        image: signed.image || '',
        costPrice: signed.costPrice, finalPrice: signed.finalPrice,
        operator: signed.operator || offer.operator, tourdiez: signed.tourdiez || undefined, hbx: signed.hbx || undefined,
        provider: signed.provider || offer.provider, productType: signed.productType || offer.productType,
        flight: signed.flight || undefined, components: signed.components || undefined,
        resumeReservationId: signed.resumeReservationId || undefined,
        resumeCustomerEmail: signed.resumeCustomerEmail || undefined
      };
    }

    // applyMargin() nunca produz um finalPrice abaixo do costPrice (a
    // margem e sempre >= 0 e o arredondamento e sempre para cima) - uma
    // oferta que viole isso so pode ter sido manipulada, e e rejeitada
    // aqui, antes de criar reserva ou pagamento.
    const quotedFinalPrice = Number(offer.finalPrice);
    const quotedCostPrice = Number(offer.costPrice);
    if (!Number.isFinite(quotedFinalPrice) || quotedFinalPrice <= 0 || (Number.isFinite(quotedCostPrice) && quotedFinalPrice < quotedCostPrice)) {
      return json(res, 400, { ok: false, error: 'Preço da oferta inválido.' });
    }

    const verifiedEmail = customerSessionEmail(req);
    if (!verifiedEmail) return unauthorized(res);
    const customer = customerPayload(body.customer || { name: body.name || 'Cliente Teste', email: body.email || 'cliente@exemplo.pt', phone: body.phone || '' });
    if (!customer.email || String(customer.email).trim().toLowerCase() !== String(verifiedEmail).trim().toLowerCase()) {
      return json(res, 403, { ok: false, error: 'O email da reserva tem de corresponder ao email verificado nesta sessão.' });
    }
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

    try {
      offer = await revalidateSelectedSupplierPrices(offer, db.margins);
    } catch (err) {
      const priceChanged = err?.code === 'SUPPLIER_PRICE_CHANGED' || err?.code === 'DUFFEL_OFFER_EXPIRED' || err?.code === 'HBX_RATE_UNAVAILABLE';
      const status = priceChanged ? 409 : 503;
      return json(res, status, { ok: false, code: err?.code || 'SUPPLIER_REVALIDATION_FAILED', error: err?.message || 'Não foi possível revalidar a viagem.', latestPrice: Number.isFinite(Number(err?.latestPrice)) ? Number(err.latestPrice) : undefined });
    }

    const finalPrice = Number(offer.finalPrice);
    const costPrice = Number(offer.costPrice);
    if (!Number.isFinite(finalPrice) || finalPrice <= 0 || (Number.isFinite(costPrice) && finalPrice < costPrice)) {
      return json(res, 400, { ok: false, error: 'Preço da oferta inválido após revalidação.' });
    }

    let resumedReservation = null;
    let resumedPayment = null;
    if (offer.resumeReservationId) {
      if (offer.resumeCustomerEmail !== verifiedEmail) return json(res, 403, { ok: false, error: 'Esta retoma não pertence à sessão autenticada.' });
      resumedReservation = db.reservations.find(item => item.id === offer.resumeReservationId && item.customer?.email === verifiedEmail);
      resumedPayment = db.payments.find(item => item.reservationId === offer.resumeReservationId && item.status === 'PENDING');
      if (!resumedReservation || !resumedPayment || resumedReservation.status !== 'PENDING_PAYMENT') {
        return json(res, 409, { ok: false, error: 'Esta reserva já não pode ser retomada neste estado.' });
      }
    }

    const reservation = {
      ...(resumedReservation || {}),
      id: resumedReservation?.id || id('res'),
      createdAt: resumedReservation?.createdAt || now(),
      updatedAt: resumedReservation ? now() : undefined,
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
    const serviceLines = [];
    // Quando o produto foi construído componente a componente, cada serviço
    // mantém o seu próprio NET/PVP assinado. Assim transfer/atividade não são
    // somados novamente dentro do alojamento no backoffice.
    if (offer.productType === 'FLIGHT' && offer.components?.flight) {
      serviceLines.push({
        id: id('svc'), createdAt: now(), reservationId: reservation.id, type: 'VOO',
        description: `Voo ${offer.origin || ''} - ${offer.destination || ''}`, status: 'NAO_CONFIRMADO',
        supplierName: 'Duffel', reference: offer.components.flight.offerId || '', locator: '', quantity: 1,
        dateStart: offer.checkin || '', dateEnd: offer.checkout || '',
        netValue: Number(offer.components.flight.costPrice || offer.costPrice || 0), pvpValue: Number(offer.components.flight.finalPrice || offer.finalPrice || 0),
        discountPercent: 0, paid: false, notes: 'Voo selecionado online. Revalidar oferta Duffel antes de emissão.'
      });
    } else if (offer.components?.hotel) {
      serviceLines.push({
        id: id('svc'), createdAt: now(), reservationId: reservation.id, type: 'ALOJAMENTO',
        description: offer.board ? `${offer.hotel} - ${offer.board}` : offer.hotel,
        status: 'NAO_CONFIRMADO', supplierName: 'HBX Hotels', reference: offer.components.hotel.hotelCode || offer.hbx?.hotelCode || '', locator: '', quantity: 1,
        dateStart: offer.checkin || '', dateEnd: offer.checkout || '',
        netValue: Number(offer.components.hotel.costPrice || 0), pvpValue: Number(offer.components.hotel.finalPrice || 0),
        discountPercent: 0, paid: false, notes: 'Alojamento criado a partir do construtor de viagem. Revalidar rateKey antes de confirmar.'
      });
      if (offer.components.flight) {
        serviceLines.push({
          id: id('svc'), createdAt: now(), reservationId: reservation.id, type: 'VOO',
          description: `Voo ${offer.origin || ''} - ${offer.destination || ''}`,
          status: 'NAO_CONFIRMADO', supplierName: 'Duffel', reference: offer.components.flight.offerId || '', locator: '', quantity: 1,
          dateStart: offer.checkin || '', dateEnd: offer.checkout || '',
          netValue: Number(offer.components.flight.costPrice || 0), pvpValue: Number(offer.components.flight.finalPrice || 0),
          discountPercent: 0, paid: false, notes: 'Voo escolhido no construtor de viagem. Revalidar oferta Duffel antes de emissão.'
        });
      }
    } else if (offer.hotel) {
      serviceLines.push({
        id: id('svc'), createdAt: now(), reservationId: reservation.id, type: offer.productType === 'PACKAGE' || offer.productType === 'PACOTE' ? 'PACOTE' : 'ALOJAMENTO',
        description: offer.board ? `${offer.hotel} - ${offer.board}` : offer.hotel,
        status: 'NAO_CONFIRMADO', supplierName: offer.operator || '', reference: offer.hbx?.hotelCode || '', locator: '', quantity: 1,
        dateStart: offer.checkin || '', dateEnd: offer.checkout || '', netValue: costPrice || 0, pvpValue: finalPrice,
        discountPercent: 0, paid: false, notes: 'Linha criada automaticamente a partir da oferta escolhida no checkout.'
      });
    }

    if (offer.components?.transfer) {
      const t = offer.components.transfer;
      serviceLines.push({
        id: id('svc'), createdAt: now(), reservationId: reservation.id, type: 'TRANSFER',
        description: t.title || t.payload?.vehicle || 'Transfer aeroporto - hotel', status: 'NAO_CONFIRMADO',
        supplierName: 'HBX Transfers', reference: t.payload?.rateKey || '', locator: '', quantity: 1,
        dateStart: offer.checkin || '', dateEnd: offer.checkout || '', netValue: Number(t.costPrice || 0), pvpValue: Number(t.finalPrice || 0),
        discountPercent: 0, paid: false, notes: 'Transfer selecionado pelo cliente no construtor de viagem.'
      });
    }
    for (const a of (offer.components?.activities || [])) {
      serviceLines.push({
        id: id('svc'), createdAt: now(), reservationId: reservation.id, type: 'TOUR',
        description: a.name || a.payload?.name || 'Atividade', status: 'NAO_CONFIRMADO', supplierName: 'HBX Activities',
        reference: a.payload?.code || '', locator: '', quantity: 1, dateStart: offer.checkin || '', dateEnd: offer.checkout || '',
        netValue: Number(a.costPrice || 0), pvpValue: Number(a.finalPrice || 0), discountPercent: 0, paid: false,
        notes: 'Experiência selecionada pelo cliente no construtor de viagem.'
      });
    }
    const payment = {
      ...(resumedPayment || {}),
      id: resumedPayment?.id || id('pay'),
      createdAt: resumedPayment?.createdAt || now(),
      updatedAt: resumedPayment ? now() : undefined,
      reservationId: reservation.id,
      method: paymentMethod(body.paymentMethod),
      amount: offer.finalPrice,
      status: 'PENDING',
      // Referências simuladas só existem em PAYMENTS_MODE=mock. Em modos
      // reais/desligados a referência/URL tem de vir do gateway quando a
      // criação efetiva do pagamento estiver implementada.
      reference: paymentsMode(process.env) === 'mock' ? crypto.randomInt(100000000, 999999999).toString() : '',
      expiresAt: new Date(Date.now() + 86400000).toISOString()
    };
    if (resumedPayment) {
      delete payment.gateway;
      delete payment.gatewaySessionId;
      delete payment.gatewaySession;
      payment.reference = paymentsMode(process.env) === 'mock' ? payment.reference || crypto.randomInt(100000000, 999999999).toString() : '';
    }

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
      if (resumedReservation) {
        const reservationIndex = d.reservations.findIndex(item => item.id === reservation.id);
        const paymentIndex = d.payments.findIndex(item => item.id === payment.id);
        if (reservationIndex < 0 || paymentIndex < 0) return;
        d.reservations[reservationIndex] = reservation;
        d.payments[paymentIndex] = payment;
        d.serviceLines = d.serviceLines.filter(line => line.reservationId !== reservation.id || line.status !== 'NAO_CONFIRMADO');
      } else {
        d.reservations.unshift(reservation);
        d.payments.unshift(payment);
      }
      for (const serviceLine of serviceLines) {
        d.serviceLines.push(serviceLine);
        d.reservationEvents.unshift({ id: id('evt'), createdAt: now(), reservationId: reservation.id, actor: 'site', type: 'SERVICE_ADDED', description: `${serviceLine.description} (linha automatica do checkout)` });
      }
      let existing = d.customers.find(c => c.email === customer.email);
      if (!existing && customer.email) d.customers.unshift({ id: id('cli'), createdAt: now(), ...customer });
      if (idemKey) d.idempotencyKeys[idemKey] = { reservationId: reservation.id, paymentId: payment.id, createdAt: now() };
      audit(d, verifiedEmail, resumedReservation ? 'CHECKOUT_RESUMED' : 'CHECKOUT_CREATED', { reservationId: reservation.id, paymentId: payment.id, idempotencyKey: idemKey || null });
      resultPayload = { reservation, payment, idempotent: false, resumed: Boolean(resumedReservation) };
    });
    const mode = paymentsMode(process.env);
    const next = mode === 'mock'
      ? 'Ambiente de teste: confirmar o pagamento simulado no passo seguinte.'
      : mode === 'disabled'
        ? 'Pagamento real ainda não está disponível neste deployment. Não trate esta reserva como paga.'
        : 'Aguardar confirmação autenticada do gateway; o browser nunca marca o pagamento como pago.';
    if (!resultPayload) return json(res, 409, { ok: false, error: 'O estado da reserva mudou durante o checkout. Atualize a página.' });
    return json(res, 200, { ok: true, ...resultPayload, reservation: safeReservation(resultPayload.reservation), payment: safePayment(resultPayload.payment), paymentsMode: mode, next });
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
      p.updatedAt = now();
      if (p.gatewaySession?.method && p.gatewaySession.method !== method) {
        delete p.gatewaySession;
        delete p.gatewaySessionId;
        delete p.gateway;
      }
      const currentReservation = d.reservations.find(item => item.id === reservation.id);
      if (currentReservation?.offer?._paymentSessions?.[p.id]?.method !== method) {
        delete currentReservation?.offer?._paymentSessions?.[p.id];
      }
      updated = { ...p };
      audit(d, customerEmail, 'PAYMENT_METHOD_SELECTED', { reservationId: reservation.id, paymentId: p.id, method });
    });
    return json(res, 200, { ok: true, payment: safePayment(updated) });
  });

  router.post('/api/payment/session', async (req, res) => {
    const limited = rateLimit(req, res, 'payment-session', 20, 60 * 1000);
    if (limited) return limited;
    if (!gatewayPaymentsEnabled(process.env)) {
      return json(res, 409, { ok: false, error: `A criação de sessões reais está desativada (modo ${paymentsMode(process.env)}).` });
    }
    const body = await parseBody(req);
    const db = ensureCollections(await readDb());
    const payment = db.payments.find(p => p.id === cleanText(body.paymentId || '', 120));
    if (!payment) return json(res, 404, { ok: false, error: 'Pagamento não encontrado.' });
    const reservation = db.reservations.find(r => r.id === payment.reservationId);
    if (!reservation) return json(res, 404, { ok: false, error: 'Reserva não encontrada.' });
    const customerEmail = customerSessionEmail(req);
    if (!customerEmail || customerEmail !== reservation.customer?.email) return unauthorized(res);
    if (payment.status === 'PAID') return json(res, 409, { ok: false, code: 'ALREADY_PAID', error: 'Este pagamento já está confirmado.' });
    if (payment.status !== 'PENDING') return json(res, 409, { ok: false, error: 'Este pagamento já não pode ser iniciado.' });

    // O espelho interno na reserva mantem a reutilizacao operacional mesmo
    // durante a janela em que o Supabase ainda nao recebeu as colunas novas
    // de payments. Nunca e incluido nas vistas publicas/do cliente.
    const existing = payment.gatewaySession || reservation.offer?._paymentSessions?.[payment.id];
    if (existing?.sessionId && existing?.method === payment.method && existing?.expiresAt && new Date(existing.expiresAt).getTime() > Date.now() + 60_000) {
      return json(res, 200, { ok: true, session: existing, payment: safePayment(payment), reused: true });
    }

    const adapter = paymentGateways?.forMethod?.(payment.method);
    if (!adapter?.isConfigured?.()) return json(res, 503, { ok: false, error: `Não existe um gateway configurado para ${payment.method}.` });
    let session;
    try {
      const baseUrl = publicBaseUrl();
      session = await adapter.createCheckout({
        payment,
        reservation,
        customer: reservation.customer,
        method: payment.method,
        successUrl: `${baseUrl}/conta/?payment=success&paymentId=${encodeURIComponent(payment.id)}&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${baseUrl}/conta/?payment=cancelled&paymentId=${encodeURIComponent(payment.id)}`
      });
    } catch (err) {
      return json(res, 502, { ok: false, code: err.code || 'PAYMENT_GATEWAY_ERROR', error: err.message || 'Não foi possível abrir o pagamento.' });
    }

    session.method = payment.method;
    let updated;
    await updateDb(d => {
      ensureCollections(d);
      const p = d.payments.find(x => x.id === payment.id);
      if (!p || p.status !== 'PENDING') return;
      p.gateway = session.gateway;
      p.gatewaySessionId = session.sessionId;
      p.gatewaySession = session;
      p.updatedAt = now();
      const currentReservation = d.reservations.find(item => item.id === reservation.id);
      if (currentReservation) {
        currentReservation.offer = currentReservation.offer && typeof currentReservation.offer === 'object' ? currentReservation.offer : {};
        currentReservation.offer._paymentSessions = currentReservation.offer._paymentSessions && typeof currentReservation.offer._paymentSessions === 'object' ? currentReservation.offer._paymentSessions : {};
        currentReservation.offer._paymentSessions[p.id] = session;
        currentReservation.updatedAt = now();
      }
      updated = { ...p };
      audit(d, customerEmail, 'PAYMENT_SESSION_CREATED', { reservationId: reservation.id, paymentId: p.id, gateway: session.gateway, sessionId: session.sessionId });
    });
    if (!updated) return json(res, 409, { ok: false, error: 'O estado do pagamento mudou enquanto a sessão era criada.' });
    return json(res, 200, { ok: true, session, payment: safePayment(updated), reused: false });
  });

  router.get('/api/payment/status', async (req, res, url) => {
    const db = ensureCollections(await readDb());
    const paymentId = cleanText(url.searchParams.get('paymentId') || '', 120);
    const payment = db.payments.find(p => p.id === paymentId);
    if (!payment) return json(res, 404, { ok: false, error: 'Pagamento não encontrado.' });
    const reservation = db.reservations.find(r => r.id === payment.reservationId);
    const customerEmail = customerSessionEmail(req);
    if (!customerEmail || customerEmail !== reservation?.customer?.email) return unauthorized(res);
    return json(res, 200, { ok: true, payment: safePayment(payment), reservation: { id: reservation.id, status: reservation.status, destination: reservation.offer?.destination || '' } });
  });

  router.post('/api/payment/confirm', async (req, res) => {
    const limited = rateLimit(req, res, 'payment-confirm', 40, 60 * 1000);
    if (limited) return limited;
    if (!mockPaymentsAllowed(process.env)) {
      return json(res, 405, { ok: false, error: `Confirmacao manual de pagamento desativada (modo ${paymentsMode(process.env)}). O estado pago deve vir do gateway.` });
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
    return json(res, 200, { ok: true, payment: safePayment(result.payment), reservation: safeReservation(result.reservation), next: result.next, idempotent: result.idempotent, invoice: result.invoice ? { ok: result.invoice.ok, reason: result.invoice.reason } : undefined });
  });
};
