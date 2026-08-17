const { fetchJson } = require('./httpClient');
const { TtlCache } = require('./cache');

class OpenWeatherClient {
  constructor(env = process.env) {
    this.apiKey = String(env.OPENWEATHER_API_KEY || '').trim();
    this.cache = new TtlCache();
  }
  isConfigured() { return Boolean(this.apiKey); }

  async geocode(query) {
    if (!this.isConfigured()) throw new Error('OpenWeather não configurado.');
    const key = `geo:${String(query).toLowerCase()}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const url = new URL('https://api.openweathermap.org/geo/1.0/direct');
    url.searchParams.set('q', String(query));
    url.searchParams.set('limit', '1');
    url.searchParams.set('appid', this.apiKey);
    const { data } = await fetchJson(url, { timeoutMs: 8000 });
    const place = Array.isArray(data) ? data[0] : null;
    if (!place) throw new Error('Destino não encontrado no serviço meteorológico.');
    const normalized = { name: place.local_names?.pt || place.name || query, country: place.country || '', lat: Number(place.lat), lon: Number(place.lon) };
    this.cache.set(key, normalized, 24 * 60 * 60 * 1000);
    return normalized;
  }

  async currentByCoordinates(lat, lon) {
    const key = `weather:${Number(lat).toFixed(3)}:${Number(lon).toFixed(3)}`;
    const cached = this.cache.get(key);
    if (cached) return { ...cached, cached: true };
    const url = new URL('https://api.openweathermap.org/data/2.5/weather');
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lon));
    url.searchParams.set('appid', this.apiKey);
    url.searchParams.set('units', 'metric');
    url.searchParams.set('lang', 'pt');
    const { data } = await fetchJson(url, { timeoutMs: 8000 });
    const result = {
      place: data?.name || '',
      country: data?.sys?.country || '',
      temperature: Math.round(Number(data?.main?.temp || 0)),
      feelsLike: Math.round(Number(data?.main?.feels_like || 0)),
      humidity: Number(data?.main?.humidity || 0),
      windSpeed: Number(data?.wind?.speed || 0),
      description: data?.weather?.[0]?.description || '',
      icon: data?.weather?.[0]?.icon || '',
      observedAt: data?.dt ? new Date(Number(data.dt) * 1000).toISOString() : new Date().toISOString(),
      cached: false
    };
    this.cache.set(key, result, 30 * 60 * 1000);
    return result;
  }

  async currentForDestination(destination) {
    if (!this.isConfigured()) throw new Error('OpenWeather não configurado.');
    if (Number.isFinite(destination?.lat) && Number.isFinite(destination?.lon)) {
      return this.currentByCoordinates(destination.lat, destination.lon);
    }
    const place = await this.geocode(destination?.name || destination);
    return this.currentByCoordinates(place.lat, place.lon);
  }

  async testConnection() {
    const weather = await this.currentForDestination({ name: 'Lisboa', lat: 38.7223, lon: -9.1393 });
    return { ok: true, sample: weather };
  }
}

module.exports = { OpenWeatherClient };
