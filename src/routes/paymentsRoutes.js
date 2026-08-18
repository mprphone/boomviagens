// Webhooks de gateways de pagamento externos - hoje Stripe e Easypay.
// O checkout cria as sessoes no servidor quando PAYMENTS_MODE=gateway.
// Cada gateway autentica/verifica as suas notificacoes de forma diferente;
// toda essa logica fica no adapter respetivo
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
    if (!payment) return json(res, 400, { ok: false, error: `${adapter.name}: paymentId interno desconhecido` });

    // Nunca confiar apenas no metadata.paymentId. O gateway tem de ter
    // cobrado exatamente o valor/moeda que o nosso ledger esperava.
    const expectedAmount = Number(payment.amount || 0);
    if (result.amountMinor != null && Math.round(expectedAmount * 100) !== Math.round(Number(result.amountMinor))) {
      return json(res, 400, { ok: false, error: `${adapter.name}: montante recebido nao coincide com o pagamento interno` });
    }
    if (result.amount != null && Math.abs(expectedAmount - Number(result.amount)) > 0.005) {
      return json(res, 400, { ok: false, error: `${adapter.name}: montante recebido nao coincide com o pagamento interno` });
    }
    if (result.currency && result.currency !== 'EUR') {
      return json(res, 400, { ok: false, error: `${adapter.name}: moeda inesperada (${result.currency})` });
    }
    if (adapter.name === 'Stripe' && process.env.STRIPE_MODE) {
      const expectLive = String(process.env.STRIPE_MODE).toLowerCase() === 'live';
      if (typeof result.livemode === 'boolean' && result.livemode !== expectLive) {
        return json(res, 400, { ok: false, error: 'Stripe: evento de ambiente diferente do configurado' });
      }
    }
    await paymentConfirmation.confirmPayment(result.paymentId);
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
