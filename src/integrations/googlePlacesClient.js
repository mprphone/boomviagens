const { fetchJson } = require('./httpClient');
const { TtlCache } = require('./cache');

class GooglePlacesClient {
  constructor(env = process.env) {
    this.enabled = String(env.GOOGLE_PLACES_ENABLED || 'false').toLowerCase() === 'true';
    this.apiKey = String(env.GOOGLE_PLACES_API_KEY || '').trim();
    this.cache = new TtlCache();
  }
  isConfigured() { return Boolean(this.apiKey); }
  isEnabled() { return this.enabled && this.isConfigured(); }

  async textSearch(query, fields = ['places.id', 'places.displayName', 'places.formattedAddress', 'places.location']) {
    if (!this.isEnabled()) throw new Error('Google Places está desligado por controlo de custos.');
    const safeQuery = String(query || '').trim().slice(0, 180);
    if (!safeQuery) throw new Error('Pesquisa Google vazia.');
    const key = `${safeQuery}:${fields.join(',')}`;
    const cached = this.cache.get(key);
    if (cached) return { ...cached, cached: true };
    const { data } = await fetchJson('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST', timeoutMs: 8000,
      headers: { 'X-Goog-Api-Key': this.apiKey, 'X-Goog-FieldMask': fields.join(',') },
      json: { textQuery: safeQuery, maxResultCount: 5, languageCode: 'pt-PT' }
    });
    const result = { places: data?.places || [], cached: false };
    // Cache técnico curto. Não se usa este cliente para enriquecer listas de
    // milhares de hotéis; só em ações explícitas de detalhe/exploração.
    this.cache.set(key, result, 10 * 60 * 1000);
    return result;
  }
}

module.exports = { GooglePlacesClient };
