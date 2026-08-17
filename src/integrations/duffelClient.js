const { fetchJson } = require('./httpClient');
const { TtlCache } = require('./cache');

function parseDurationMinutes(value = '') {
  const m = String(value).match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/i);
  if (!m) return null;
  return Number(m[1] || 0) * 60 + Number(m[2] || 0);
}

function isoTime(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function operatingNames(slice = {}) {
  const names = [];
  for (const segment of slice.segments || []) {
    const name = segment.operating_carrier?.name || segment.marketing_carrier?.name;
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

function normalizeSlice(slice = {}) {
  const segments = slice.segments || [];
  const first = segments[0] || {};
  const last = segments[segments.length - 1] || {};
  return {
    origin: first.origin?.iata_code || slice.origin?.iata_code || '',
    destination: last.destination?.iata_code || slice.destination?.iata_code || '',
    departureAt: isoTime(first.departing_at),
    arrivalAt: isoTime(last.arriving_at),
    durationMinutes: parseDurationMinutes(slice.duration),
    stops: Math.max(0, segments.length - 1),
    operatingCarriers: operatingNames(slice),
    segments: segments.map(segment => ({
      id: segment.id,
      flightNumber: `${segment.marketing_carrier?.iata_code || segment.operating_carrier?.iata_code || ''}${segment.marketing_carrier_flight_number || segment.operating_carrier_flight_number || ''}`,
      operatingCarrier: segment.operating_carrier?.name || '',
      marketingCarrier: segment.marketing_carrier?.name || '',
      origin: segment.origin?.iata_code || '',
      destination: segment.destination?.iata_code || '',
      departureAt: isoTime(segment.departing_at),
      arrivalAt: isoTime(segment.arriving_at)
    }))
  };
}

function normalizeOffer(offer = {}) {
  const slices = (offer.slices || []).map(normalizeSlice);
  const carriers = [...new Set(slices.flatMap(s => s.operatingCarriers).filter(Boolean))];
  return {
    id: offer.id,
    source: 'Duffel',
    liveMode: Boolean(offer.live_mode),
    totalAmount: Number(offer.total_amount || 0),
    totalCurrency: offer.total_currency || 'EUR',
    taxAmount: Number(offer.tax_amount || 0),
    expiresAt: offer.expires_at || null,
    passengerIdentityDocumentsRequired: Boolean(offer.passenger_identity_documents_required),
    carriers,
    slices,
    conditions: {
      changeBeforeDeparture: offer.conditions?.change_before_departure || null,
      refundBeforeDeparture: offer.conditions?.refund_before_departure || null
    }
  };
}

class DuffelClient {
  constructor(env = process.env) {
    this.token = String(env.DUFFEL_API_TOKEN || '').trim();
    this.baseUrl = String(env.DUFFEL_BASE_URL || 'https://api.duffel.com').replace(/\/$/, '');
    this.cache = new TtlCache();
  }

  isConfigured() { return /^duffel_(test|live)_/i.test(this.token); }
  mode() { return this.token.startsWith('duffel_test_') ? 'test' : this.isConfigured() ? 'live' : 'off'; }

  async searchFlights(input = {}) {
    if (!this.isConfigured()) throw new Error('Duffel não configurada.');
    const origin = String(input.origin || '').toUpperCase();
    const destination = String(input.destination || '').toUpperCase();
    const departureDate = String(input.departureDate || '');
    const returnDate = String(input.returnDate || '');
    if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) throw new Error('Origem/destino IATA inválidos para Duffel.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(departureDate)) throw new Error('Data de ida inválida para Duffel.');

    const adults = Math.max(1, Math.min(8, Number(input.adults || 1)));
    const children = Math.max(0, Math.min(8, Number(input.children || 0)));
    const infants = Math.max(0, Math.min(8, Number(input.infants || 0)));
    const childAges = Array.from({ length: children }, (_, i) => Math.max(2, Math.min(11, Number(input.childAges?.[i] ?? 8))));
    const infantAges = Array.from({ length: infants }, (_, i) => Math.max(0, Math.min(1, Number(input.infantAges?.[i] ?? 1))));
    const slices = [{ origin, destination, departure_date: departureDate }];
    if (/^\d{4}-\d{2}-\d{2}$/.test(returnDate) && returnDate > departureDate) slices.push({ origin: destination, destination: origin, departure_date: returnDate });
    const passengers = [
      ...Array.from({ length: adults }, () => ({ type: 'adult' })),
      ...childAges.map(age => ({ age })),
      ...infantAges.map(age => ({ age }))
    ];
    const payload = { data: { slices, passengers, cabin_class: input.cabinClass || 'economy', max_connections: Number.isInteger(input.maxConnections) ? input.maxConnections : 1 } };
    const cacheKey = JSON.stringify(payload);
    const cached = this.cache.get(cacheKey);
    if (cached) return { ...cached, cached: true };

    const { data } = await fetchJson(`${this.baseUrl}/air/offer_requests?return_offers=true&supplier_timeout=12000`, {
      method: 'POST',
      timeoutMs: 17000,
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'Duffel-Version': 'v2',
        Authorization: `Bearer ${this.token}`
      },
      json: payload
    });
    const request = data?.data || {};
    const offers = (request.offers || []).map(normalizeOffer).filter(o => o.id && o.totalAmount > 0)
      .sort((a, b) => a.totalAmount - b.totalAmount)
      .slice(0, Math.max(1, Math.min(10, Number(input.limit || 6))));
    const result = { requestId: request.id || null, offers, mode: this.mode(), searchedAt: new Date().toISOString(), cached: false };
    // Ofertas Duffel são temporárias. Cache curto para não refazer a mesma
    // pesquisa a cada re-render, mas nunca por tempo suficiente para tratar
    // uma cotação antiga como preço confirmado.
    this.cache.set(cacheKey, result, 5 * 60 * 1000);
    return result;
  }

  async testConnection() {
    const now = new Date();
    const dep = new Date(now.getTime() + 21 * 86400000).toISOString().slice(0, 10);
    const ret = new Date(now.getTime() + 23 * 86400000).toISOString().slice(0, 10);
    const result = await this.searchFlights({ origin: 'LIS', destination: 'LHR', departureDate: dep, returnDate: ret, adults: 1, children: 0, limit: 2 });
    return { ok: true, mode: result.mode, requestId: result.requestId, offers: result.offers.length, sample: result.offers[0] || null };
  }
}

module.exports = { DuffelClient, normalizeOffer, normalizeSlice, parseDurationMinutes };
