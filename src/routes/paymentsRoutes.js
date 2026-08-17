// Webhooks de gateways de pagamento externos - hoje Stripe e Easypay, ambos
// so recetores (o checkout continua 100% simulado, PAYMENTS_MODE=mock,
// nada ainda cria sessoes/cobrancas a serio, por isso nenhum evento real
// chega aqui ainda). Cada gateway autentica as suas notificacoes de forma
// diferente - toda essa logica fica no adapter respetivo
// (src/paymentGatewayAdapters.js), a rota so le o corpo em bruto e reage ao
// paymentId que o adapter devolver. Um gateway novo no futuro e um adapter
// novo (ctx.paymentGateways) + uma rota igual a estas duas, sem tocar em
// mais nada - o router deste projeto nao suporta parametros de caminho
// (src/http/router.js), por isso nao da para um "/api/payments/:gateway/
// webhook" generico.

async function handleGatewayWebhook(ctx, adapter, req, res) {
  const { json, readRawBody, readDb, domain, paymentConfirmation } = ctx;
  const { ensureCollections } = domain;
  const rawBody = await readRawBody(req);

  let result;
  try {
    result = await adapter.handleWebhook(rawBody, req.headers);
  } catch (err) {
    return json(res, 400, { ok: false, error: `${adapter.name}: ${err.message}` });
  }

  if (result.paymentId) {
    const db = ensureCollections(await readDb());
    const payment = db.payments.find(p => p.id === result.paymentId);
    // Idempotente por natureza (mesmo principio de invoicing.js): se ja
    // estiver PAID, confirmPayment() nao volta a processar nada demais e
    // issueInvoiceForPayment() ja tem a sua propria idempotencia por
    // documento existente - notificacoes repetidas nunca duplicam nada.
    if (payment) await paymentConfirmation.confirmPayment(result.paymentId);
  }
  // Gateways desativam o endpoint depois de demasiadas respostas nao-2xx,
  // mesmo para notificacoes que nao reconhecemos - responde sempre 200 uma
  // vez a notificacao processada sem erro.
  return json(res, 200, { received: true });
}

module.exports = function registerPaymentsRoutes(router, ctx) {
  const { paymentGateways } = ctx;

  router.post('/api/payments/stripe/webhook', (req, res) => handleGatewayWebhook(ctx, paymentGateways.get('Stripe'), req, res));
  router.post('/api/payments/easypay/webhook', (req, res) => handleGatewayWebhook(ctx, paymentGateways.get('Easypay'), req, res));
};
