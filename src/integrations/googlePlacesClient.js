const { fetchJson } = require('./httpClient');
const { TtlCache } = require('./cache');
const { defineProvider } = require('./providerKit');

class GooglePlacesClient {
  constructor(env = process.env, options = {}) {
    this.enabled = String(env.GOOGLE_PLACES_ENABLED || 'false').toLowerCase() === 'true';
    this.apiKey = String(env.GOOGLE_PLACES_API_KEY || '').trim();
    this.http = options.http || { fetchJson };
    this.timeoutMs = Number(options.timeoutMs || 8000);
    this.cacheTtlMs = Number(options.cacheTtlMs || 10 * 60 * 1000);
    this.cache = options.cache || new TtlCache();
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
    const { data } = await this.http.fetchJson('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST', timeoutMs: this.timeoutMs,
      headers: { 'X-Goog-Api-Key': this.apiKey, 'X-Goog-FieldMask': fields.join(',') },
      json: { textQuery: safeQuery, maxResultCount: 5, languageCode: 'pt-PT' }
    });
    const result = { places: data?.places || [], cached: false };
    // Cache técnico curto. Não se usa este cliente para enriquecer listas de
    // milhares de hotéis; só em ações explícitas de detalhe/exploração.
    this.cache.set(key, result, this.cacheTtlMs);
    return result;
  }
}

// Contrato do fornecedor no provider kit (ver docs/INTEGRACOES.md). Sem
// healthCheck de proposito: qualquer chamada real tem custo variavel - os
// testes manuais continuam em POST /api/admin/integrations/test.
const googlePlacesProvider = defineProvider({
  id: 'google-places',
  label: 'Google Places',
  kind: 'enrichment',
  envPrefix: 'GOOGLE_PLACES',
  requiredEnv: ['GOOGLE_PLACES_API_KEY'],
  optionalEnv: ['GOOGLE_PLACES_ENABLED'],
  timeoutMs: 8000,
  cacheTtlMs: 10 * 60 * 1000,
  mode: env => (String(env.GOOGLE_PLACES_ENABLED || 'false').toLowerCase() === 'true' ? 'on-demand' : 'off'),
  create: (config, http) => new GooglePlacesClient(
    { GOOGLE_PLACES_API_KEY: config.GOOGLE_PLACES_API_KEY, GOOGLE_PLACES_ENABLED: config.GOOGLE_PLACES_ENABLED },
    { http, timeoutMs: config.timeoutMs, cacheTtlMs: config.cacheTtlMs }
  )
});

module.exports = { GooglePlacesClient, googlePlacesProvider };
