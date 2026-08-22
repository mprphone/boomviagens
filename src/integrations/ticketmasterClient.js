const { fetchJson } = require('./httpClient');
const { TtlCache } = require('./cache');
const { defineProvider } = require('./providerKit');

function bestImage(images = []) {
  return [...images].filter(i => i?.url).sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || '';
}

function normalizeEvent(event = {}) {
  const venue = event._embedded?.venues?.[0] || {};
  const classification = event.classifications?.find(c => c.primary) || event.classifications?.[0] || {};
  return {
    id: event.id,
    name: event.name || 'Evento',
    url: event.url || '',
    image: bestImage(event.images),
    date: event.dates?.start?.localDate || '',
    time: event.dates?.start?.localTime || '',
    dateTime: event.dates?.start?.dateTime || null,
    status: event.dates?.status?.code || '',
    venue: venue.name || '',
    city: venue.city?.name || '',
    country: venue.country?.name || '',
    category: classification.segment?.name || classification.genre?.name || '',
    priceMin: Number(event.priceRanges?.[0]?.min || 0) || null,
    priceMax: Number(event.priceRanges?.[0]?.max || 0) || null,
    currency: event.priceRanges?.[0]?.currency || null
  };
}

function ticketmasterDate(value, endOfDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  return `${value}T${endOfDay ? '23:59:59' : '00:00:00'}Z`;
}

class TicketmasterClient {
  constructor(env = process.env, options = {}) {
    this.apiKey = String(env.TICKETMASTER_API_KEY || '').trim();
    this.http = options.http || { fetchJson };
    this.timeoutMs = Number(options.timeoutMs || 9000);
    this.cacheTtlMs = Number(options.cacheTtlMs || 30 * 60 * 1000);
    this.cache = options.cache || new TtlCache();
  }
  isConfigured() { return Boolean(this.apiKey); }

  async searchEvents(input = {}) {
    if (!this.isConfigured()) throw new Error('Ticketmaster não configurada.');
    const city = String(input.city || input.destination || '').trim();
    if (!city) throw new Error('Cidade em falta para procurar eventos.');
    const url = new URL('https://app.ticketmaster.com/discovery/v2/events.json');
    url.searchParams.set('apikey', this.apiKey);
    url.searchParams.set('city', city);
    url.searchParams.set('size', String(Math.max(1, Math.min(20, Number(input.limit || 6)))));
    url.searchParams.set('sort', 'date,asc');
    const start = ticketmasterDate(input.startDate, false);
    const end = ticketmasterDate(input.endDate, true);
    if (start) url.searchParams.set('startDateTime', start);
    if (end) url.searchParams.set('endDateTime', end);
    if (input.countryCode) url.searchParams.set('countryCode', String(input.countryCode).toUpperCase());
    const cacheKey = url.toString().replace(this.apiKey, '[key]');
    const cached = this.cache.get(cacheKey);
    if (cached) return { ...cached, cached: true };
    const { data } = await this.http.fetchJson(url, { timeoutMs: this.timeoutMs });
    const events = (data?._embedded?.events || []).map(normalizeEvent).filter(e => e.id);
    const result = { events, total: Number(data?.page?.totalElements || events.length), cached: false };
    this.cache.set(cacheKey, result, this.cacheTtlMs);
    return result;
  }

  async testConnection() {
    const start = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const end = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
    const result = await this.searchEvents({ city: 'Lisbon', startDate: start, endDate: end, limit: 2 });
    return { ok: true, events: result.events.length, total: result.total, sample: result.events[0] || null };
  }
}

// Contrato do fornecedor no provider kit (ver docs/INTEGRACOES.md).
const ticketmasterProvider = defineProvider({
  id: 'ticketmaster',
  label: 'Ticketmaster Discovery',
  kind: 'enrichment',
  envPrefix: 'TICKETMASTER',
  requiredEnv: ['TICKETMASTER_API_KEY'],
  timeoutMs: 9000,
  cacheTtlMs: 30 * 60 * 1000,
  create: (config, http) => new TicketmasterClient(
    { TICKETMASTER_API_KEY: config.TICKETMASTER_API_KEY },
    { http, timeoutMs: config.timeoutMs, cacheTtlMs: config.cacheTtlMs }
  ),
  healthCheck: client => client.testConnection()
});

module.exports = { TicketmasterClient, normalizeEvent, ticketmasterDate, ticketmasterProvider };
