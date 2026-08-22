// Testes das automatizacoes de backoffice: email de pedido de documentos na
// transicao para AWAITING_DOCUMENTS e o cron de lembretes. Corre tudo em
// memoria (sem ficheiro nem Supabase) com mailer em modo mock - mesmo
// padrao dos outros scripts/test-*.js, sem dependencias novas.
const assert = require('assert');
const { createRouter } = require('../src/http/router');
const { json, parseBody } = require('../src/httpUtils');
const domain = require('../src/domain');
const { reservationEmail, documentRequestEmail } = require('../src/emailTemplates');
const registerAdminRoutes = require('../src/routes/adminRoutes');
const registerCronRoutes = require('../src/routes/cronRoutes');

process.env.CRON_SECRET = 'segredo-cron-teste';

const DOC_SUBJECT = 'ocumentos em falta';

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

function makeReservation(id, status, extra = {}) {
  return {
    id,
    status,
    createdAt: daysAgo(30),
    updatedAt: daysAgo(30),
    customer: { email: `cliente.${id}@example.pt`, name: 'Marco Rebelo' },
    offer: { hotel: 'Hotel Teste', destination: 'Madrid', finalPrice: 850, checkout: '2027-09-20' },
    passengers: [{ passengerId: `${id}_p1`, name: 'Marco', surname: 'Rebelo', documentType: 'PASSPORT' }],
    ...extra
  };
}

// req/res minimos: parseBody le de um stream; json() escreve com
// writeHead/end. Chega para exercitar os handlers reais das rotas.
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

function makeCtx(db, mailCalls) {
  return {
    json,
    parseBody,
    readDb: async () => db,
    updateDb: async mutator => (mutator(db) || db),
    storage: { pruneOldRows: async () => ({ skipped: true }) },
    operators: { getForOffer: () => null },
    cleanText: (value, max) => String(value || '').slice(0, max || 500),
    numberInRange: value => Number(value) || 0,
    domain,
    fileStorage: {},
    reservationEmail,
    documentRequestEmail,
    invoicing: {},
    mailer: {
      isConfigured: () => false,
      sendMail: async mail => { mailCalls.push(mail); return { mode: 'mock', sent: false }; }
    },
    auth: {
      sessionUser: () => 'admin@boomviagens.pt',
      sessionStaff: () => ({ id: 'staff_1', role: 'ADMIN', active: true })
    }
  };
}

function docEmails(db) {
  return db.emails.filter(email => String(email.subject || '').includes(DOC_SUBJECT));
}

async function testTransitionSendsExactlyOneEmail() {
  const db = domain.ensureCollections({ reservations: [makeReservation('res_1', 'CONFIRMED')] });
  const mailCalls = [];
  const router = createRouter();
  registerAdminRoutes(router, makeCtx(db, mailCalls));
  const update = router.find('POST', '/api/admin/reservations/update').handler;

  const res = fakeRes();
  await update(fakeReq({ reservationId: 'res_1', status: 'AWAITING_DOCUMENTS' }), res, new URL('http://teste.local/'));
  assert.equal(res.body.ok, true);
  assert.equal(db.reservations[0].status, 'AWAITING_DOCUMENTS');
  assert.ok(db.reservations[0].awaitingDocumentsSince, 'A transicao tem de marcar awaitingDocumentsSince para o cron');
  assert.equal(docEmails(db).length, 1, 'A transicao para AWAITING_DOCUMENTS envia exatamente um email de documentos');
  assert.ok(docEmails(db)[0].body.includes('Passaporte de Marco Rebelo'), 'O email lista os documentos em falta');
  assert.ok(docEmails(db)[0].body.includes('Seguro de viagem'), 'O email inclui o seguro em falta');
  assert.equal(mailCalls.filter(mail => mail.subject.includes(DOC_SUBJECT)).length, 1, 'O envio real (sendMail) acontece fora do mutator, uma vez');

  // Updates repetidos ao mesmo estado (ou a outro estado qualquer) nao
  // voltam a enviar o pedido de documentos.
  await update(fakeReq({ reservationId: 'res_1', status: 'AWAITING_DOCUMENTS', notes: 'nota interna' }), fakeRes(), new URL('http://teste.local/'));
  await update(fakeReq({ reservationId: 'res_1', status: 'READY' }), fakeRes(), new URL('http://teste.local/'));
  assert.equal(docEmails(db).length, 1, 'Updates repetidos nao podem fazer spam ao cliente');

  // Sair e voltar a entrar no estado e uma transicao nova - o cliente pode
  // ter documentos novos em falta, por isso ha novo pedido.
  await update(fakeReq({ reservationId: 'res_1', status: 'AWAITING_DOCUMENTS' }), fakeRes(), new URL('http://teste.local/'));
  assert.equal(docEmails(db).length, 2, 'Voltar a entrar em AWAITING_DOCUMENTS e uma transicao nova');
}

async function testCronDocumentReminders() {
  const db = domain.ensureCollections({
    reservations: [
      makeReservation('res_stale', 'AWAITING_DOCUMENTS', { awaitingDocumentsSince: daysAgo(4) }),
      makeReservation('res_cooldown', 'AWAITING_DOCUMENTS', { awaitingDocumentsSince: daysAgo(10) }),
      makeReservation('res_fresh', 'AWAITING_DOCUMENTS', { awaitingDocumentsSince: daysAgo(1) }),
      makeReservation('res_other', 'CONFIRMED')
    ],
    reservationEvents: [
      { id: 'evt_old', createdAt: daysAgo(1), reservationId: 'res_cooldown', actor: 'sistema', type: 'DOCUMENT_REMINDER_SENT', description: 'lembrete anterior' }
    ]
  });
  const mailCalls = [];
  const router = createRouter();
  registerCronRoutes(router, makeCtx(db, mailCalls));
  const cron = router.find('GET', '/api/cron/document-reminders').handler;
  const url = new URL('http://teste.local/api/cron/document-reminders');

  const unauthorizedRes = fakeRes();
  await cron(fakeReq(null), unauthorizedRes, url);
  assert.equal(unauthorizedRes.status, 401, 'Sem CRON_SECRET a rota recusa (fail closed)');

  const first = fakeRes();
  await cron(fakeReq(null, { authorization: 'Bearer segredo-cron-teste' }), first, url);
  assert.deepEqual({ ok: first.body.ok, sent: first.body.sent, skipped: first.body.skipped }, { ok: true, sent: 1, skipped: 2 }, 'So a reserva stale ha mais de 3 dias recebe lembrete');
  assert.equal(mailCalls.length, 1);
  assert.ok(mailCalls[0].subject.startsWith('Lembrete:'), 'O lembrete do cron tem assunto proprio');
  assert.ok(mailCalls[0].to.includes('res_stale'), 'O lembrete vai para o cliente certo');
  assert.ok(db.reservationEvents.some(e => e.type === 'DOCUMENT_REMINDER_SENT' && e.reservationId === 'res_stale'), 'O lembrete fica registado em reservation_events');
  assert.equal(docEmails(db).length, 1, 'O lembrete tambem fica no registo de emails');

  // Segunda corrida imediata: a reserva stale fica em cooldown, ninguem
  // recebe nada.
  const second = fakeRes();
  await cron(fakeReq(null, { authorization: 'Bearer segredo-cron-teste' }), second, url);
  assert.equal(second.body.sent, 0, 'O cooldown de 3 dias impede lembretes repetidos');
  assert.equal(second.body.skipped, 3);
  assert.equal(mailCalls.length, 1);
}

async function run() {
  await testTransitionSendsExactlyOneEmail();
  await testCronDocumentReminders();
  console.log('OK - automatizacoes: pedido de documentos na transicao + cron de lembretes com cooldown');
}

run().catch(error => { console.error(error); process.exit(1); });
