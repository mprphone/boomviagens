const { TourDiezClient } = require('./tourdiezClient');
const { applyMargin, computeScore } = require('./pricing');

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

  defaultSearchParams(parsed = {}) {
    const checkin = parsed.checkin || new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const start = new Date(`${checkin}T00:00:00Z`);
    const nights = Number(parsed.nights || 7);
    const checkout = new Date(start.getTime() + nights * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return {
      city: process.env.TOURDIEZ_DEFAULT_CITY || 'ES00634',
      accomodationsCode: process.env.TOURDIEZ_DEFAULT_ACCOMMODATIONS || 'Mlg0846,Mlg1295,Mlg1141,Mlg0902',
      checkin,
      checkout,
      nights,
      adults: Number(parsed.adults || 2),
      children: Number(parsed.children || 0),
      retrieveCancelPolicies: true
    };
  }

  tag(xml, name) {
    const match = String(xml || '').match(new RegExp(`<${name}>([^<]*)</${name}>`, 'i'));
    return match ? match[1].trim() : '';
  }

  findNumber(xml, names = []) {
    for (const name of names) {
      const raw = this.tag(xml, name);
      if (!raw) continue;
      const value = Number(String(raw).replace(',', '.'));
      if (Number.isFinite(value) && value > 0) return value;
    }
    return 0;
  }

  availabilityBlocks(xml = '') {
    const blocks = [];
    const patterns = [
      /<accomodation\b[\s\S]*?<\/accomodation>/gi,
      /<distribution\b[\s\S]*?<\/distribution>/gi,
      /<availability\b[\s\S]*?<\/availability>/gi
    ];
    for (const pattern of patterns) {
      for (const match of String(xml).matchAll(pattern)) {
        if (this.findNumber(match[0], ['pvp', 'price', 'amount', 'total', 'totalPrice', 'finalPrice'])) blocks.push(match[0]);
      }
      if (blocks.length) return blocks;
    }
    return [];
  }

  normalizeAvailabilityOffers(response, parsed = {}, margins = []) {
    const blocks = this.availabilityBlocks(response.responseXml);
    const offers = blocks.slice(0, 12).map((block, index) => {
      const rawPrice = this.findNumber(block, ['pvp', 'price', 'amount', 'total', 'totalPrice', 'finalPrice']);
      if (!rawPrice) return null;
      const hotel = this.tag(block, 'name') || this.tag(block, 'accomodationName') || this.tag(block, 'hotelName') || `Hotel TourDiez ${index + 1}`;
      const destination = parsed.destination || this.tag(block, 'city') || 'Destino TourDiez';
      const board = this.tag(block, 'mealPlan') || this.tag(block, 'board') || this.tag(block, 'regime') || 'Regime conforme operador';
      const priced = applyMargin(rawPrice, destination, margins);
      const offer = {
        id: `tdz-live-${this.tag(block, 'code') || index + 1}-${this.tag(block, 'idDistributions') || index + 1}`,
        operator: 'TourDiez',
        destination,
        country: this.tag(block, 'country') || '',
        hotel,
        board,
        nights: Number(parsed.nights || 7),
        adults: Number(parsed.adults || 2),
        children: Number(parsed.children || 0),
        origin: parsed.origin || 'Lisboa',
        rating: Number(this.tag(block, 'category') || 4) || 4,
        freeCancellation: !/NS|non refundable|no reembols/i.test(block),
        themes: ['preco real', 'operador'],
        available: true,
        operatorReliability: 9,
        live: true,
        tourdiez: {
          idOperation: this.tag(block, 'IdOperation') || this.tag(response.responseXml, 'IdOperation'),
          code: this.tag(block, 'code'),
          idDistributions: this.tag(block, 'idDistributions')
        },
        ...priced
      };
      offer.score = computeScore(offer, parsed);
      offer.label = index === 0 ? 'Preco real TourDiez' : 'Disponivel TourDiez';
      offer.trace = `Operador: TourDiez; preco real ${offer.costPrice} EUR; regra margem: ${offer.marginRule}; margem ${offer.marginValue} EUR`;
      return offer;
    }).filter(Boolean);
    offers.sort((a, b) => a.finalPrice - b.finalPrice);
    return offers;
  }

  async liveOffers(parsed = {}, margins = []) {
    const params = this.defaultSearchParams(parsed);
    const raw = await this.search(params);
    return { params, raw, offers: this.normalizeAvailabilityOffers(raw, parsed, margins) };
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
