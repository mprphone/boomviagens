const { verifyStripeSignature } = require('./stripeSignature');

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
}

// Eventos que, uma vez o metadata.paymentId resolvido, valem como "dinheiro
// recebido" - qualquer outro tipo e reconhecido (200) mas ignorado.
const STRIPE_PAID_EVENT_TYPES = new Set(['checkout.session.completed', 'payment_intent.succeeded']);

class StripeGatewayAdapter extends PaymentGatewayAdapter {
  constructor(env = process.env) {
    super('Stripe');
    this.webhookSecret = env.STRIPE_WEBHOOK_SECRET || '';
  }

  isConfigured() {
    return Boolean(this.webhookSecret);
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
    if (!STRIPE_PAID_EVENT_TYPES.has(event.type)) return { paymentId: null };
    return { paymentId: event.data?.object?.metadata?.paymentId || null };
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

  async handleWebhook(rawBody) {
    let notification;
    try {
      notification = JSON.parse(rawBody);
    } catch {
      throw new Error('Corpo da notificação não é JSON válido');
    }
    const easypayId = notification?.id;
    if (!easypayId) return { paymentId: null };

    // A Easypay nao assina as notificacoes (confirmado na documentacao
    // deles) - a unica forma de confiar e voltar a consultar a propria API,
    // autenticada com as nossas credenciais, e so agir sobre essa resposta,
    // nunca sobre o "status" que veio no corpo do webhook em si.
    const res = await fetch(`${this.baseUrl}/single/${encodeURIComponent(easypayId)}`, {
      headers: { AccountId: this.accountId, ApiKey: this.apiKey, Accept: 'application/json' }
    });
    if (!res.ok) return { paymentId: null };
    const payment = await res.json();
    // Confirmado empiricamente contra a API de testes: GET /single/{id}
    // devolve 404 {"message":["Payment not found"]} para um id
    // inexistente/invalido - so um 200 com um destes estados conta como
    // pagamento reconhecido. "success" e o unico visto em exemplos reais
    // da documentacao publica; os outros ficam como leitura razoavel a
    // confirmar contra notificacoes reais quando existirem.
    const paidStatuses = new Set(['success', 'paid', 'captured']);
    if (!paidStatuses.has(String(payment.status || '').toLowerCase())) return { paymentId: null };
    // "key" e a referencia propria (o nosso paymentId) que se envia ao criar
    // o pagamento na Easypay - mesmo conceito do metadata.paymentId da
    // Stripe, nome de campo diferente. So existe de verdade depois de a
    // criacao de pagamentos Easypay ser construida (fora do ambito atual).
    return { paymentId: payment.key || null };
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
}

module.exports = { PaymentGatewayAdapter, StripeGatewayAdapter, EasyPayGatewayAdapter, PaymentGatewayRegistry };
