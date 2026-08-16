// Cliente da API da Facturalusa (emissao automatica de faturas de venda) -
// mesmo padrao de src/tourdiezClient.js: "mode" mock/real a partir do env,
// isConfigured() e respostas {mock:true,...} quando desligado, para nunca
// rebentar em dev/teste sem credenciais nem chamar a API a serio por engano.
//
// Mapeamento de regime de IVA -> codigo da API: e a minha melhor leitura da
// documentacao publica (https://facturalusa.pt/documentacao/api) - o
// contabilista da agencia deve confirmar antes de confiar cegamente nas
// faturas emitidas em producao (em conta de testes/sandbox nao ha esse
// risco). MARGEM e o regime normal de uma agencia de viagens a revender
// pacotes (ver domain.js#VAT_REGIMES, default do sistema) - preco bruto,
// IVA embutido na margem, nao discriminado na fatura.
const VAT_BY_REGIME = {
  MARGEM: { vat: 0, vatExemption: 'M12', vatType: 'Não fazer nada' },
  NORMAL: { vat: 23, vatExemption: null, vatType: 'Debitar IVA' },
  REDUZIDA: { vat: 6, vatExemption: null, vatType: 'Debitar IVA' },
  ISENTO: { vat: 0, vatExemption: 'M04', vatType: 'Não fazer nada' }
};

// As respostas de procura (customers/find, items/find) nao tem forma
// garantida na documentacao publica - normaliza os formatos plausiveis
// (objeto direto, {data:...}, ou array de resultados) num objeto so ou null.
function unwrapOne(data) {
  if (!data) return null;
  if (Array.isArray(data)) return data[0] || null;
  if (data.data !== undefined) return unwrapOne(data.data);
  return data.id !== undefined ? data : null;
}

class FacturalusaClient {
  constructor(env = process.env) {
    this.mode = env.FACTURALUSA_MODE || 'mock';
    this.baseUrl = (env.FACTURALUSA_BASE_URL || 'https://facturalusa.pt/api/v2').replace(/\/$/, '');
    this.apiKey = env.FACTURALUSA_API_KEY || '';
    // Cache em memoria do artigo generico de servico e da serie, depois de
    // encontrados/criados uma vez - nao vale a pena procurar a cada fatura.
    this.articleId = null;
    this.seriesId = null;
  }

  isConfigured() {
    return Boolean(this.mode === 'real' && this.apiKey);
  }

  async request(path, { method = 'GET', body } = {}) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* resposta nao-JSON (ex.: pagina de erro) - segue com data=null */ }
    if (!res.ok) {
      const message = data?.message || data?.error || text.slice(0, 200) || `${res.status} ${res.statusText}`;
      throw new Error(`Facturalusa ${method} ${path}: ${res.status} ${message}`);
    }
    return data;
  }

  async findCustomer({ nif, email }) {
    if (nif) {
      const found = unwrapOne(await this.request('/customers/find', { method: 'POST', body: { value: nif, search_in: 'Vat Number' } }).catch(() => null));
      if (found) return found;
    }
    if (email) {
      const found = unwrapOne(await this.request('/customers/find', { method: 'POST', body: { value: email, search_in: 'Email' } }).catch(() => null));
      if (found) return found;
    }
    return null;
  }

  // O pedido de venda exige morada/cidade/codigo postal do cliente - por
  // isso o chamador (src/invoicing.js) so chega aqui depois de confirmar
  // que esses tres campos existem.
  async findOrCreateCustomer({ name, email, nif, address, city, postalCode }) {
    if (!this.isConfigured()) return { mock: true, id: 'mock-customer' };
    const existing = await this.findCustomer({ nif, email });
    if (existing) return existing;
    const created = await this.request('/customers', {
      method: 'POST',
      body: {
        name: name || email || 'Cliente',
        email: email || undefined,
        vat_number: nif || undefined,
        address, city, postal_code: postalCode,
        country: 'Portugal',
        type: 'Particular',
        vat_type: 'Debitar IVA'
      }
    });
    return unwrapOne(created) || created;
  }

  async findOrCreateTravelArticle() {
    if (!this.isConfigured()) return { mock: true, id: 'mock-article' };
    if (this.articleId) return { id: this.articleId };
    const found = unwrapOne(await this.request('/items/find', { method: 'POST', body: { value: 'VIAGEM', search_in: 'Reference' } }).catch(() => null));
    if (found) { this.articleId = found.id; return found; }
    const created = unwrapOne(await this.request('/items', {
      method: 'POST',
      body: { reference: 'VIAGEM', description: 'Serviço de viagem', unit: 'uni', vat: 23, type: 'Serviços' }
    }));
    this.articleId = created?.id;
    return created;
  }

  // A API exige serie_id no pedido de venda (a documentacao publica lista
  // "serie" como opcional, mas a sandbox recusa sem isto - confirmado no
  // proprio erro devolvido: "obrigatoria a indicacao de um valor para o
  // campo serie_id"). Uma serie de longa duracao (10 anos) evita ter de
  // criar uma nova por ano.
  async findOrCreateSeries() {
    if (!this.isConfigured()) return { mock: true, id: 'mock-series' };
    if (this.seriesId) return { id: this.seriesId };
    const found = unwrapOne(await this.request('/administration/series/find', { method: 'POST', body: { value: 'VIAGEM' } }).catch(() => null));
    if (found) { this.seriesId = found.id; return found; }
    const created = unwrapOne(await this.request('/administration/series', {
      method: 'POST',
      body: { description: 'VIAGEM', valid_until: new Date().getFullYear() + 10 }
    }));
    this.seriesId = created?.id;
    return created;
  }

  async issueSaleInvoice({ customer, article, series, description, amount, vatRegime, address, city, postalCode }) {
    if (!this.isConfigured()) {
      return { mock: true, documentNumber: `MOCK-${Date.now()}`, fileUrl: null, amount };
    }
    const vat = VAT_BY_REGIME[vatRegime] || VAT_BY_REGIME.MARGEM;
    const data = await this.request('/sales', {
      method: 'POST',
      body: {
        issue_date: new Date().toISOString().slice(0, 10),
        document_type: 'Factura Recibo',
        status: 'Terminado',
        serie_id: series.id,
        customer: customer.id,
        address, city, postal_code: postalCode, country: 'Portugal',
        vat_type: vat.vatType,
        items: [{
          id: article.id,
          details: description,
          price: amount,
          quantity: 1,
          vat: vat.vat,
          vat_exemption: vat.vatExemption || undefined
        }]
      }
    });
    return {
      documentNumber: data?.document_full_number || data?.number || '',
      fileUrl: data?.url_file || null,
      amount: data?.grand_total ?? amount
    };
  }
}

module.exports = { FacturalusaClient };
