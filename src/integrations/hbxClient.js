const crypto = require('crypto');
const { fetchJson } = require('./httpClient');

function signature(apiKey, secret, timestamp = Math.floor(Date.now() / 1000)) {
  return crypto.createHash('sha256').update(`${apiKey}${secret}${timestamp}`).digest('hex');
}

class HbxClient {
  constructor(env = process.env) {
    this.mode = String(env.HBX_MODE || 'test').toLowerCase();
    this.baseUrl = String(env.HBX_BASE_URL || (this.mode === 'live' ? 'https://api.hotelbeds.com' : 'https://api.test.hotelbeds.com')).replace(/\/$/, '');
    this.credentials = {
      hotels: { apiKey: String(env.HBX_HOTELS_API_KEY || '').trim(), secret: String(env.HBX_HOTELS_SECRET || '').trim() },
      activities: { apiKey: String(env.HBX_ACTIVITIES_API_KEY || '').trim(), secret: String(env.HBX_ACTIVITIES_SECRET || '').trim() },
      transfers: { apiKey: String(env.HBX_TRANSFERS_API_KEY || '').trim(), secret: String(env.HBX_TRANSFERS_SECRET || '').trim() }
    };
  }

  isConfigured(suite) {
    const c = this.credentials[suite];
    return Boolean(c?.apiKey && c?.secret);
  }

  configuredSuites() {
    return Object.fromEntries(Object.keys(this.credentials).map(k => [k, this.isConfigured(k)]));
  }

  headers(suite) {
    const c = this.credentials[suite];
    if (!this.isConfigured(suite)) throw new Error(`HBX ${suite} não configurado.`);
    return {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'Api-key': c.apiKey,
      'X-Signature': signature(c.apiKey, c.secret)
    };
  }

  async request(suite, path, options = {}) {
    const headers = { ...this.headers(suite), ...(options.headers || {}) };
    return fetchJson(`${this.baseUrl}${path}`, { ...options, headers, timeoutMs: options.timeoutMs || 12000 });
  }

  async testHotels() {
    const { data, status } = await this.request('hotels', '/hotel-api/1.0/status');
    return { ok: true, status, mode: this.mode, response: data };
  }

  async testActivities(destination = 'BCN') {
    const code = String(destination || 'BCN').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'BCN';
    const { data, status } = await this.request('activities', `/activity-cache-api/1.0/portfolio?destination=${encodeURIComponent(code)}&offset=0&limit=1`);
    const items = Array.isArray(data) ? data : data?.activities || data?.items || [];
    return { ok: true, status, mode: this.mode, destination: code, items: Array.isArray(items) ? items.length : null, sample: Array.isArray(items) ? items[0] || null : null };
  }

  async testTransfers(destination = 'PMI') {
    const code = String(destination || 'PMI').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'PMI';
    const { data, status } = await this.request('transfers', `/transfer-cache-api/1.0/routes?fields=ALL&destinationCode=${encodeURIComponent(code)}&offset=0&limit=1`);
    const items = Array.isArray(data) ? data : data?.routes || data?.items || [];
    return { ok: true, status, mode: this.mode, destination: code, items: Array.isArray(items) ? items.length : null, sample: Array.isArray(items) ? items[0] || null : null };
  }

  // Não é usado na pesquisa pública por enquanto. A Booking API necessita
  // dos códigos HBX dos hotéis; esses códigos devem vir de uma sincronização
  // local do Content API, nunca de chamadas estáticas em tempo real.
  async availabilityByHotelCodes(input = {}) {
    if (!this.isConfigured('hotels')) throw new Error('HBX Hotels não configurado.');
    const hotelCodes = (input.hotelCodes || []).map(Number).filter(Number.isFinite).slice(0, 100);
    if (!hotelCodes.length) throw new Error('São necessários códigos HBX de hotel para pedir disponibilidade.');
    const body = {
      stay: { checkIn: input.checkIn, checkOut: input.checkOut },
      occupancies: [{ rooms: 1, adults: Math.max(1, Number(input.adults || 2)), children: Math.max(0, Number(input.children || 0)), ...(input.childAges?.length ? { paxes: input.childAges.map(age => ({ type: 'CH', age: Number(age) })) } : {}) }],
      hotels: { hotel: hotelCodes }
    };
    const { data } = await this.request('hotels', '/hotel-api/1.0/hotels', { method: 'POST', json: body, headers: { 'Content-Type': 'application/json' }, timeoutMs: 15000 });
    return data;
  }
}

module.exports = { HbxClient, signature };
