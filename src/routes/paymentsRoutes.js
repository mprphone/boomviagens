// Webhooks de gateways de pagamento externos. Hoje so a Stripe - o
// checkout continua 100% simulado (PAYMENTS_MODE=mock), nada ainda cria
// sessoes de pagamento Stripe a serio, por isso nenhum evento real chega
// aqui ainda. Construido para, quando essa outra parte existir (usando
// metadata.paymentId na sessao/PaymentIntent, o padrao standard da Stripe
// para ligar de volta a um registo interno), confirmar o pagamento e emitir
// a fatura automaticamente sem precisar de ser revisitado.

const { verifyStripeSignature } = require('../stripeSignature');

// Eventos que, uma vez o metadata.paymentId resolvido, valem como "dinheiro
// recebido" - qualquer outro tipo e reconhecido (200) mas ignorado.
const PAID_EVENT_TYPES = new Set(['checkout.session.completed', 'payment_intent.succeeded']);

module.exports = function registerPaymentsRoutes(router, ctx) {
  const { json, readRawBody, readDb, domain, paymentConfirmation } = ctx;
  const { ensureCollections } = domain;

  router.post('/api/payments/stripe/webhook', async (req, res) => {
    const rawBody = await readRawBody(req);
    try {
      verifyStripeSignature(rawBody, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      // Nunca processa o corpo sem assinatura valida - sem isto, qualquer
      // pessoa conseguia forjar um "pagamento confirmado" so por adivinhar
      // um paymentId.
      return json(res, 400, { ok: false, error: `Webhook signature: ${err.message}` });
    }

    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return json(res, 400, { ok: false, error: 'Corpo do evento não é JSON válido' });
    }

    if (PAID_EVENT_TYPES.has(event.type)) {
      const paymentId = event.data?.object?.metadata?.paymentId;
      if (paymentId) {
        const db = ensureCollections(await readDb());
        const payment = db.payments.find(p => p.id === paymentId);
        // Idempotente por natureza (mesmo principio de invoicing.js): se ja
        // estiver PAID, confirmPayment() nao volta a processar nada demais
        // (so o pagamento fica sem novo paidAt) e issueInvoiceForPayment()
        // ja tem a sua propria idempotencia por documento existente - retries
        // da Stripe para o mesmo evento nunca duplicam nada.
        if (payment) await paymentConfirmation.confirmPayment(paymentId);
      }
    }
    // A Stripe desativa o endpoint depois de demasiadas respostas nao-2xx,
    // mesmo para tipos de evento que nao nos interessam - responde sempre
    // 200 uma vez a assinatura verificada.
    return json(res, 200, { received: true });
  });
};
