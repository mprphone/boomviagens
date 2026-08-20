const crypto = require('crypto');
const { fetchJson } = require('./httpClient');
const { TtlCache } = require('./cache');

function signature(apiKey, secret, timestamp = Math.floor(Date.now() / 1000)) {
  return crypto.createHash('sha256').update(`${apiKey}${secret}${timestamp}`).digest('hex');
}

function arr(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function textValue(value, fallback = '') {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') {
    for (const key of ['content', 'value', 'name', 'description']) {
      if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
    }
  }
  return fallback;
}

function normText(value = '') {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function similarityScore(a = '', b = '') {
  const left = normText(a); const right = normText(b);
  if (!left || !right) return 0;
  if (left === right) return 100;
  if (left.includes(right) || right.includes(left)) return 85;
  const aa = new Set(left.split(' ').filter(x => x.length > 2));
  const bb = new Set(right.split(' ').filter(x => x.length > 2));
  const common = [...aa].filter(x => bb.has(x)).length;
  return common ? Math.round((common / Math.max(aa.size, bb.size)) * 75) : 0;
}

function categoryStars(code = '', name = '') {
  const m = `${code} ${name}`.match(/([1-5])/);
  return m ? Number(m[1]) : 4;
}

function firstImage(content = {}) {
  const images = arr(content.images || content.image);
  const candidate = images.find(x => x?.path || x?.url) || images[0];
  const path = candidate?.path || candidate?.url || '';
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  // Hotelbeds content image paths are normally served from hotelbeds CDN.
  return `https://photos.hotelbeds.com/giata/${String(path).replace(/^\/+/, '')}`;
}

function normalizeRate(rate = {}, room = {}) {
  const cancellationPolicies = arr(rate.cancellationPolicies || rate.cancellationPolicy)
    .filter(Boolean)
    .sort((a, b) => new Date(a.from || a.dateFrom || 0).getTime() - new Date(b.from || b.dateFrom || 0).getTime());
  const firstPenalty = cancellationPolicies[0] || {};
  const penaltyFrom = firstPenalty.from || firstPenalty.dateFrom || '';
  const penaltyAt = penaltyFrom ? new Date(penaltyFrom).getTime() : NaN;
  const rateClass = String(rate.rateClass || '').toUpperCase();
  const nonRefundable = rateClass === 'NRF' || Boolean(rate.nonRefundable);
  // Sem política e sem marca NRF tratamos como flexível, mas nunca
  // traduzimos simplesmente qualquer tarifa restrita como "não
  // reembolsável" na UI. Quando existe uma data futura, mostramos que há
  // cancelamento sem penalização até essa data.
  const freeCancellation = !nonRefundable && (cancellationPolicies.length === 0 || (Number.isFinite(penaltyAt) && penaltyAt > Date.now()));
  return {
    rateKey: rate.rateKey || '',
    rateType: rate.rateType || '',
    rateClass,
    net: num(rate.net),
    sellingRate: num(rate.sellingRate),
    boardCode: rate.boardCode || '',
    boardName: rate.boardName || '',
    roomCode: room.code || '',
    roomName: room.name || '',
    allotment: num(rate.allotment),
    packaging: Boolean(rate.packaging),
    cancellationPolicies,
    nonRefundable,
    freeCancellation,
    freeCancellationUntil: freeCancellation && penaltyFrom ? penaltyFrom : null
  };
}

function normalizeHotelAvailability(hotel = {}, content = {}) {
  const rooms = arr(hotel.rooms?.rooms || hotel.rooms);
  const rates = rooms.flatMap(room => arr(room.rates?.rates || room.rates).map(rate => normalizeRate(rate, room))).filter(r => r.rateKey && r.net > 0);
  rates.sort((a, b) => a.net - b.net);
  if (!rates.length) return null;
  const best = rates[0];
  const categoryCode = content.category || content.categoryCode || hotel.categoryCode || '';
  const categoryName = content.categoryName || hotel.categoryName || '';
  return {
    hotelCode: String(hotel.code || content.code || ''),
    giataCode: String(content.giataCode || content.giata || hotel.giataCode || ''),
    name: textValue(content.name) || textValue(hotel.name) || `Hotel ${hotel.code || ''}`,
    destinationCode: hotel.destinationCode || content.destinationCode || '',
    destinationName: textValue(hotel.destinationName) || textValue(content.city) || '',
    categoryCode,
    categoryName,
    stars: categoryStars(categoryCode, categoryName),
    latitude: num(hotel.latitude ?? content.coordinates?.latitude, null),
    longitude: num(hotel.longitude ?? content.coordinates?.longitude, null),
    address: textValue(content.address),
    description: textValue(content.description),
    image: firstImage(content),
    currency: hotel.currency || 'EUR',
    bestRate: best,
    rates: rates.slice(0, 12)
  };
}

function normalizeActivity(activity = {}) {
  const modalities = arr(activity.modalities);
  const prices = [];
  for (const modality of modalities) {
    for (const rate of arr(modality.rates)) {
      for (const detail of arr(rate.rateDetails || rate.details)) {
        const amount = num(detail.totalAmount?.amount ?? detail.amount ?? detail.price?.amount ?? rate.amountFrom);
        if (amount > 0) prices.push({ amount, currency: detail.totalAmount?.currency || detail.currency || rate.currency || 'EUR' });
      }
      const rateAmount = num(rate.amountFrom || rate.amount);
      if (rateAmount > 0) prices.push({ amount: rateAmount, currency: rate.currency || 'EUR' });
    }
  }
  const content = activity.content || {};
  return {
    code: activity.activityCode || activity.code || '',
    name: textValue(content.name) || textValue(activity.name) || 'Atividade',
    description: textValue(content.description),
    image: firstImage(content),
    fromPrice: prices.length ? Math.min(...prices.map(p => p.amount)) : null,
    currency: prices[0]?.currency || 'EUR',
    modalities: modalities.slice(0, 6)
  };
}

function normalizeTransfer(service = {}) {
  const price = service.price || {};
  return {
    id: service.serviceId || service.id || '',
    rateKey: service.rateKey || '',
    transferType: service.transferType || '',
    vehicle: service.vehicle?.name || service.content?.vehicle?.name || '',
    category: service.category?.name || service.content?.category?.name || '',
    totalAmount: num(price.totalAmount),
    netAmount: num(price.netAmount),
    currency: price.currencyId || price.currency || service.cancellationPolicies?.[0]?.currencyId || 'EUR',
    minPax: num(service.minPaxCapacity),
    maxPax: num(service.maxPaxCapacity),
    image: arr(service.content?.images).find(x => x?.url)?.url || '',
    cancellationPolicies: arr(service.cancellationPolicies),
    detail: arr(service.content?.transferDetailInfo || service.transferDetailInfo)
  };
}

class HbxClient {
  constructor(env = process.env) {
    this.mode = String(env.HBX_MODE || 'test').toLowerCase();
    this.baseUrl = String(env.HBX_BASE_URL || (this.mode === 'live' ? 'https://api.hotelbeds.com' : 'https://api.test.hotelbeds.com')).replace(/\/$/, '');
    this.allowLazyContent = String(env.HBX_ALLOW_LAZY_CONTENT || (this.mode === 'test' ? 'true' : 'false')).toLowerCase() === 'true';
    this.credentials = {
      hotels: { apiKey: String(env.HBX_HOTELS_API_KEY || '').trim(), secret: String(env.HBX_HOTELS_SECRET || '').trim() },
      activities: { apiKey: String(env.HBX_ACTIVITIES_API_KEY || '').trim(), secret: String(env.HBX_ACTIVITIES_SECRET || '').trim() },
      transfers: { apiKey: String(env.HBX_TRANSFERS_API_KEY || '').trim(), secret: String(env.HBX_TRANSFERS_SECRET || '').trim() }
    };
    this.cache = new TtlCache();
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

  async hotelPortfolioByDestination(destinationCode, limit = 80) {
    const code = String(destinationCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (!code) throw new Error('Código de destino HBX em falta.');
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 80));
    const cacheKey = `hotel-content:${code}:${safeLimit}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    // IMPORTANTE: códigos do Transfer Cache são ATLAS e não são os códigos
    // do Hotel Booking API. Para pedir Availability de hotéis usamos apenas
    // códigos vindos do Hotel Content API (ou, em produção, do catálogo
    // sincronizado localmente). Usar os códigos ATLAS aqui fazia pesquisas
    // de alojamento erradas ou vazias.
    if (!this.isConfigured('hotels')) throw new Error('HBX Hotels não configurado.');
    if (!this.allowLazyContent) {
      return {
        destinationCode: code,
        source: 'HBX catálogo local obrigatório em produção',
        hotels: [],
        warning: 'HBX_ALLOW_LAZY_CONTENT=false: sincronize Hotel Content para a base local antes de pesquisar em produção.'
      };
    }

    let hotels = [];
    let source = 'HBX Hotel Content (lazy, apenas teste)';
    try {
      const { data } = await this.request('hotels', `/hotel-content-api/1.0/hotels?fields=all&language=ENG&destinationCode=${encodeURIComponent(code)}&from=1&to=${safeLimit}`);
      hotels = data?.hotels || data?.hotel || (Array.isArray(data) ? data : []);
    } catch (err) {
      source = `HBX Hotel Content indisponível: ${err.message}`;
    }

    const result = { destinationCode: code, source, hotels: arr(hotels).filter(h => h?.code).slice(0, safeLimit) };
    // Conteúdo é estático. Em teste podemos reutilizá-lo várias horas sem
    // gastar a pequena quota de evaluation em cada pesquisa.
    this.cache.set(cacheKey, result, 12 * 60 * 60 * 1000);
    return result;
  }

  async transferHotelByGiata(giataCode) {
    if (!this.isConfigured('transfers')) return null;
    const giata = String(giataCode || '').replace(/[^0-9A-Za-z.-]/g, '').slice(0, 32);
    if (!giata) return null;
    const cacheKey = `transfer-hotel-giata:${giata}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached;
    try {
      const { data } = await this.request('transfers', `/transfer-cache-api/1.0/hotels?fields=ALL&language=en&giataCodes=${encodeURIComponent(giata)}&offset=0&limit=5`);
      const hotels = Array.isArray(data) ? data : data?.hotels || data?.items || [];
      const match = arr(hotels).find(h => String(h.giataCode || '') === giata) || arr(hotels)[0] || null;
      const result = match ? { atlasCode: String(match.code || ''), giataCode: String(match.giataCode || giata), destinationCode: String(match.destinationCode || '') } : null;
      this.cache.set(cacheKey, result, 24 * 60 * 60 * 1000);
      return result;
    } catch {
      // Transfer é extra opcional; uma falha de mapeamento não pode impedir
      // a reserva do hotel. Cache curto do null evita repetir chamadas numa
      // sessão em que não existe correspondência.
      this.cache.set(cacheKey, null, 15 * 60 * 1000);
      return null;
    }
  }

  async transferHotelsByDestination(destinationCode, limit = 1000) {
    if (!this.isConfigured('transfers')) return [];
    const code = String(destinationCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (!code) return [];
    const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 1000));
    const cacheKey = `transfer-hotels:${code}:${safeLimit}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    try {
      const { data } = await this.request('transfers', `/transfer-cache-api/1.0/hotels?fields=ALL&language=en&destinationCodes=${encodeURIComponent(code)}&offset=0&limit=${safeLimit}`);
      const hotels = arr(Array.isArray(data) ? data : data?.hotels || data?.items).filter(Boolean);
      this.cache.set(cacheKey, hotels, 24 * 60 * 60 * 1000);
      return hotels;
    } catch {
      this.cache.set(cacheKey, [], 15 * 60 * 1000);
      return [];
    }
  }

  async resolveTransferHotel({ destinationCode = '', giataCode = '', hotelName = '', latitude = null, longitude = null } = {}) {
    if (!this.isConfigured('transfers')) return null;
    if (giataCode) {
      const direct = await this.transferHotelByGiata(giataCode);
      if (direct?.atlasCode) return direct;
    }
    const hotels = await this.transferHotelsByDestination(destinationCode, 1000);
    if (!hotels.length) return null;
    let best = null; let bestScore = 0;
    for (const hotel of hotels) {
      let score = similarityScore(hotelName, textValue(hotel.name));
      const lat = num(hotel.coordinates?.latitude, null); const lon = num(hotel.coordinates?.longitude, null);
      if (Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude)) && Number.isFinite(lat) && Number.isFinite(lon)) {
        const d = Math.abs(Number(latitude) - lat) + Math.abs(Number(longitude) - lon);
        if (d < 0.002) score += 30; else if (d < 0.01) score += 15;
      }
      if (score > bestScore) { bestScore = score; best = hotel; }
    }
    if (!best || bestScore < 45) return null;
    return { atlasCode: String(best.code || ''), giataCode: String(best.giataCode || giataCode || ''), destinationCode: String(best.destinationCode || destinationCode || ''), matchedBy: 'name_or_coordinates', confidence: bestScore };
  }

  async hotelCatalog(input = {}) {
    const portfolio = await this.hotelPortfolioByDestination(input.destinationCode, Math.max(20, Math.min(200, Number(input.limit || 80))));
    return {
      destinationCode: input.destinationCode,
      source: portfolio.source,
      hotels: portfolio.hotels.map(h => ({
        hotelCode: String(h.code || ''), giataCode: String(h.giataCode || h.giata || ''), name: textValue(h.name) || `Hotel ${h.code || ''}`,
        stars: categoryStars(h.category || h.categoryCode || '', h.categoryName || ''), image: firstImage(h),
        latitude: num(h.coordinates?.latitude, null), longitude: num(h.coordinates?.longitude, null),
        address: textValue(h.address), city: textValue(h.city), description: textValue(h.description).slice(0, 500)
      })).filter(h => h.hotelCode)
    };
  }

  async availabilityByHotelCodes(input = {}) {
    if (!this.isConfigured('hotels')) throw new Error('HBX Hotels não configurado.');
    const hotelCodes = (input.hotelCodes || []).map(Number).filter(Number.isFinite).slice(0, 100);
    if (!hotelCodes.length) throw new Error('São necessários códigos HBX de hotel para pedir disponibilidade.');
    // Na disponibilidade hoteleira, bebés também têm idade e fazem parte
    // da ocupação não-adulta. Ignorá-los podia devolver um quarto/preço para
    // 2 adultos quando a pesquisa era 2 adultos + bebé. Enviamos todas as
    // idades (crianças e bebés) ordenadas e mantemos `children` coerente com
    // o número de paxes CH transmitidos.
    const childAges = [...(input.childAges || []), ...(input.infantAges || [])]
      .map(Number).filter(Number.isFinite).map(age => Math.max(0, Math.min(17, age))).sort((a, b) => a - b);
    const requestedNonAdults = Math.max(0, Number(input.children || 0)) + Math.max(0, Number(input.infants || 0));
    if (requestedNonAdults !== childAges.length) {
      throw new Error('As idades das crianças/bebés não correspondem à ocupação pedida ao HBX.');
    }
    const paxes = childAges.map(age => ({ type: 'CH', age }));
    const body = {
      stay: { checkIn: input.checkIn, checkOut: input.checkOut },
      occupancies: [{ rooms: 1, adults: Math.max(1, Number(input.adults || 2)), children: requestedNonAdults, ...(paxes.length ? { paxes } : {}) }],
      hotels: { hotel: hotelCodes }
    };
    const cacheKey = `avail:${JSON.stringify(body)}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    const { data } = await this.request('hotels', '/hotel-api/1.0/hotels', { method: 'POST', json: body, headers: { 'Content-Type': 'application/json' }, timeoutMs: 18000 });
    this.cache.set(cacheKey, data, 3 * 60 * 1000);
    return data;
  }

  async checkRate(rateKey) {
    if (!this.isConfigured('hotels')) throw new Error('HBX Hotels não configurado.');
    const key = String(rateKey || '').trim();
    if (!key) throw new Error('rateKey HBX em falta.');
    const { data } = await this.request('hotels', '/hotel-api/1.0/checkrates', {
      method: 'POST',
      json: { rooms: [{ rateKey: key }] },
      headers: { 'Content-Type': 'application/json' },
      timeoutMs: 18000
    });
    const hotels = arr(data?.hotel?.rooms ? [data.hotel] : (data?.hotels?.hotels || data?.hotels || data?.hotel));
    const rates = hotels.flatMap(hotel => arr(hotel?.rooms?.rooms || hotel?.rooms).flatMap(room =>
      arr(room?.rates?.rates || room?.rates).map(rate => ({ ...normalizeRate(rate, room), hotelCode: String(hotel?.code || '') }))
    )).filter(rate => rate.rateKey && rate.net > 0);
    if (!rates.length) {
      const err = new Error('A tarifa HBX já não está disponível. Atualize a pesquisa.');
      err.code = 'HBX_RATE_UNAVAILABLE';
      throw err;
    }
    return rates[0];
  }

  // Reserva real na Hotelbeds. Testado e confirmado contra o sandbox real
  // desta conta em 2026-08-20 (scripts/test-hbx-booking-sandbox.js): a
  // conta tem mesmo o produto de Reservas ativo, e a forma exata do pedido
  // (holder/rooms/paxes/clientReference) e da resposta
  // (booking.status="CONFIRMED"/booking.reference) bateram certo à
  // primeira, exceto clientReference que tem limite de 20 caracteres (ver
  // abaixo) - nao confirmado por documentacao, so pelo proprio erro 400
  // devolvido pela API.
  async createBooking({ rateKey, holder, paxes, clientReference, remark }) {
    if (!this.isConfigured('hotels')) throw new Error('HBX Hotels não configurado.');
    const key = String(rateKey || '').trim();
    if (!key) throw new Error('rateKey HBX em falta.');
    if (!holder?.name || !holder?.surname) throw new Error('Titular (nome/apelido) em falta para reservar.');
    if (!Array.isArray(paxes) || !paxes.length) throw new Error('Ocupação (paxes) em falta para reservar.');
    const body = {
      holder: { name: holder.name, surname: holder.surname },
      rooms: [{ rateKey: key, paxes: paxes.map((pax, index) => ({ roomId: 1, type: pax.type, age: pax.age, name: pax.name, surname: pax.surname })) }],
      // Confirmado contra o sandbox real: a Hotelbeds rejeita
      // clientReference com mais de 20 caracteres ("Attribute size must
      // be between 1 and 20").
      clientReference: String(clientReference || '').slice(0, 20),
      ...(remark ? { remark: String(remark).slice(0, 200) } : {})
    };
    const { data } = await this.request('hotels', '/hotel-api/1.0/bookings', {
      method: 'POST',
      json: body,
      headers: { 'Content-Type': 'application/json' },
      timeoutMs: 20000
    });
    return data;
  }

  async cancelBooking(reference) {
    if (!this.isConfigured('hotels')) throw new Error('HBX Hotels não configurado.');
    const ref = String(reference || '').trim();
    if (!ref) throw new Error('Localizador HBX em falta para cancelar.');
    const { data } = await this.request('hotels', `/hotel-api/1.0/bookings/${encodeURIComponent(ref)}?cancellationFlag=CANCELLATION`, {
      method: 'DELETE',
      timeoutMs: 20000
    });
    return data;
  }

  async searchHotels(input = {}) {
    if (!this.isConfigured('hotels')) throw new Error('HBX Hotels não configurado.');
    const portfolio = await this.hotelPortfolioByDestination(input.destinationCode, input.limit || 80);
    const byCode = new Map(portfolio.hotels.map(h => [String(h.code), h]));
    const codes = [...byCode.keys()].map(Number).filter(Number.isFinite).slice(0, 100);
    if (!codes.length) return { hotels: [], destinationCode: input.destinationCode, portfolioSource: portfolio.source };
    const raw = await this.availabilityByHotelCodes({ ...input, hotelCodes: codes });
    const liveHotels = arr(raw?.hotels?.hotels || raw?.hotels || raw?.hotel);
    const hotels = liveHotels.map(h => normalizeHotelAvailability(h, byCode.get(String(h.code)) || {})).filter(Boolean);
    return { hotels, destinationCode: input.destinationCode, portfolioSource: portfolio.source, total: num(raw?.hotels?.total, hotels.length) };
  }

  async searchActivities(input = {}) {
    if (!this.isConfigured('activities')) throw new Error('HBX Activities não configurado.');
    const destinationCode = String(input.destinationCode || '').toUpperCase();
    if (!destinationCode) throw new Error('Destino HBX em falta para atividades.');
    const ages = [
      ...Array.from({ length: Math.max(1, Number(input.adults || 1)) }, () => 30),
      ...(input.childAges || []).map(Number).filter(Number.isFinite),
      ...(input.infantAges || []).map(Number).filter(Number.isFinite)
    ];
    const body = {
      filters: [{ searchFilterItems: [{ type: 'destination', value: destinationCode }] }],
      from: input.from,
      to: input.to,
      language: 'en',
      paxes: ages.map(age => ({ age })),
      pagination: { itemsPerPage: Math.max(1, Math.min(20, Number(input.limit || 8))), page: 1 },
      order: 'DEFAULT'
    };
    const { data } = await this.request('activities', '/activity-api/3.0/activities', { method: 'POST', json: body, headers: { 'Content-Type': 'application/json' }, timeoutMs: 16000 });
    const activities = arr(data?.activities).map(normalizeActivity).filter(x => x.code);
    return { activities, total: num(data?.pagination?.totalItems, activities.length) };
  }

  async searchTransfers(input = {}) {
    if (!this.isConfigured('transfers')) throw new Error('HBX Transfers não configurado.');
    const airport = String(input.airportIata || '').toUpperCase();
    const hotelCode = String(input.hotelCode || '').replace(/[^A-Z0-9.-]/gi, '');
    if (!airport || !hotelCode) throw new Error('Aeroporto ou hotel HBX em falta para procurar transfer.');
    const outbound = input.outbound || `${input.checkIn}T12:00:00`;
    const inbound = input.inbound || `${input.checkOut}T10:00:00`;
    const adults = Math.max(1, Number(input.adults || 1));
    const children = Math.max(0, Number(input.children || 0));
    const infants = Math.max(0, Number(input.infants || 0));
    const path = `/transfer-api/1.0/availability/en/from/IATA/${encodeURIComponent(airport)}/to/ATLAS/${encodeURIComponent(hotelCode)}/${encodeURIComponent(outbound)}/${encodeURIComponent(inbound)}/${adults}/${children}/${infants}`;
    const { data } = await this.request('transfers', path, { timeoutMs: 16000 });
    const services = arr(data?.services || data?.service).map(normalizeTransfer).filter(x => x.rateKey || x.id);
    return { services };
  }
}

module.exports = {
  HbxClient,
  signature,
  normalizeHotelAvailability,
  normalizeActivity,
  normalizeTransfer
};
