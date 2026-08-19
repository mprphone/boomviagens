const assert = require('assert');
const fs = require('fs');
const { missingDocumentsFor, customerReservationView } = require('../src/domain');
const createOfferRevalidation = require('../src/offerRevalidation');
const createOfferTokenService = require('../src/offerTokenService');
const { sealToken, openToken } = require('../src/auth');
const { gatewayPaymentsEnabled } = require('../src/runtimeConfig');
const { StripeGatewayAdapter, EasyPayGatewayAdapter, PaymentGatewayRegistry } = require('../src/paymentGatewayAdapters');

function testCustomerJourneyStructure() {
  const css = fs.readFileSync('public/css/app.css', 'utf8');
  const results = fs.readFileSync('public/js/results.js', 'utf8');
  const billing = fs.readFileSync('public/js/checkout/billingStep.js', 'utf8');
  const payment = fs.readFileSync('public/js/checkout/paymentStep.js', 'utf8');
  const sessionGuard = fs.readFileSync('public/js/sessionGuard.js', 'utf8');
  const accountReservations = fs.readFileSync('public/conta/js/reservations.js', 'utf8');
  const accountPayments = fs.readFileSync('public/conta/js/payments.js', 'utf8');
  const accountMain = fs.readFileSync('public/conta/js/main.js', 'utf8');
  const accountAuth = fs.readFileSync('public/conta/js/auth.js', 'utf8');
  const accountUtils = fs.readFileSync('public/conta/js/utils.js', 'utf8');
  const accountHtml = fs.readFileSync('public/conta/index.html', 'utf8');
  const customerRoutes = fs.readFileSync('src/routes/customerRoutes.js', 'utf8');
  const documents = fs.readFileSync('public/conta/js/documents.js', 'utf8');

  assert(css.includes('.results-layout.is-empty') && results.includes("classList.toggle('is-empty'"), 'Resultados vazios precisam de um layout proprio');
  assert(billing.includes('/api/customer/login/password') && billing.includes('Sessão ativa'), 'Checkout deve reutilizar uma sessao autenticada e permitir password a clientes existentes');
  assert(sessionGuard.includes('BroadcastChannel') && sessionGuard.includes('clearCustomerScopedBrowserState'), 'Mudancas de conta entre separadores devem invalidar estado local antigo');
  assert(accountMain.includes('revisionAtStart !== sessionRevision') && accountAuth.includes('await onSuccess(data)') && accountUtils.includes("credentials: 'same-origin'"), 'Login deve conservar o cookie e ignorar verificacoes de sessao anteriores ao POST, sobretudo em redes moveis');
  assert(accountHtml.includes('method="post" action="/api/customer/login/password"') && accountHtml.includes("history.replaceState") && accountHtml.includes("'password'"), 'Credenciais nunca podem ser submetidas por GET nem permanecer no URL/historico quando o JavaScript falha');
  assert(customerRoutes.includes("res.writeHead(303") && customerRoutes.includes("Location: '/conta/'") && customerRoutes.includes('isBrowserForm(req)'), 'Login HTML sem JavaScript deve criar a sessao e redirecionar para a area reservada, nunca mostrar JSON');
  assert(accountReservations.includes('/api/customer/reservations/resume') && accountPayments.includes('resumeReservationById'), 'Reservas pendentes devem revalidar antes de continuar');
  assert(accountReservations.includes("'/api/search'") && accountReservations.includes('boom_reservation_alternatives_v1'), 'Ofertas guardadas expiradas devem procurar e apresentar alternativas reais');
  assert(!accountReservations.includes('/api/payment/confirm') && !accountPayments.includes('/api/payment/confirm'), 'A area de cliente nao pode confirmar pagamentos diretamente');
  assert(payment.includes('/api/payment/session') && payment.includes('cdn.easypay.pt') && payment.includes('window.location.assign'), 'Checkout deve criar sessoes reais Stripe/Easypay');
  assert(documents.includes('IDENTITY_CARD') && documents.includes('documentNumber') && documents.includes('expiryDate') && documents.includes('passengerId'), 'Documentos de identidade devem estar separados, validados e associados a passageiros');
  assert(documents.includes('filter(document => !document.reusable)') && documents.includes('Cofre da família'), 'Documentos pessoais reutilizaveis devem aparecer uma vez no cofre, nao repetidos em cada reserva');
}

function testIdentityDocuments() {
  const reservation = {
    id: 'res_1',
    customer: { email: 'cliente@example.pt', name: 'Marco Rebelo' },
    offer: { checkout: '2027-09-20' },
    passengers: [
      { passengerId: 'p_1', name: 'Marco', surname: 'Rebelo', documentType: 'IDENTITY_CARD' },
      { passengerId: 'p_2', name: 'Ana', surname: 'Rebelo', documentType: 'PASSPORT' }
    ]
  };
  const documents = [
    { id: 'd_1', customerEmail: 'cliente@example.pt', type: 'IDENTITY_CARD', passengerId: 'p_1', passengerName: 'Marco Rebelo', documentNumber: '12345678', expiryDate: '2030-01-01', issuingCountry: 'PT' },
    { id: 'd_2', customerEmail: 'cliente@example.pt', type: 'PASSPORT', passengerId: 'p_2', passengerName: 'Ana Rebelo', documentNumber: 'P123456', expiryDate: '2031-01-01', issuingCountry: 'PT' },
    { id: 'd_3', reservationId: 'res_1', type: 'INSURANCE' }
  ];
  assert.deepEqual(missingDocumentsFor(reservation, documents), [], 'Documentos familiares completos devem ser reutilizados na reserva');

  const incomplete = documents.map(document => document.id === 'd_1' ? { ...document, expiryDate: '' } : document);
  assert(missingDocumentsFor(reservation, incomplete).some(value => /Completar dados.*Cartao|Completar dados.*Cartão/.test(value)), 'Metadados incompletos nao podem validar um Cartao de Cidadao');

  const expired = documents.map(document => document.id === 'd_2' ? { ...document, expiryDate: '2027-01-01' } : document);
  assert(missingDocumentsFor(reservation, expired).some(value => /Renovar Passaporte/.test(value)), 'Documento que caduca antes do regresso deve ser recusado');
}

function testCustomerDataSanitization() {
  const view = customerReservationView({
    id: 'res_1', status: 'PENDING_PAYMENT', customer: { email: 'cliente@example.pt' },
    offer: { destination: 'Madrid', finalPrice: 850, costPrice: 400, marginPercent: 112.5, hbx: { rateKey: 'secret' } },
    passengers: []
  }, {});
  const serialized = JSON.stringify(view);
  assert(!serialized.includes('costPrice') && !serialized.includes('marginPercent') && !serialized.includes('rateKey'), 'Area de cliente nao pode expor custos, margens ou referencias internas');
}

async function testLiveRevalidation() {
  const duffel = { isConfigured: () => true, getOffer: async () => ({ id: 'flight_new', totalAmount: 120, totalCurrency: 'EUR' }) };
  const hbx = { isConfigured: product => product === 'hotels', checkRate: async () => ({ rateKey: 'hotel_new', rateType: 'BOOKABLE', roomCode: 'DBL', net: 300 }) };
  const applyMargin = amount => ({ costPrice: Number(amount), finalPrice: Number((Number(amount) * 1.1).toFixed(2)) });
  const revalidation = createOfferRevalidation({ duffel, hbx, applyMargin, env: { CURRENCY: 'EUR' } });
  const offer = {
    destination: 'Madrid',
    components: {
      flight: { offerId: 'flight_old', costPrice: 100, finalPrice: 110 },
      hotel: { provider: 'HBX', rateKey: 'hotel_old', rateType: 'RECHECK', costPrice: 250, finalPrice: 275 },
      transfer: { costPrice: 50, finalPrice: 55 },
      activities: []
    }
  };
  await assert.rejects(() => revalidation.revalidate(offer, [], { forceHotelCheck: true }), error => error.code === 'SUPPLIER_PRICE_CHANGED');
  const result = await revalidation.revalidate(offer, [], { allowPriceChange: true, forceHotelCheck: true });
  assert.equal(result.changes.length, 2);
  assert.equal(result.offer.components.hotel.rateKey, 'hotel_new');
  assert.equal(result.offer.finalPrice, 517);
  assert.equal(result.offer.costPrice, 470);

  let unexpectedHotelCheck = false;
  const nonHbx = createOfferRevalidation({ duffel, hbx: { isConfigured: () => true, checkRate: async () => { unexpectedHotelCheck = true; } }, applyMargin, env: { CURRENCY: 'EUR' } });
  await nonHbx.revalidate({ destination: 'Madrid', components: { hotel: { provider: 'Outro operador', finalPrice: 200, costPrice: 180 }, activities: [] } }, [], { allowPriceChange: true, forceHotelCheck: true });
  assert.equal(unexpectedHotelCheck, false, 'Um hotel sem rateKey HBX nao pode ser enviado para o endpoint Hotelbeds');

  const expiredDuffel = createOfferRevalidation({
    duffel: { isConfigured: () => true, getOffer: async () => { throw Object.assign(new Error('HTTP 404'), { status: 404 }); } },
    hbx, applyMargin, env: { CURRENCY: 'EUR' }
  });
  await assert.rejects(
    () => expiredDuffel.revalidate({ destination: 'Madrid', components: { flight: { offerId: 'off_expired', finalPrice: 100 }, activities: [] } }, [], { allowPriceChange: true }),
    error => error.code === 'DUFFEL_OFFER_EXPIRED' && /nova pesquisa/i.test(error.message)
  );
}

function testSealedResumeOffer() {
  const service = createOfferTokenService({ sealToken });
  const safe = service.publicOffer({ id: 'off_1', destination: 'Madrid', finalPrice: 850, costPrice: 500, hbx: { rateKey: 'secret-rate' } }, {
    resumeReservationId: 'res_1', resumeCustomerEmail: 'cliente@example.pt', resume: { checkedAt: '2026-08-18T12:00:00Z' }
  });
  assert.equal(safe.costPrice, undefined);
  assert.equal(safe.hbx, undefined);
  assert(!JSON.stringify(safe).includes('secret-rate'));
  const sealed = openToken(safe.offerToken);
  assert.equal(sealed.resumeReservationId, 'res_1');
  assert.equal(sealed.resumeCustomerEmail, 'cliente@example.pt');
}

async function testGatewayCheckoutContracts() {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/single/')) {
      return { ok: true, status: 200, json: async () => ({ id: 'easy-single-1', payment_status: 'paid', key: 'pay_1', value: 85, currency: 'EUR' }) };
    }
    const stripe = String(url).includes('stripe.com');
    const payload = stripe
      ? { id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1', expires_at: 1800000000 }
      : { id: 'easypay_checkout_1', session: 'signed-session' };
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
  };
  try {
    const stripe = new StripeGatewayAdapter({ STRIPE_SECRET_KEY: 'sk_test_audit', STRIPE_WEBHOOK_SECRET: 'whsec_audit', STRIPE_MODE: 'test' });
    const easypay = new EasyPayGatewayAdapter({ EASYPAY_ACCOUNT_ID: 'account', EASYPAY_API_KEY: 'key', EASYPAY_BASE_URL: 'https://api.test.easypay.pt/2.0' });
    const registry = new PaymentGatewayRegistry([stripe, easypay]);
    assert.equal(gatewayPaymentsEnabled({ PAYMENTS_MODE: 'gateway' }), true);
    const methodIds = registry.publicMethods().map(method => method.id.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
    assert.deepEqual(methodIds, ['MB WAY', 'Referencia Multibanco', 'Cartao']);
    const base = { payment: { id: 'pay_1', amount: 85 }, reservation: { id: 'res_1', offer: { destination: 'Madrid' } }, customer: { email: 'cliente@example.pt' } };
    const stripeSession = await stripe.createCheckout({ ...base, successUrl: 'https://boom.example/success', cancelUrl: 'https://boom.example/cancel', method: 'Cartao' });
    assert.equal(stripeSession.display, 'redirect');
    assert.equal(stripeSession.testing, true);
    const stripeBody = new URLSearchParams(calls[0].options.body);
    assert.equal(stripeBody.get('metadata[paymentId]'), 'pay_1');
    assert.equal(stripeBody.get('line_items[0][price_data][unit_amount]'), '8500');

    const easySession = await easypay.createCheckout({ ...base, method: 'MB WAY' });
    assert.equal(easySession.display, 'embedded');
    const easyBody = JSON.parse(calls[1].options.body);
    assert.deepEqual(easyBody.payment.methods, ['mbw']);
    assert.equal(easyBody.payment.capture.transaction_key, 'pay_1');
    assert.equal(easyBody.order.key, 'pay_1');
    const verifiedWebhook = await easypay.handleWebhook(JSON.stringify({ id: 'easy-single-1', key: 'pay_1' }));
    assert.equal(verifiedWebhook.paymentId, 'pay_1');
    assert.equal(verifiedWebhook.amount, 85);
    global.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(() => easypay.handleWebhook(JSON.stringify({ id: 'easy-single-1', key: 'pay_1' })), /verificar a notificação/);
  } finally {
    global.fetch = originalFetch;
  }
}

async function run() {
  testCustomerJourneyStructure();
  testIdentityDocuments();
  testCustomerDataSanitization();
  await testLiveRevalidation();
  testSealedResumeOffer();
  await testGatewayCheckoutContracts();
  console.log('OK - V9: sessoes, documentos, revalidacao, privacidade e pagamentos reais');
}

run().catch(error => { console.error(error); process.exit(1); });
