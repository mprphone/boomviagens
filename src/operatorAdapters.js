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

  tourdiezRefs(offer = {}) {
    const refs = offer.tourdiez || offer.operatorRefs || offer.operatorData || {};
    return {
      idOperation: refs.idOperation || refs.IdOperation || offer.idOperation || offer.IdOperation || '',
      code: refs.code || offer.code || '',
      idDistributions: refs.idDistributions || refs.distributionId || offer.idDistributions || offer.distributionId || ''
    };
  }

  hasTourdiezRefs(offer = {}) {
    const refs = this.tourdiezRefs(offer);
    return Boolean(refs.idOperation && refs.code && refs.idDistributions);
  }

  async value({ offer }) {
    if (!this.hasTourdiezRefs(offer)) {
      return {
        ok: true,
        operator: this.name,
        offerId: offer?.id,
        priceStillValid: true,
        availabilityStillValid: true,
        needsHumanReview: true,
        raw: { skipped: true, reason: 'Oferta sem IdOperation/code/idDistributions da TourDiez; fluxo demo mantido para captacao.' }
      };
    }
    const raw = await this.client.value(this.tourdiezRefs(offer));
    return this.normalizeValue(raw, offer);
  }

  async confirm({ reservation }) {
    if (!this.hasTourdiezRefs(reservation.offer)) {
      return {
        ok: true,
        operator: this.name,
        locator: `BDV-${Math.floor(100000 + Math.random() * 900000)}`,
        needsHumanReview: true,
        raw: { skipped: true, reason: 'Oferta sem IdOperation/code/idDistributions da TourDiez; confirmacao real nao enviada.' }
      };
    }
    const raw = await this.client.confirm({
      ...this.tourdiezRefs(reservation.offer),
      clientLocalizer: reservation.id,
      clients: reservation.passengers?.length ? reservation.passengers : [{ name: reservation.customer?.name || 'Cliente' }]
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
