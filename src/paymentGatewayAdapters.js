const { verifyStripeSignature } = require('./stripeSignature');
const GATEWAY_TIMEOUT_MS = 15_000;

/**
 * Contrato que qualquer gateway de pagamento novo tem de implementar para
 * entrar no recetor de webhooks (src/routes/paymentsRoutes.js). Mesmo
 * espirito de src/operatorAdapters.js#OperatorAdapter - so que aqui nao da
 * para um metodo generico "verificar assinatura", porque cada gateway
 * autentica as suas notificacoes de forma completamente diferente (a
 * Stripe assina o corpo; a Easypay nao assina nada, exige voltar a
 * consultar a propria API deles - ver EasyPayGatewayAdapter). O contrato
 * fica por isso ao nivel "processa esta notificacao e diz-me que
 * paymentId (nosso, interno) ficou confirmado, se algum".
 *
 * De proposito NAO existem classes stub para gateways sem credenciais reais
 * para testar contra (mesma regra ja seguida em operatorAdapters.js) -
 * escreve-se um adapter novo quando houver uma conta/sandbox real, seguindo
 * este mesmo padrao.
 */
class PaymentGatewayAdapter {
  /** @param {string} name Nome curto e unico do gateway (ex.: "Stripe"). */
  constructor(name) {
    this.name = name;
  }

  isConfigured() {
    return false;
  }

  /**
   * Processa uma notificacao recebida (corpo em bruto + cabecalhos do
   * pedido). So deve lancar erro quando a propria notificacao nao e valida/
   * verificavel (corpo ilegivel, confirmacao junto do gateway falhou) -
   * nunca para "tipo de evento que nao nos interessa" (isso e so
   * `{ paymentId: null }`, tratado como 200 sem efeito por quem chama).
   * @param {string} rawBody Corpo exato do pedido, sem reserializar.
   * @param {object} headers Cabecalhos do pedido (ex.: assinatura).
   * @returns {Promise<{ paymentId: string|null }>} O nosso paymentId
   *   interno, so quando a notificacao confirma mesmo um pagamento.
   */
  async handleWebhook() {
    throw new Error(`${this.name}: handleWebhook nao implementado`);
  }

  async createCheckout() {
    throw new Error(`${this.name}: createCheckout nao implementado`);
  }
}

async function gatewayJson(res, gateway) {
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  if (!res.ok) {
    const detail = data?.error?.message || data?.message?.[0] || data?.message || `HTTP ${res.status}`;
    const err = new Error(`${gateway}: não foi possível preparar o pagamento (${String(detail).slice(0, 240)})`);
    err.code = 'PAYMENT_GATEWAY_ERROR';
    throw err;
  }
  return data;
}

// Eventos que, uma vez o metadata.paymentId resolvido, valem como "dinheiro
// recebido" - qualquer outro tipo e reconhecido (200) mas ignorado.
const STRIPE_PAID_EVENT_TYPES = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'payment_intent.succeeded']);

class StripeGatewayAdapter extends PaymentGatewayAdapter {
  constructor(env = process.env) {
    super('Stripe');
    this.secretKey = env.STRIPE_SECRET_KEY || '';
    this.webhookSecret = env.STRIPE_WEBHOOK_SECRET || '';
    this.mode = String(env.STRIPE_MODE || 'test').toLowerCase();
  }

  isConfigured() {
    return Boolean(this.secretKey && this.webhookSecret);
  }

  async createCheckout({ payment, reservation, customer, successUrl, cancelUrl }) {
    if (!this.isConfigured()) throw new Error('Stripe não está completamente configurada (chave secreta e webhook).');
    const amountMinor = Math.round(Number(payment.amount) * 100);
    if (!Number.isInteger(amountMinor) || amountMinor < 50) throw new Error('Montante inválido para pagamento por cartão.');
    const params = new URLSearchParams();
    params.set('mode', 'payment');
    params.set('locale', 'pt');
    params.set('success_url', successUrl);
    params.set('cancel_url', cancelUrl);
    params.set('client_reference_id', reservation.id);
    if (customer?.email) params.set('customer_email', customer.email);
    params.set('line_items[0][quantity]', '1');
    params.set('line_items[0][price_data][currency]', 'eur');
    params.set('line_items[0][price_data][unit_amount]', String(amountMinor));
    params.set('line_items[0][price_data][product_data][name]', `Viagem Boomviagens · ${reservation.offer?.destination || reservation.id}`.slice(0, 120));
    params.set('line_items[0][price_data][product_data][description]', `Reserva ${reservation.id}`);
    params.set('metadata[paymentId]', payment.id);
    params.set('metadata[reservationId]', reservation.id);
    params.set('payment_intent_data[metadata][paymentId]', payment.id);
    params.set('payment_intent_data[metadata][reservationId]', reservation.id);

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.secretKey}:`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        // Um bucket de 30 minutos torna pedidos concorrentes idempotentes,
        // mas permite criar uma sessao nova depois de a anterior expirar.
        'Idempotency-Key': `boom-${payment.id}-${Math.floor(Date.now() / (30 * 60 * 1000))}`
      },
      body: params.toString(),
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS)
    });
    const session = await gatewayJson(res, 'Stripe');
    if (!session.id || !session.url) throw new Error('Stripe: a sessão criada não devolveu um endereço de pagamento.');
    return {
      gateway: this.name,
      display: 'redirect',
      sessionId: session.id,
      url: session.url,
      expiresAt: session.expires_at ? new Date(Number(session.expires_at) * 1000).toISOString() : null,
      testing: this.mode !== 'live'
    };
  }

  async handleWebhook(rawBody, headers = {}) {
    // Nunca processa o corpo sem assinatura valida - sem isto, qualquer
    // pessoa conseguia forjar um "pagamento confirmado" so por adivinhar um
    // paymentId. verifyStripeSignature lanca erro em qualquer falha - fica
    // para quem chama decidir o 400 (nao e "evento nao tratado", e mesmo
    // uma notificacao invalida).
    verifyStripeSignature(rawBody, headers['stripe-signature'], this.webhookSecret);

    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      throw new Error('Corpo do evento não é JSON válido');
    }
    if (!STRIPE_PAID_EVENT_TYPES.has(event.type)) return { paymentId: null, eventId: event.id || null };
    const obj = event.data?.object || {};
    // checkout.session.completed também pode chegar antes de métodos de
    // pagamento diferidos ficarem efetivamente pagos. Só o tratamos como
    // dinheiro recebido quando a própria Session diz payment_status=paid;
    // o sucesso posterior entra por async_payment_succeeded.
    if (event.type === 'checkout.session.completed' && String(obj.payment_status || '').toLowerCase() !== 'paid') {
      return { paymentId: null, eventId: event.id || null };
    }
    const amount = obj.amount_total ?? obj.amount_received ?? obj.amount ?? null;
    const currency = obj.currency || null;
    return { paymentId: obj.metadata?.paymentId || null, eventId: event.id || null, amountMinor: amount != null ? Number(amount) : null, currency: currency ? String(currency).toUpperCase() : null, livemode: Boolean(event.livemode) };
  }

  // Reconciliacao direta, equivalente ao verifyPayment() da Easypay - para
  // quando o webhook do Stripe nao esta configurado ou nao chega, consulta a
  // propria Checkout Session em vez de ficar so a espera do evento assinado.
  async verifyPayment(sessionId) {
    if (!sessionId) return { paymentId: null };
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${this.secretKey}:`).toString('base64')}` },
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS)
    });
    if (res.status === 404) return { paymentId: null };
    if (!res.ok) throw new Error(`Stripe: não foi possível verificar a sessão (HTTP ${res.status})`);
    const session = await res.json();
    if (String(session.payment_status || '').toLowerCase() !== 'paid') return { paymentId: null };
    const amount = session.amount_total ?? session.amount_subtotal ?? null;
    return { paymentId: session.metadata?.paymentId || null, eventId: session.id, amountMinor: amount != null ? Number(amount) : null, currency: session.currency ? String(session.currency).toUpperCase() : null, livemode: Boolean(session.livemode) };
  }
}

class EasyPayGatewayAdapter extends PaymentGatewayAdapter {
  constructor(env = process.env) {
    super('Easypay');
    this.baseUrl = (env.EASYPAY_BASE_URL || 'https://api.test.easypay.pt/2.0').replace(/\/$/, '');
    this.accountId = env.EASYPAY_ACCOUNT_ID || '';
    this.apiKey = env.EASYPAY_API_KEY || '';
  }

  isConfigured() {
    return Boolean(this.accountId && this.apiKey);
  }

  async createCheckout({ payment, reservation, method }) {
    if (!this.isConfigured()) throw new Error('Easypay não está completamente configurada.');
    const methodCode = method === 'MB WAY' ? 'mbw' : method.includes('Multibanco') ? 'mb' : 'cc';
    const amount = Number(Number(payment.amount).toFixed(2));
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Montante inválido para pagamento Easypay.');
    const payload = {
      type: ['single'],
      payment: {
        methods: [methodCode],
        type: 'sale',
        currency: 'EUR',
        capture: {
          descriptive: `Boomviagens ${reservation.id}`.slice(0, 50),
          // A notificacao de uma Single Sale devolve esta transaction_key.
          // E a referencia interna que permite reconciliar o webhook com o
          // nosso ledger sem confiar no corpo nao autenticado.
          transaction_key: payment.id
        }
      },
      order: {
        key: payment.id,
        value: amount,
        items: [{ description: `Viagem ${reservation.offer?.destination || reservation.id}`.slice(0, 120), quantity: 1, key: reservation.id, value: amount }]
      }
    };
    const res = await fetch(`${this.baseUrl}/checkout`, {
      method: 'POST',
      headers: { AccountId: this.accountId, ApiKey: this.apiKey, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS)
    });
    const manifest = await gatewayJson(res, 'Easypay');
    if (!manifest.id || !manifest.session) throw new Error('Easypay: a sessão criada não devolveu um manifesto válido.');
    return {
      gateway: this.name,
      display: 'embedded',
      sessionId: manifest.id,
      manifest,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      testing: this.baseUrl.includes('api.test.')
    };
  }

  // Verificacao autenticada e reutilizavel de um pagamento Easypay por id -
  // usada pelo webhook (abaixo) e por /api/payment/status como reconciliacao
  // direta, para quando a notificacao assincrona nao chega (visto em
  // producao: sandbox nem sempre dispara a notificacao MBWAY a tempo).
  async verifyPayment(easypayId, notificationKey = '') {
    if (!easypayId) return { paymentId: null };
    // A Easypay nao assina as notificacoes (confirmado na documentacao
    // deles) - a unica forma de confiar e voltar a consultar a propria API,
    // autenticada com as nossas credenciais, e so agir sobre essa resposta,
    // nunca sobre o "status" que veio no corpo do webhook em si.
    const res = await fetch(`${this.baseUrl}/single/${encodeURIComponent(easypayId)}`, {
      headers: { AccountId: this.accountId, ApiKey: this.apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS)
    });
    if (res.status === 404) return { paymentId: null };
    if (!res.ok) throw new Error(`Easypay: não foi possível verificar o pagamento (HTTP ${res.status})`);
    const payment = await res.json();
    // Confirmado empiricamente contra a API de testes: GET /single/{id}
    // devolve 404 {"message":["Payment not found"]} para um id
    // inexistente/invalido - so um 200 com um destes estados conta como
    // pagamento reconhecido. "success" e o unico visto em exemplos reais
    // da documentacao publica; os outros ficam como leitura razoavel a
    // confirmar contra notificacoes reais quando existirem.
    const paidStatuses = new Set(['success', 'paid', 'captured']);
    const verifiedStatus = payment.payment_status ?? payment.status;
    if (!paidStatuses.has(String(verifiedStatus || '').toLowerCase())) return { paymentId: null };
    const verifiedKeys = [
      payment.key,
      payment.transaction_key,
      payment.capture?.transaction_key,
      ...(Array.isArray(payment.captures) ? payment.captures.flatMap(capture => [capture?.transaction_key, capture?.key]) : []),
      ...(Array.isArray(payment.transactions) ? payment.transactions.flatMap(transaction => [transaction?.transaction_key, transaction?.key]) : [])
    ].filter(Boolean).map(String);
    // Prefere o formato atual dos IDs internos; se o gateway conservar a
    // key noutro campo, aceita-a apenas quando tambem aparece na resposta
    // verificada da API (nunca apenas no webhook recebido).
    const paymentId = verifiedKeys.find(key => /^pay[-_]/i.test(key))
      || verifiedKeys.find(key => key === String(notificationKey || ''))
      || null;
    return { paymentId, eventId: easypayId, amount: Number(payment.value ?? payment.amount ?? 0) || null, currency: String(payment.currency || 'EUR').toUpperCase(), livemode: !this.baseUrl.includes('api.test.') };
  }

  async handleWebhook(rawBody) {
    let notification;
    try {
      notification = JSON.parse(rawBody);
    } catch {
      throw new Error('Corpo da notificação não é JSON válido');
    }
    return this.verifyPayment(notification?.id, notification?.key);
  }
}

/**
 * Guarda a lista de adapters ligados (server.js cria um so, mesmo padrao de
 * OperatorRegistry) e da acesso a cada um pelo nome a partir das rotas.
 */
class PaymentGatewayRegistry {
  constructor(adapters = []) {
    this.adapters = adapters;
  }

  get(name) {
    return this.adapters.find(a => a.name.toLowerCase() === String(name).toLowerCase()) || null;
  }

  list() {
    return this.adapters.map(adapter => ({ name: adapter.name, configured: adapter.isConfigured() }));
  }

  forMethod(method) {
    const value = String(method || '');
    if (value === 'MB WAY' || value.includes('Multibanco')) return this.get('Easypay');
    const stripe = this.get('Stripe');
    return stripe?.isConfigured() ? stripe : this.get('Easypay');
  }

  publicMethods() {
    const stripe = this.get('Stripe');
    const easypay = this.get('Easypay');
    return [
      easypay?.isConfigured() ? { id: 'MB WAY', label: 'MB WAY', gateway: 'Easypay' } : null,
      easypay?.isConfigured() ? { id: 'Referência Multibanco', label: 'Multibanco', gateway: 'Easypay' } : null,
      stripe?.isConfigured() || easypay?.isConfigured() ? { id: 'Cartão', label: 'Cartão', gateway: stripe?.isConfigured() ? 'Stripe' : 'Easypay' } : null
    ].filter(Boolean);
  }
}

module.exports = { PaymentGatewayAdapter, StripeGatewayAdapter, EasyPayGatewayAdapter, PaymentGatewayRegistry };
