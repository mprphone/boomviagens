// Testes da reconciliacao de pagamentos (cron /api/cron/payment-reconciliation)
// e das notificacoes proativas ao cliente (cron /api/cron/customer-notifications
// + email de voucher). Corre tudo em memoria (sem ficheiro nem Supabase) com
// mailer e gateways em modo mock - mesmo padrao de scripts/test-automations.js,
// sem dependencias novas.
const assert = require('assert');
const { createRouter } = require('../src/http/router');
const { json, parseBody } = require('../src/httpUtils');
const domain = require('../src/domain');
const { paymentReminderEmail, tripReminderEmail, voucherEmail } = require('../src/emailTemplates');
const registerCronRoutes = require('../src/routes/cronRoutes');
const createPaymentReconciliation = require('../src/paymentReconciliation');
const createCustomerNotifications = require('../src/customerNotifications');
const createVoucherIssuing = require('../src/voucherIssuing');

process.env.CRON_SECRET = 'segredo-cron-teste';

function hoursAgo(n) {
  return new Date(Date.now() - n * 60 * 60 * 1000).toISOString();
}

function daysFromNow(n) {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function makeReservation(id, status, extra = {}) {
  return {
    id,
    status,
    createdAt: hoursAgo(72),
    updatedAt: hoursAgo(72),
    customer: { email: `cliente.${id}@example.pt`, name: 'Marco Rebelo' },
    offer: { hotel: 'Hotel Teste', destination: 'Madrid', finalPrice: 850, checkin: daysFromNow(30), checkout: daysFromNow(37) },
    passengers: [],
    ...extra
  };
}

function makePayment(id, reservationId, extra = {}) {
  return {
    id,
    reservationId,
    method: 'Cartão',
    amount: 850,
    status: 'PENDING',
    createdAt: hoursAgo(3),
    updatedAt: hoursAgo(3),
    ...extra
  };
}

// req/res minimos - mesmo padrao de scripts/test-automations.js.
function fakeReq(body, headers = {}) {
  return {
    headers: { 'content-type': 'application/json', host: 'teste.local', ...headers },
    socket: { remoteAddress: '127.0.0.1' },
    on(event, cb) {
      if (event === 'data') cb(JSON.stringify(body || {}));
      if (event === 'end') cb();
      return this;
    }
  };
}

function fakeRes() {
  return {
    status: null,
    body: null,
    headersSent: false,
    writeHead(status) { this.status = status; this.headersSent = true; },
    end(payload) { this.body = payload ? JSON.parse(payload) : null; }
  };
}

function makeCtx(db, { mailCalls = [], confirmed = [], gateways = {} } = {}) {
  const ctx = {
    json,
    parseBody,
    readDb: async () => db,
    updateDb: async mutator => (mutator(db) || db),
    storage: { pruneOldRows: async () => ({ skipped: true }) },
    domain,
    // paymentConfirmation falso: regista a chamada e faz a unica parte do
    // fluxo real relevante para estes testes (marcar o pagamento como PAID).
    paymentConfirmation: {
      confirmPayment: async paymentId => {
        confirmed.push(paymentId);
        const payment = db.payments.find(p => p.id === paymentId);
        if (payment) payment.status = 'PAID';
        return { ok: true };
      }
    },
    paymentGateways: { get: name => gateways[name] || null },
    paymentReminderEmail,
    tripReminderEmail,
    voucherEmail,
    mailer: {
      isConfigured: () => false,
      sendMail: async mail => { mailCalls.push(mail); return { mode: 'mock', sent: false }; }
    },
    fileStorage: { uploadFile: async () => {} }
  };
  ctx.paymentReconciliation = createPaymentReconciliation(ctx);
  ctx.customerNotifications = createCustomerNotifications(ctx);
  return ctx;
}

function makeCronRouter(ctx) {
  const router = createRouter();
  registerCronRoutes(router, ctx);
  return router;
}

const AUTH = { authorization: 'Bearer segredo-cron-teste' };

async function testReconciliationMockIsSafe() {
  // Pagamento "mock" (sem gateway nem sessao) nunca pode ser marcado como
  // pago pela reconciliacao, mesmo estando pendente ha dias.
  const db = domain.ensureCollections({
    reservations: [makeReservation('res_mock', 'PENDING_PAYMENT')],
    payments: [makePayment('pay_mock', 'res_mock', { reference: '123456789' })]
  });
  const confirmed = [];
  const router = makeCronRouter(makeCtx(db, { confirmed }));
  const cron = router.find('GET', '/api/cron/payment-reconciliation').handler;
  const url = new URL('http://teste.local/api/cron/payment-reconciliation');

  const unauthorizedRes = fakeRes();
  await cron(fakeReq(null), unauthorizedRes, url);
  assert.equal(unauthorizedRes.status, 401, 'Sem CRON_SECRET a rota recusa (fail closed)');

  const res = fakeRes();
  await cron(fakeReq(null, AUTH), res, url);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.candidates, 0, 'Pagamentos mock (sem sessao de gateway) nem entram na reconciliacao');
  assert.equal(confirmed.length, 0, 'Em modo mock nada e marcado como pago');
  assert.equal(db.payments[0].status, 'PENDING', 'O pagamento mock continua pendente');
}

async function testReconciliationConfirmsVerifiedPayment() {
  const db = domain.ensureCollections({
    reservations: [
      makeReservation('res_old', 'PENDING_PAYMENT'),
      makeReservation('res_fresh', 'PENDING_PAYMENT'),
      makeReservation('res_mismatch', 'PENDING_PAYMENT'),
      makeReservation('res_unconfigured', 'PENDING_PAYMENT')
    ],
    payments: [
      makePayment('pay_old', 'res_old', { gateway: 'Stripe', gatewaySessionId: 'cs_old' }),
      makePayment('pay_fresh', 'res_fresh', { gateway: 'Stripe', gatewaySessionId: 'cs_fresh', createdAt: hoursAgo(1), updatedAt: hoursAgo(1) }),
      makePayment('pay_mismatch', 'res_mismatch', { gateway: 'Stripe', gatewaySessionId: 'cs_mismatch' }),
      makePayment('pay_unconfigured', 'res_unconfigured', { gateway: 'Easypay', gatewaySessionId: 'ep_1' })
    ]
  });
  const confirmed = [];
  const stripe = {
    isConfigured: () => true,
    async verifyPayment(sessionId) {
      if (sessionId === 'cs_old') return { paymentId: 'pay_old', eventId: sessionId, amountMinor: 85000, currency: 'EUR' };
      if (sessionId === 'cs_mismatch') return { paymentId: 'pay_mismatch', eventId: sessionId, amountMinor: 100, currency: 'EUR' };
      return { paymentId: null };
    }
  };
  const easypay = { isConfigured: () => false, verifyPayment: async () => ({ paymentId: 'pay_unconfigured' }) };
  const router = makeCronRouter(makeCtx(db, { confirmed, gateways: { Stripe: stripe, Easypay: easypay } }));
  const cron = router.find('GET', '/api/cron/payment-reconciliation').handler;
  const url = new URL('http://teste.local/api/cron/payment-reconciliation');

  const res = fakeRes();
  await cron(fakeReq(null, AUTH), res, url);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.candidates, 3, 'Candidatos: os pagamentos com sessao de gateway ha mais de 2h (o recente fica de fora)');
  assert.deepEqual(confirmed, ['pay_old'], 'So o pagamento verificado no gateway e confirmado');
  assert.equal(db.payments.find(p => p.id === 'pay_old').status, 'PAID');
  assert.equal(res.body.stillPending, 1, 'Montante divergente nao confirma (mesma barreira do webhook)');
  assert.equal(res.body.skipped, 1, 'Adapter sem credenciais e saltado sem verificar');
  assert.equal(db.payments.find(p => p.id === 'pay_fresh').status, 'PENDING', 'Pagamento com menos de 2h fica de fora da janela');
  assert.ok(db.auditLogs.some(entry => entry.action === 'PAYMENT_RECONCILIATION_RUN'), 'A corrida com efeitos fica auditada');

  // ?hours= ajusta a janela: com 0.5h o pagamento "fresh" ja e candidato,
  // mas o gateway diz que ainda nao esta pago - continua pendente.
  const resHalf = fakeRes();
  await cron(fakeReq(null, AUTH), resHalf, new URL('http://teste.local/api/cron/payment-reconciliation?hours=0.5'));
  assert.equal(resHalf.body.olderThanHours, 0.5);
  assert.equal(resHalf.body.confirmed, 0, 'Sem confirmacao do gateway, nada muda mesmo dentro da janela');
  assert.equal(confirmed.length, 1, 'O pagamento ja confirmado nao volta a ser candidato (ja nao esta PENDING)');
}

async function testPaymentReminderOncePerReservation() {
  const db = domain.ensureCollections({
    reservations: [
      makeReservation('res_stale', 'PENDING_PAYMENT'),
      makeReservation('res_fresh', 'PENDING_PAYMENT', { createdAt: hoursAgo(12), updatedAt: hoursAgo(12) }),
      makeReservation('res_paid', 'PENDING_PAYMENT'),
      makeReservation('res_reminded', 'PENDING_PAYMENT')
    ],
    payments: [
      makePayment('pay_stale', 'res_stale'),
      makePayment('pay_fresh', 'res_fresh', { createdAt: hoursAgo(12), updatedAt: hoursAgo(12) }),
      makePayment('pay_paid', 'res_paid', { status: 'PAID', paidAt: hoursAgo(1) }),
      makePayment('pay_reminded', 'res_reminded')
    ],
    reservationEvents: [
      { id: 'evt_prev', createdAt: hoursAgo(20), reservationId: 'res_reminded', actor: 'sistema', type: 'PAYMENT_REMINDER_SENT', description: 'lembrete anterior' }
    ]
  });
  const mailCalls = [];
  const router = makeCronRouter(makeCtx(db, { mailCalls }));
  const cron = router.find('GET', '/api/cron/customer-notifications').handler;
  const url = new URL('http://teste.local/api/cron/customer-notifications');

  const unauthorizedRes = fakeRes();
  await cron(fakeReq(null), unauthorizedRes, url);
  assert.equal(unauthorizedRes.status, 401, 'Sem CRON_SECRET a rota recusa (fail closed)');

  const first = fakeRes();
  await cron(fakeReq(null, AUTH), first, url);
  assert.equal(first.body.ok, true);
  assert.equal(first.body.paymentReminders.sent, 1, 'So a reserva pendente ha mais de 24h e ainda nao lembrada recebe email');
  assert.equal(mailCalls.length, 1);
  assert.ok(mailCalls[0].to.includes('res_stale'), 'O lembrete vai para a cliente certa');
  assert.ok(mailCalls[0].body.includes('/conta/'), 'O lembrete aponta para a Area de Cliente');
  assert.ok(db.reservationEvents.some(e => e.type === 'PAYMENT_REMINDER_SENT' && e.reservationId === 'res_stale'), 'O envio fica registado em reservation_events');
  assert.ok(db.emails.some(e => e.subject.includes('pagamento pendente')), 'O lembrete fica no registo de emails');

  // Segunda corrida: a unica elegivel ja foi lembrada - zero envios.
  const second = fakeRes();
  await cron(fakeReq(null, AUTH), second, url);
  assert.equal(second.body.paymentReminders.sent, 0, 'Uma unica vez por reserva - a segunda corrida nao repete');
  assert.equal(mailCalls.length, 1);
}

async function testTripAlertOncePerReservation() {
  const db = domain.ensureCollections({
    reservations: [
      makeReservation('res_soon', 'CONFIRMED', { offer: { hotel: 'Hotel Teste', destination: 'Madrid', finalPrice: 850, checkin: daysFromNow(5), checkout: daysFromNow(12) }, operatorLocator: 'LOC123' }),
      makeReservation('res_far', 'CONFIRMED', { offer: { hotel: 'Hotel Longe', destination: 'Paris', finalPrice: 900, checkin: daysFromNow(30), checkout: daysFromNow(35) } }),
      makeReservation('res_unconfirmed', 'PENDING_PAYMENT', { offer: { hotel: 'Hotel Teste', destination: 'Madrid', finalPrice: 850, checkin: daysFromNow(3), checkout: daysFromNow(8) } }),
      makeReservation('res_alerted', 'CONFIRMED', { offer: { hotel: 'Hotel Teste', destination: 'Madrid', finalPrice: 850, checkin: daysFromNow(2), checkout: daysFromNow(9) } })
    ],
    reservationEvents: [
      { id: 'evt_trip', createdAt: hoursAgo(20), reservationId: 'res_alerted', actor: 'sistema', type: 'TRIP_REMINDER_SENT', description: 'alerta anterior' }
    ]
  });
  const mailCalls = [];
  const router = makeCronRouter(makeCtx(db, { mailCalls }));
  const cron = router.find('GET', '/api/cron/customer-notifications').handler;
  const url = new URL('http://teste.local/api/cron/customer-notifications');

  const first = fakeRes();
  await cron(fakeReq(null, AUTH), first, url);
  assert.equal(first.body.tripAlerts.sent, 1, 'So a reserva CONFIRMED com check-in a 7 dias e ainda nao alertada recebe email');
  const tripMails = mailCalls.filter(mail => mail.subject.includes('viagem aproxima-se'));
  assert.equal(tripMails.length, 1);
  assert.ok(tripMails[0].to.includes('res_soon'), 'O alerta vai para a cliente certa');
  assert.ok(tripMails[0].body.includes('Madrid') && tripMails[0].body.includes('LOC123'), 'O alerta traz o resumo da viagem');
  assert.ok(db.reservationEvents.some(e => e.type === 'TRIP_REMINDER_SENT' && e.reservationId === 'res_soon'), 'O alerta fica registado em reservation_events');

  const second = fakeRes();
  await cron(fakeReq(null, AUTH), second, url);
  assert.equal(second.body.tripAlerts.sent, 0, 'Uma unica vez por reserva - a segunda corrida nao repete');
  assert.equal(mailCalls.filter(mail => mail.subject.includes('viagem aproxima-se')).length, 1);
}

async function testVoucherEmailSentOnIssue() {
  const db = domain.ensureCollections({
    company: { name: 'About Destiny', brand: 'Boomviagens' },
    reservations: [makeReservation('res_voucher', 'CONFIRMED', { operatorLocator: 'HBX-999' })],
    payments: [makePayment('pay_voucher', 'res_voucher', { status: 'PAID', paidAt: hoursAgo(1) })]
  });
  const mailCalls = [];
  const ctx = makeCtx(db, { mailCalls });
  const voucherIssuing = createVoucherIssuing(ctx);

  const result = await voucherIssuing.issueVoucherForReservation('res_voucher', 'pay_voucher');
  assert.equal(result.ok, true, 'O voucher e emitido');
  const voucherMails = mailCalls.filter(mail => mail.subject.includes('Voucher'));
  assert.equal(voucherMails.length, 1, 'O cliente recebe exatamente um email de aviso do voucher');
  assert.ok(voucherMails[0].body.includes('HBX-999') && voucherMails[0].body.includes('/conta/'), 'O aviso tem o localizador e aponta para a Area de Cliente');
  assert.ok(db.emails.some(e => e.subject.includes('Voucher')), 'O aviso fica no registo de emails');

  const again = await voucherIssuing.issueVoucherForReservation('res_voucher', 'pay_voucher');
  assert.equal(again.alreadyIssued, true, 'Reemissao e idempotente');
  assert.equal(mailCalls.filter(mail => mail.subject.includes('Voucher')).length, 1, 'Reemissao nao repete o email');
}

async function run() {
  await testReconciliationMockIsSafe();
  await testReconciliationConfirmsVerifiedPayment();
  await testPaymentReminderOncePerReservation();
  await testTripAlertOncePerReservation();
  await testVoucherEmailSentOnIssue();
  console.log('OK - reconciliacao de pagamentos (mock seguro, verificacao no gateway, janela de horas) + notificacoes ao cliente (uma vez por reserva) + email de voucher');
}

run().catch(error => { console.error(error); process.exit(1); });
