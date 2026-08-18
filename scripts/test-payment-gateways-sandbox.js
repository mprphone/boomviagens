// Smoke test manual: cria apenas sessoes sandbox de 1 EUR; nao introduz
// dados de pagamento nem confirma/captura qualquer cobranca.
require('dotenv').config();
const assert = require('assert');
const { StripeGatewayAdapter, EasyPayGatewayAdapter } = require('../src/paymentGatewayAdapters');

async function run() {
  const suffix = Date.now();
  const payment = { id: `pay-audit-${suffix}`, amount: 1 };
  const reservation = { id: `res-audit-${suffix}`, offer: { destination: 'Auditoria sandbox' } };
  const stripe = new StripeGatewayAdapter(process.env);
  const easypay = new EasyPayGatewayAdapter(process.env);
  assert(stripe.isConfigured(), 'Stripe sandbox nao esta completamente configurada');
  assert(easypay.isConfigured(), 'Easypay sandbox nao esta completamente configurada');

  const stripeSession = await stripe.createCheckout({
    payment, reservation, customer: { email: 'teste@boomviagens.pt' }, method: 'Cartao',
    successUrl: 'http://localhost:3000/conta/?payment=success',
    cancelUrl: 'http://localhost:3000/conta/?payment=cancelled'
  });
  assert(stripeSession.sessionId && stripeSession.url && stripeSession.testing, 'Stripe nao devolveu uma sessao sandbox valida');

  const easySession = await easypay.createCheckout({ payment, reservation, method: 'MB WAY' });
  assert(easySession.sessionId && easySession.manifest && easySession.testing, 'Easypay nao devolveu um manifesto sandbox valido');

  console.log('OK - Stripe e Easypay criaram sessoes sandbox sem efetuar cobrancas');
}

run().catch(error => { console.error(error.message); process.exit(1); });
