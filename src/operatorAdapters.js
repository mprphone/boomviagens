const { TourDiezClient } = require('./tourdiezClient');

class OperatorAdapter {
  constructor(name) {
    this.name = name;
  }

  async search() {
    throw new Error(`${this.name}: pesquisa nao implementada`);
  }

  async value() {
    throw new Error(`${this.name}: valorizacao nao implementada`);
  }

  async confirm() {
    throw new Error(`${this.name}: confirmacao nao implementada`);
  }

  async cancel() {
    throw new Error(`${this.name}: cancelamento nao implementado`);
  }

  normalizeValue(response, offer) {
    return {
      ok: true,
      operator: this.name,
      offerId: offer?.id,
      priceStillValid: true,
      availabilityStillValid: true,
      raw: response
    };
  }
}

class TourDiezAdapter extends OperatorAdapter {
  constructor(env = process.env) {
    super('TourDiez');
    this.client = new TourDiezClient(env);
  }

  isConfigured() {
    return this.client.isConfigured();
  }

  async search(params) {
    return this.client.getAccomodationAvail(params);
  }

  async value({ offer }) {
    const raw = await this.client.value({ optionID: offer.id, rateKey: offer.id });
    return this.normalizeValue(raw, offer);
  }

  async confirm({ reservation }) {
    const raw = await this.client.confirm({
      optionID: reservation.offer.id,
      agencyReference: reservation.id,
      holder: reservation.customer?.name,
      passengers: reservation.passengers?.length ? reservation.passengers : [{ name: reservation.customer?.name || 'Cliente' }]
    });
    return {
      ok: true,
      operator: this.name,
      locator: `BDV-${Math.floor(100000 + Math.random() * 900000)}`,
      raw
    };
  }

  async cancel(params) {
    return this.client.cancel(params);
  }
}

class OperatorRegistry {
  constructor(adapters = []) {
    this.adapters = adapters;
  }

  getForOffer(offer = {}) {
    const operator = String(offer.operator || '').toLowerCase();
    return this.adapters.find(adapter => operator.includes(adapter.name.toLowerCase())) || this.adapters[0];
  }

  list() {
    return this.adapters.map(adapter => ({ name: adapter.name, configured: adapter.isConfigured?.() || false }));
  }
}

module.exports = { OperatorAdapter, TourDiezAdapter, OperatorRegistry };
