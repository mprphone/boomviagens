const { resolveDestination, resolveOrigin, suggestDestinations } = require('./destinations');

function providerResult(name, settled) {
  if (settled.status === 'fulfilled') return { provider: name, ok: true, data: settled.value };
  return { provider: name, ok: false, error: settled.reason?.message || 'Fornecedor indisponível.' };
}

class TravelIntelligenceService {
  constructor({ duffel, weather, ticketmaster, hbx, googlePlaces }) {
    this.duffel = duffel;
    this.weather = weather;
    this.ticketmaster = ticketmaster;
    this.hbx = hbx;
    this.googlePlaces = googlePlaces;
  }

  suggest(query, limit) { return suggestDestinations(query, limit); }

  status() {
    const hbxSuites = this.hbx?.configuredSuites?.() || {};
    return [
      { id: 'duffel', name: 'Duffel', category: 'Voos', configured: Boolean(this.duffel?.isConfigured()), enabled: Boolean(this.duffel?.isConfigured()), mode: this.duffel?.mode?.() || 'off', publicUse: 'Detalhe da viagem' },
      { id: 'hbx-hotels', name: 'HBX Hotels', category: 'Hotéis', configured: Boolean(hbxSuites.hotels), enabled: Boolean(hbxSuites.hotels), mode: this.hbx?.mode || 'off', publicUse: 'Preparado; aguarda sincronização de conteúdo' },
      { id: 'hbx-activities', name: 'HBX Activities', category: 'Atividades', configured: Boolean(hbxSuites.activities), enabled: Boolean(hbxSuites.activities), mode: this.hbx?.mode || 'off', publicUse: 'Laboratório / integração progressiva' },
      { id: 'hbx-transfers', name: 'HBX Transfers', category: 'Transfers', configured: Boolean(hbxSuites.transfers), enabled: Boolean(hbxSuites.transfers), mode: this.hbx?.mode || 'off', publicUse: 'Laboratório / integração progressiva' },
      { id: 'openweather', name: 'OpenWeather', category: 'Clima', configured: Boolean(this.weather?.isConfigured()), enabled: Boolean(this.weather?.isConfigured()), mode: 'live-data', publicUse: 'Detalhe da viagem' },
      { id: 'ticketmaster', name: 'Ticketmaster Discovery', category: 'Eventos', configured: Boolean(this.ticketmaster?.isConfigured()), enabled: Boolean(this.ticketmaster?.isConfigured()), mode: 'public-api', publicUse: 'Detalhe da viagem' },
      { id: 'google-places', name: 'Google Places', category: 'Explorar zona', configured: Boolean(this.googlePlaces?.isConfigured()), enabled: Boolean(this.googlePlaces?.isEnabled()), mode: this.googlePlaces?.isEnabled() ? 'on-demand' : 'off', publicUse: this.googlePlaces?.isEnabled() ? 'Só por ação explícita' : 'Desligado por controlo de custos' }
    ];
  }

  async enrichTrip(offer = {}, options = {}) {
    const destination = resolveDestination(offer.destination);
    const origin = resolveOrigin(offer.origin);
    const warnings = [];
    if (!destination) warnings.push('Destino ainda sem mapeamento inteligente para voos/eventos.');
    if (!origin) warnings.push('Origem ainda sem código IATA configurado.');

    const tasks = {};
    if (this.duffel?.isConfigured() && destination?.iata && origin?.iata && offer.checkin) {
      tasks.flights = this.duffel.searchFlights({
        origin: origin.iata,
        destination: destination.iata,
        departureDate: offer.checkin,
        returnDate: offer.checkout,
        adults: offer.adults || 1,
        children: offer.children || 0,
        infants: offer.infants || 0,
        childAges: offer.childAges || [],
        infantAges: offer.infantAges || [],
        limit: 6
      });
    }
    if (this.weather?.isConfigured() && destination) {
      tasks.weather = this.weather.currentForDestination(destination);
    }
    if (this.ticketmaster?.isConfigured() && destination?.eventCity) {
      tasks.events = this.ticketmaster.searchEvents({
        city: destination.eventCity,
        startDate: offer.checkin,
        endDate: offer.checkout,
        limit: 6
      });
    }
    if (options.exploreGoogle && this.googlePlaces?.isEnabled() && destination) {
      tasks.places = this.googlePlaces.textSearch(`principais atrações em ${destination.name}, ${destination.country}`);
    }

    const names = Object.keys(tasks);
    const settled = await Promise.allSettled(Object.values(tasks));
    const providers = Object.fromEntries(names.map((name, i) => [name, providerResult(name, settled[i])]));
    return {
      destination: destination ? { name: destination.name, country: destination.country, iata: destination.iata, lat: destination.lat, lon: destination.lon } : null,
      origin: origin || null,
      providers,
      warnings,
      generatedAt: new Date().toISOString(),
      note: 'Os voos são cotações independentes e não alteram automaticamente o preço do alojamento/pacote selecionado. O clima mostrado é a condição atual, não uma previsão para datas distantes.'
    };
  }

  async exploreZone(destinationName = '') {
    const destination = resolveDestination(destinationName);
    if (!destination) throw new Error('Destino ainda sem mapeamento para exploração de zona.');
    if (!this.googlePlaces?.isEnabled()) throw new Error('Exploração de zona está desligada por controlo de custos.');
    const data = await this.googlePlaces.textSearch(`principais atrações em ${destination.name}, ${destination.country}`);
    return { destination: { name: destination.name, country: destination.country, lat: destination.lat, lon: destination.lon }, places: data.places || [] };
  }

  async testProvider(id) {
    switch (id) {
      case 'duffel': return this.duffel.testConnection();
      case 'hbx-hotels': return this.hbx.testHotels();
      case 'hbx-activities': return this.hbx.testActivities('BCN');
      case 'hbx-transfers': return this.hbx.testTransfers('PMI');
      case 'openweather': return this.weather.testConnection();
      case 'ticketmaster': return this.ticketmaster.testConnection();
      case 'google-places': {
        const result = await this.googlePlaces.textSearch('Torre de Belém, Lisboa', ['places.id', 'places.displayName']);
        return { ok: true, enabled: true, places: result.places.length };
      }
      default: throw new Error('Integração desconhecida.');
    }
  }
}

module.exports = { TravelIntelligenceService };
