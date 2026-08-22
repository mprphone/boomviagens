const crypto = require('crypto');
const { paymentsMode } = require('../runtimeConfig');
const { safeError } = require('../httpUtils');
// Rotas publicas: nada disto exige sessao. Pesquisa, calendario de precos,
// destaques da homepage, saude do servico e o chat local.

// Preco cotado fica valido por 30 minutos - depois disso o checkout pede
// para pesquisar de novo em vez de aceitar um preco antigo.
const OFFER_TOKEN_TTL_MS = 30 * 60 * 1000;
const { resolveDestination, resolveOrigin, destinationMatches } = require('../integrations/destinations');

module.exports = function registerPublicRoutes(router, ctx) {
  const { json, readDb, updateDb, tourdiezAdapter, searchOffers, baseOffers, getOfferById, searchPayload, normalize, rateLimit, domain, travelIntelligence, serviceCatalog, hbx, duffel, applyMargin } = ctx;
  const { publicDeals, ensureCollections, addOperatorLog, now } = domain;
  const { sealToken, openToken } = ctx.auth;

  function demoDataEnabled() {
    // Dados fictícios nunca são permitidos em Vercel (preview ou produção).
    // Para desenvolvimento local são necessários DOIS opt-ins explícitos,
    // evitando que uma variável antiga ENABLE_DEMO_SEARCH=true publique
    // Disneyland/Caribe como se fossem disponibilidade real.
    const enabled = String(process.env.ENABLE_DEMO_SEARCH || '').toLowerCase() === 'true';
    const acknowledged = String(process.env.BOOM_UNSAFE_DEMO_DATA || '') === 'I_UNDERSTAND';
    return enabled && acknowledged && !process.env.VERCEL;
  }

  // Cache curto + deduplicacao de pedidos em voo. Evita que duplo clique,
  // refresh ou dois separadores iguais gastem novamente quota HBX/Duffel.
  // Em Vercel esta cache e por instancia; para grande escala deve ser
  // substituida por Redis/Upstash, mas ja reduz bastante o desperdicio.
  const providerSearchCache = new Map();
  async function cachedProviderCall(provider, key, ttlMs, fn) {
    const cacheKey = `${provider}:${key}`;
    const current = providerSearchCache.get(cacheKey);
    if (current && current.expiresAt > Date.now()) return current.promise;
    const promise = Promise.resolve().then(fn).catch(err => {
      providerSearchCache.delete(cacheKey);
      throw err;
    });
    providerSearchCache.set(cacheKey, { promise, expiresAt: Date.now() + ttlMs });
    if (providerSearchCache.size > 250) {
      const nowTs = Date.now();
      for (const [k, v] of providerSearchCache) {
        if (v.expiresAt <= nowTs || providerSearchCache.size > 200) providerSearchCache.delete(k);
      }
    }
    return promise;
  }
  function providerQueryKey(destination, origin, parsed) {
    return JSON.stringify({
      d: destination?.name || '', hbx: destination?.hbxCode || '', iata: destination?.iata || '', o: origin?.iata || '',
      in: parsed.checkin, out: parsed.checkout, a: parsed.adults, c: parsed.children, i: parsed.infants,
      ca: parsed.childAges || [], ia: parsed.infantAges || []
    });
  }

  // Assina costPrice/finalPrice/referencias do operador no momento em que
  // o preco e calculado no servidor (ver auditoria) - o browser reenvia
  // isto tal e qual no checkout, mas so os valores de dentro do token
  // assinado sao usados para dinheiro; nunca o que o browser disser que
  // costPrice/finalPrice sao.
  function signOffer(offer) {
    return sealToken({
      scope: 'offer',
      // Identidade comercial imutável da oferta. Não basta assinar o preço:
      // sem isto um browser manipulado podia partilhar/confirmar "Hotel B"
      // mantendo por baixo a rateKey do Hotel A.
      id: String(offer.id || ''),
      destination: String(offer.destination || ''),
      country: String(offer.country || ''),
      hotel: String(offer.hotel || ''),
      board: String(offer.mealPlanLabel || offer.board || ''),
      roomName: String(offer.roomName || ''),
      nights: Number(offer.nights || 0),
      rating: Number(offer.rating || 0),
      freeCancellation: Boolean(offer.freeCancellation),
      nonRefundable: Boolean(offer.nonRefundable),
      freeCancellationUntil: offer.freeCancellationUntil || null,
      image: String(offer.image || ''),
      costPrice: offer.costPrice,
      finalPrice: offer.finalPrice,
      operator: offer.operator || null,
      tourdiez: offer.tourdiez || null,
      hbx: offer.hbx || null,
      provider: offer.provider || null,
      productType: offer.productType || null,
      flight: offer.flight || null,
      components: offer.components || null,
      // Campos de viagem também ficam assinados. As APIs de enriquecimento
      // usam estes valores, nunca destino/datas/pax arbitrários enviados pelo
      // browser, reduzindo abuso de quotas externas.
      origin: offer.origin || '',
      checkin: offer.checkin || '',
      checkout: offer.checkout || '',
      adults: Number(offer.adults || 1),
      children: Number(offer.children || 0),
      infants: Number(offer.infants || 0),
      childAges: Array.isArray(offer.childAges) ? offer.childAges : [],
      infantAges: Array.isArray(offer.infantAges) ? offer.infantAges : [],
      resumeReservationId: offer.resumeReservationId || null,
      resumeCustomerEmail: offer.resumeCustomerEmail || null,
      exp: Date.now() + OFFER_TOKEN_TTL_MS
    });
  }

  function safeFlight(flight = {}) {
    if (!flight || typeof flight !== 'object') return null;
    return {
      carriers: Array.isArray(flight.carriers) ? flight.carriers.slice(0, 4) : [],
      slices: Array.isArray(flight.slices) ? flight.slices.slice(0, 6).map(slice => ({
        origin: slice.origin || '', destination: slice.destination || '',
        departureAt: slice.departureAt || '', arrivalAt: slice.arrivalAt || '',
        durationMinutes: Number(slice.durationMinutes || 0), stops: Number(slice.stops || 0),
        segments: Array.isArray(slice.segments) ? slice.segments.slice(0, 5).map(seg => ({
          flightNumber: seg.flightNumber || '', operatingCarrier: seg.operatingCarrier || seg.marketingCarrier || '',
          origin: seg.origin || '', destination: seg.destination || '', departureAt: seg.departureAt || '', arrivalAt: seg.arrivalAt || ''
        })) : []
      })) : [],
      conditions: flight.conditions ? {
        changeBeforeDeparture: flight.conditions.changeBeforeDeparture || null,
        refundBeforeDeparture: flight.conditions.refundBeforeDeparture || null
      } : null
    };
  }

  function publicOfferFields(offer = {}) {
    const copy = { ...offer };
    // Nunca expor NET/margem/trace do fornecedor no browser. O checkout
    // recupera os valores financeiros do offerToken assinado no servidor.
    delete copy.costPrice;
    delete copy.marginRule;
    delete copy.marginPercent;
    delete copy.marginValue;
    delete copy.trace;
    delete copy.operator;
    delete copy.provider;
    delete copy.tourdiez;
    delete copy.hbx;
    delete copy.components;
    delete copy.operatorRefs;
    delete copy.operatorData;
    delete copy.targetPrice;
    delete copy.minimumPrice;
    delete copy.minimumMarginPercent;
    delete copy.concessionAvailable;
    delete copy.net;
    delete copy.rateKey;
    delete copy.rateType;
    if (copy.flight) copy.flight = safeFlight(copy.flight);
    return copy;
  }

  function attachOfferTokens(results) {
    return results.map(offer => {
      const parentToken = signOffer(offer);
      const publicOffer = publicOfferFields(offer);
      return {
        ...publicOffer,
        offerToken: parentToken,
        roomOptions: Array.isArray(offer.roomOptions)
          ? offer.roomOptions.map(opt => {
              const signedOption = {
                ...offer,
                ...opt,
                operator: offer.operator,
                tourdiez: offer.tourdiez ? {
                  ...offer.tourdiez,
                  idDistributions: opt.idDistributions || offer.tourdiez.idDistributions,
                  code: opt.roomCode || offer.tourdiez.code
                } : null,
                hbx: offer.hbx ? {
                  ...offer.hbx,
                  rateKey: opt.rateKey || offer.hbx.rateKey,
                  rateType: opt.rateType || offer.hbx.rateType,
                  roomCode: opt.roomCode || offer.hbx.roomCode
                } : null
              };
              return { ...publicOfferFields(opt), offerToken: signOffer(signedOption) };
            })
          : offer.roomOptions
      };
    });
  }


  function hbxHotelOffers(searchResult, parsed, margins, destination) {
    const items = [];
    const targetCurrency = String(process.env.CURRENCY || 'EUR').toUpperCase();
    for (const hotel of searchResult?.hotels || []) {
      if (hotel.currency && String(hotel.currency).toUpperCase() !== targetCurrency) continue;
      const baseRate = hotel.bestRate;
      if (!baseRate?.net) continue;
      const price = applyMargin(baseRate.net, destination.name, margins, { operator: 'HBX Hotels', channel: 'ONLINE', productType: 'HOTEL' });
      const roomOptions = (hotel.rates || []).slice(0, 10).map(rate => {
        const p = applyMargin(rate.net, destination.name, margins, { operator: 'HBX Hotels', channel: 'ONLINE', productType: 'HOTEL' });
        return {
          rateKey: rate.rateKey,
          rateType: rate.rateType,
          roomCode: rate.roomCode,
          roomName: rate.roomName,
          mealPlan: rate.boardCode,
          mealPlanLabel: rate.boardName || 'Só alojamento',
          freeCancellation: Boolean(rate.freeCancellation),
          nonRefundable: Boolean(rate.nonRefundable),
          freeCancellationUntil: rate.freeCancellationUntil || null,
          finalPrice: p.finalPrice,
          net: p.costPrice,
          cancellationPolicies: rate.cancellationPolicies || []
        };
      });
      items.push({
        id: `hbx-${hotel.hotelCode}-${Buffer.from(baseRate.rateKey).toString('base64url').slice(0, 12)}`,
        operator: 'HBX Hotels', provider: 'HBX', productType: 'HOTEL', live: true, available: true,
        destination: destination.name, country: destination.country, hotel: hotel.name,
        board: baseRate.boardName || 'Só alojamento', nights: parsed.nights, rating: hotel.stars || 4,
        freeCancellation: Boolean(baseRate.freeCancellation), nonRefundable: Boolean(baseRate.nonRefundable), freeCancellationUntil: baseRate.freeCancellationUntil || null, adults: parsed.adults, children: parsed.children, infants: parsed.infants,
        childAges: parsed.childAges, infantAges: parsed.infantAges, origin: parsed.origin, checkin: parsed.checkin, checkout: parsed.checkout,
        latitude: hotel.latitude, longitude: hotel.longitude, address: hotel.address || '', description: hotel.description || '', image: hotel.image || '',
        ...price,
        roomOptions,
        hbx: { hotelCode: hotel.hotelCode, giataCode: hotel.giataCode || '', destinationCode: hotel.destinationCode || destination.hbxCode, rateKey: baseRate.rateKey, rateType: baseRate.rateType, roomCode: baseRate.roomCode, hotelName: hotel.name || '', latitude: hotel.latitude, longitude: hotel.longitude },
        operatorReliability: 9,
        label: 'Alojamento disponível'
      });
    }
    return items;
  }

  function combineHotelWithFlight(hotelOffer, flightOffer, margins, destination) {
    if (!hotelOffer || !flightOffer) return null;
    const targetCurrency = String(process.env.CURRENCY || 'EUR').toUpperCase();
    if (String(flightOffer.totalCurrency || targetCurrency).toUpperCase() !== targetCurrency) return null;
    const flightPrice = applyMargin(flightOffer.totalAmount, destination.name, margins, { operator: 'Duffel', channel: 'ONLINE', productType: 'VOO' });
    const totalCost = Number(hotelOffer.costPrice || 0) + Number(flightPrice.costPrice || 0);
    const totalSale = Number(hotelOffer.finalPrice || 0) + Number(flightPrice.finalPrice || 0);
    const roomOptions = (hotelOffer.roomOptions || []).map(opt => {
      const hotelNet = Number(opt.net || hotelOffer.costPrice || 0);
      const hotelSale = Number(opt.finalPrice || hotelOffer.finalPrice || 0);
      return {
        ...opt,
        costPrice: Number((hotelNet + flightPrice.costPrice).toFixed(2)),
        finalPrice: Number((hotelSale + flightPrice.finalPrice).toFixed(2)),
        components: {
          hotel: { provider: 'HBX', hotelCode: hotelOffer.hbx?.hotelCode, giataCode: hotelOffer.hbx?.giataCode || '', destinationCode: hotelOffer.hbx?.destinationCode || destination.hbxCode, hotelName: hotelOffer.hotel || '', latitude: hotelOffer.latitude, longitude: hotelOffer.longitude, rateKey: opt.rateKey || hotelOffer.hbx?.rateKey, rateType: opt.rateType || hotelOffer.hbx?.rateType, roomCode: opt.roomCode || hotelOffer.hbx?.roomCode, costPrice: hotelNet, finalPrice: hotelSale },
          flight: { componentId: 'flight-selected', provider: 'Duffel', offerId: flightOffer.id, costPrice: flightPrice.costPrice, finalPrice: flightPrice.finalPrice, offer: flightOffer }
        }
      };
    });
    return {
      ...hotelOffer,
      id: `dyn-${hotelOffer.id}-${flightOffer.id}`,
      operator: 'HBX + Duffel', provider: 'MULTI', productType: 'DYNAMIC_PACKAGE',
      costPrice: Number(totalCost.toFixed(2)), finalPrice: Number(totalSale.toFixed(2)),
      marginValue: Number((totalSale - totalCost).toFixed(2)),
      board: hotelOffer.board,
      roomOptions,
      flightIncluded: true,
      flight: flightOffer,
      components: { hotel: { provider: 'HBX', hotelCode: hotelOffer.hbx?.hotelCode, giataCode: hotelOffer.hbx?.giataCode || '', destinationCode: hotelOffer.hbx?.destinationCode || destination.hbxCode, hotelName: hotelOffer.hotel || '', latitude: hotelOffer.latitude, longitude: hotelOffer.longitude, rateKey: hotelOffer.hbx?.rateKey, rateType: hotelOffer.hbx?.rateType, roomCode: hotelOffer.hbx?.roomCode, costPrice: hotelOffer.costPrice, finalPrice: hotelOffer.finalPrice }, flight: { componentId: 'flight-selected', provider: 'Duffel', offerId: flightOffer.id, costPrice: flightPrice.costPrice, finalPrice: flightPrice.finalPrice, offer: flightOffer } },
      label: 'Voo + hotel',
      score: Math.max(1, Number(hotelOffer.score || 80) + 3)
    };
  }

  function rankOffers(offers = []) {
    const groups = new Map();
    for (const offer of offers) {
      const key = String(offer.productType || 'OTHER');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(offer);
    }
    const ranked = [];
    for (const group of groups.values()) {
      const prices = group.map(o => Number(o.finalPrice || 0)).filter(p => p > 0);
      const minPrice = prices.length ? Math.min(...prices) : 0;
      const maxPrice = prices.length ? Math.max(...prices) : minPrice;
      for (const offer of group) {
        const price = Number(offer.finalPrice || 0);
        const priceScore = price > 0 ? (maxPrice === minPrice ? 25 : 25 * (maxPrice - price) / Math.max(1, maxPrice - minPrice)) : 0;
        const ratingScore = Math.max(0, Math.min(5, Number(offer.rating || 0))) * 3;
        const flexibilityScore = offer.freeCancellation ? 8 : offer.nonRefundable ? -3 : 2;
        const reliabilityScore = Math.max(0, Math.min(10, Number(offer.operatorReliability || (offer.live ? 8 : 5)))) * 0.5;
        ranked.push({ ...offer, score: Number((45 + priceScore + ratingScore + flexibilityScore + reliabilityScore).toFixed(2)) });
      }
    }
    return ranked.sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || Number(a.finalPrice || 0) - Number(b.finalPrice || 0));
  }

  function tripBinding(signed = {}) {
    const hotelCode = signed.components?.hotel?.hotelCode || signed.hbx?.hotelCode || '';
    const raw = [
      signed.destination || '', signed.origin || '', signed.checkin || '', signed.checkout || '',
      Number(signed.adults || 0), Number(signed.children || 0), Number(signed.infants || 0), hotelCode
    ].join('|');
    return crypto.createHash('sha256').update(raw).digest('base64url');
  }

  function signTripComponent(kind, payload, pricing = {}, meta = {}) {
    return sealToken({
      scope: 'trip-component', kind, payload,
      tripBinding: meta.tripBinding || '',
      componentId: String(meta.componentId || payload?.id || payload?.code || `${kind}-${Date.now()}`),
      costPrice: Number(pricing.costPrice || 0), finalPrice: Number(pricing.finalPrice || 0),
      exp: Date.now() + OFFER_TOKEN_TTL_MS
    });
  }

  function safeTransferOption(service, pricing, index, signed) {
    const payload = { id: service.id || '', rateKey: service.rateKey || '', transferType: service.transferType || '', vehicle: service.vehicle || '', category: service.category || '' };
    return {
      componentId: `transfer-${index + 1}`, kind: 'transfer',
      title: service.vehicle || service.category || 'Transfer aeroporto ↔ hotel',
      subtitle: [service.transferType, service.category].filter(Boolean).join(' · '),
      image: service.image || '', minPax: Number(service.minPax || 0), maxPax: Number(service.maxPax || 0),
      finalPrice: Number(pricing.finalPrice || 0), currency: 'EUR',
      flexible: Array.isArray(service.cancellationPolicies) && service.cancellationPolicies.length === 0,
      componentToken: signTripComponent('transfer', payload, pricing, { componentId: `transfer-${index + 1}`, tripBinding: tripBinding(signed) })
    };
  }

  function safeActivityOption(activity, pricing, index, signed) {
    return {
      componentId: `activity-${index + 1}`, kind: 'activity', name: activity.name || 'Atividade',
      description: String(activity.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 260),
      image: activity.image || '', finalPrice: Number(pricing.finalPrice || 0), currency: 'EUR',
      priceLabel: pricing.finalPrice > 0 ? 'desde' : 'sob consulta',
      componentToken: pricing.finalPrice > 0 ? signTripComponent('activity', { code: activity.code || '', name: activity.name || 'Atividade' }, pricing, { componentId: `activity-${index + 1}`, tripBinding: tripBinding(signed) }) : null
    };
  }

  function safeFlightOption(flight, pricing, index, signed, canSelect = true) {
    const selectedId = signed?.components?.flight?.offerId || signed?.flight?.id || '';
    const publicFlight = safeFlight(flight);
    const payload = { id: flight.id || '', ...publicFlight };
    return {
      componentId: `flight-${index + 1}`, kind: 'flight', selected: Boolean(selectedId && selectedId === flight.id),
      ...publicFlight, finalPrice: Number(pricing.finalPrice || 0), currency: 'EUR',
      componentToken: canSelect ? signTripComponent('flight', payload, pricing, { componentId: `flight-${index + 1}`, tripBinding: tripBinding(signed) }) : null
    };
  }

  function publicBaseUrl(req) {
    const candidates = [
      process.env.PUBLIC_BASE_URL,
      process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ''
    ].filter(Boolean);
    for (const candidate of candidates) {
      try {
        const u = new URL(candidate);
        if (u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) return u.origin;
      } catch {}
    }
    const rawHost = String(req.headers.host || 'localhost:3000').trim();
    const host = /^[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(rawHost) ? rawHost : 'localhost:3000';
    const forwarded = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
    const proto = forwarded === 'https' ? 'https' : (host.startsWith('localhost') || host.startsWith('127.0.0.1')) ? 'http' : 'https';
    return `${proto}://${host}`;
  }

  function cloneComponents(value) {
    return value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : {};
  }

  function baseComponentsFromSigned(signed) {
    const components = cloneComponents(signed.components);
    if (!components.hotel && signed.productType === 'HOTEL' && signed.hbx) {
      components.hotel = {
        provider: 'HBX', hotelCode: signed.hbx.hotelCode || '', giataCode: signed.hbx.giataCode || '', rateKey: signed.hbx.rateKey || '',
        rateType: signed.hbx.rateType || '', roomCode: signed.hbx.roomCode || '',
        costPrice: Number(signed.costPrice || 0), finalPrice: Number(signed.finalPrice || 0)
      };
    }
    if (!components.flight && signed.productType === 'FLIGHT' && signed.flight) {
      components.flight = { componentId: 'flight-selected', provider: 'Duffel', offerId: signed.flight.id || '', costPrice: Number(signed.costPrice || 0), finalPrice: Number(signed.finalPrice || 0), offer: signed.flight };
    }
    if (components.flight && !components.flight.offer && signed.flight) components.flight.offer = signed.flight;
    if (!Array.isArray(components.activities)) components.activities = [];
    return components;
  }

  function componentTotals(components = {}) {
    const parts = [components.hotel, components.flight, components.transfer, ...(Array.isArray(components.activities) ? components.activities : [])].filter(Boolean);
    return {
      costPrice: Number(parts.reduce((sum, p) => sum + Number(p.costPrice || 0), 0).toFixed(2)),
      finalPrice: Number(parts.reduce((sum, p) => sum + Number(p.finalPrice || 0), 0).toFixed(2))
    };
  }

  function publicSelectedExtras(components = {}) {
    return {
      flight: components.flight ? { componentId: components.flight.componentId || 'flight-selected', finalPrice: Number(components.flight.finalPrice || 0) } : null,
      transfer: components.transfer ? { componentId: components.transfer.componentId || 'transfer', title: components.transfer.title || components.transfer.payload?.vehicle || 'Transfer', finalPrice: Number(components.transfer.finalPrice || 0) } : null,
      activities: (components.activities || []).map(x => ({ componentId: x.componentId, name: x.name || x.payload?.name || 'Atividade', finalPrice: Number(x.finalPrice || 0) }))
    };
  }

  router.get('/api/health', async (req, res) => {
    return json(res, 200, { ok: true, service: 'Boomviagens', time: now() });
  });

  router.get('/api/config', async (req, res) => {
    const db = ensureCollections(await readDb());
    // So agencias com morada preenchida (nunca uma agencia recem-criada e
    // ainda vazia) - ver seccao "4 agencias" da homepage.
    const branches = db.branches.filter(b => b.active && b.address).map(b => ({ name: b.name, address: b.address, phone: b.phone }));
    const integrationStatus = travelIntelligence.status();
    const company = db.company || {};
    const publicCompany = {
      name: company.name || company.brand || 'Boomviagens',
      brand: company.brand || company.name || 'Boomviagens',
      domain: company.domain || '',
      email: company.email || '',
      phone: company.phone || '',
      rnavt: company.rnavt || '',
      address: company.address || ''
    };
    const currentPaymentsMode = paymentsMode(process.env);
    const paymentMethods = currentPaymentsMode === 'disabled' ? [] : (ctx.paymentGateways?.publicMethods?.() || []);
    return json(res, 200, {
      company: publicCompany,
      branches,
      paymentsMode: currentPaymentsMode,
      paymentMethods,
      paymentAvailability: currentPaymentsMode === 'disabled'
        ? 'disabled'
        : paymentMethods.length ? 'available' : 'misconfigured',
      // O site público conhece capacidades, não nomes/estado comercial dos
      // fornecedores. A topologia completa só existe no API Lab do backoffice.
      features: {
        exploreZone: integrationStatus.some(x => x.id === 'google-places' && x.enabled),
        travelIntelligence: true
      },
      services: serviceCatalog?.publicServices?.() || []
    });
  });

  router.get('/api/deals', async (req, res) => {
    // baseOffers sao dados de demonstracao. Nunca publicar preços/hotéis
    // fictícios num deployment real só para preencher a homepage. Até
    // existir uma tabela/campanha validada pelo backoffice, produção mostra
    // inspiração sem preço e convida o cliente a pesquisar disponibilidade.
    const allowDemo = demoDataEnabled();
    if (!allowDemo) return json(res, 200, { ok: true, deals: [], demo: false, message: 'Pesquise um destino para consultar preços e disponibilidade em tempo real.' });
    const db = await readDb();
    return json(res, 200, { ok: true, deals: publicDeals(db, baseOffers, getOfferById), demo: true });
  });

  // Sugestões de destino vêm do servidor para o frontend não ficar preso a
  // uma lista hardcoded. Incluem o aeroporto de referência usado pelo motor
  // de voos, mas nunca credenciais de fornecedores.
  router.get('/api/airports/suggest', async (req, res, url) => {
    const limited = await rateLimit(req, res, 'airports-suggest', 120, 60 * 1000);
    if (limited) return limited;
    const q = String(url.searchParams.get('q') || '').trim().slice(0, 80);
    if (q.length < 2) return json(res, 200, { ok: true, places: [] });
    if (!duffel?.isConfigured()) return json(res, 503, { ok: false, error: 'Pesquisa mundial de aeroportos temporariamente indisponível.' });
    try {
      const places = await cachedProviderCall('duffel-places', q.toLowerCase(), 24 * 60 * 60 * 1000, () => duffel.suggestPlaces(q, 10));
      return json(res, 200, { ok: true, places });
    } catch (err) {
      return json(res, 502, { ok: false, error: safeError(err, 'Não foi possível procurar aeroportos.') });
    }
  });

  router.get('/api/destinations/suggest', async (req, res, url) => {
    const limited = await rateLimit(req, res, 'destinations-suggest', 120, 60 * 1000);
    if (limited) return limited;
    const q = String(url.searchParams.get('q') || '').slice(0, 80);
    const local = travelIntelligence.suggest(q, 10);
    if (!duffel?.isConfigured() || q.trim().length < 2) return json(res, 200, { ok: true, destinations: local });
    try {
      const places = await cachedProviderCall('duffel-destination-places', q.toLowerCase(), 24 * 60 * 60 * 1000, () => duffel.suggestPlaces(q, 10));
      const dynamic = places.filter(p => p.type === 'city' || p.iataCityCode).map(p => ({
        name: p.cityName || p.name, country: p.countryCode || '', iata: p.iataCityCode || p.iataCode, hbxCode: p.iataCityCode || p.iataCode, icon: '•'
      }));
      const seen = new Set();
      const merged = [...local, ...dynamic].filter(d => { const k = `${String(d.name).toLowerCase()}|${d.iata || ''}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 10);
      return json(res, 200, { ok: true, destinations: merged });
    } catch {
      return json(res, 200, { ok: true, destinations: local });
    }
  });

  function flightOnlyOffer(flight, parsed, destination, origin, margins, index = 0) {
    const targetCurrency = String(process.env.CURRENCY || 'EUR').toUpperCase();
    if (String(flight.totalCurrency || targetCurrency).toUpperCase() !== targetCurrency) return null;
    const pricing = applyMargin(Number(flight.totalAmount || 0), destination.name, margins, { operator: 'Duffel', channel: 'ONLINE', productType: 'VOO' });
    return {
      id: `flight-${flight.id || index}`,
      operator: 'Duffel', provider: 'Duffel', productType: 'FLIGHT', live: true, available: true,
      destination: destination.name, country: destination.country,
      hotel: `Voo ${origin?.iata || parsed.origin} → ${destination.iata}`,
      board: 'Voo', nights: parsed.nights, rating: 0, freeCancellation: false, nonRefundable: false,
      adults: parsed.adults, children: parsed.children, infants: parsed.infants, childAges: parsed.childAges, infantAges: parsed.infantAges,
      origin: parsed.origin, checkin: parsed.checkin, checkout: parsed.checkout, image: '',
      costPrice: pricing.costPrice, finalPrice: pricing.finalPrice, marginValue: pricing.marginValue,
      flight, components: { flight: { componentId: 'flight-selected', provider: 'Duffel', offerId: flight.id, costPrice: pricing.costPrice, finalPrice: pricing.finalPrice, offer: flight } },
      operatorReliability: 9, label: 'Voo disponível', score: Math.max(1, 100 - index)
    };
  }

  router.post('/api/flights/search', async (req, res) => {
    const limited = await rateLimit(req, res, 'flight-search', 20, 60 * 1000);
    if (limited) return limited;
    const raw = await ctx.parseBody(req);
    const db = await readDb();
    if (!duffel?.isConfigured()) return json(res, 503, { ok: false, error: 'A pesquisa de voos ainda não está configurada neste ambiente.' });

    const tripType = String(raw.tripType || 'ROUND_TRIP').toUpperCase();
    const adults = Math.max(1, Math.min(8, Number(raw.adults || 1)));
    const children = Math.max(0, Math.min(8, Number(raw.children || 0)));
    const infants = Math.max(0, Math.min(8, Number(raw.infants || 0)));
    const childAges = String(raw.childAges || '').split(',').filter(Boolean).map(Number);
    const infantAges = String(raw.infantAges || '').split(',').filter(Boolean).map(Number);
    let result; let parsed; let displayDestination;

    if (tripType === 'MULTI_CITY') {
      let suppliedSlices = raw.slices;
      if (!Array.isArray(suppliedSlices) && raw.multiCitySlices) { try { suppliedSlices = JSON.parse(String(raw.multiCitySlices)); } catch {} }
      const slices = Array.isArray(suppliedSlices) ? suppliedSlices.slice(0, 6).map(x => ({
        origin: String(x.origin || '').toUpperCase().trim(), destination: String(x.destination || '').toUpperCase().trim(), departureDate: String(x.departureDate || '')
      })) : [];
      if (slices.length < 2) return json(res, 400, { ok: false, error: 'Adicione pelo menos dois trajetos para uma viagem multi-cidade.' });
      const key = JSON.stringify({ slices, adults, children, infants, childAges, infantAges, cabinClass: raw.cabinClass || 'economy' });
      result = await cachedProviderCall('duffel-multicity', key, 60 * 1000, () => duffel.searchFlightsMulti({ slices, adults, children, infants, childAges, infantAges, cabinClass: raw.cabinClass || 'economy', limit: 40 }));
      displayDestination = slices.map(x => `${x.origin}–${x.destination}`).join(' · ');
      parsed = { searchType: 'FLIGHT', tripType, slices, destination: displayDestination, origin: slices[0]?.origin || '', checkin: slices[0]?.departureDate || '', checkout: slices[slices.length-1]?.departureDate || '', adults, children, infants, childAges, infantAges };
    } else {
      const body = searchPayload(raw);
      const baseParsed = searchOffers(body, db.margins).parsed;
      const originCode = String(raw.originIata || raw.origin || baseParsed.origin || '').toUpperCase().trim();
      const destinationCode = String(raw.destinationIata || raw.destination || '').toUpperCase().trim();
      if (!/^[A-Z]{3}$/.test(originCode) || !/^[A-Z]{3}$/.test(destinationCode)) return json(res, 400, { ok: false, error: 'Escolha a origem e o destino a partir das sugestões de aeroportos/cidades.' });
      const returnDate = tripType === 'ONE_WAY' ? '' : baseParsed.checkout;
      const key = JSON.stringify({ originCode, destinationCode, departureDate: baseParsed.checkin, returnDate, adults, children, infants, childAges, infantAges, cabinClass: raw.cabinClass || 'economy' });
      result = await cachedProviderCall('duffel-standalone', key, 60 * 1000, () => duffel.searchFlights({
        origin: originCode, destination: destinationCode, departureDate: baseParsed.checkin, returnDate, adults, children, infants, childAges, infantAges, cabinClass: raw.cabinClass || 'economy', limit: 40
      }));
      displayDestination = String(raw.destinationLabel || raw.destination || destinationCode);
      parsed = { ...baseParsed, searchType: 'FLIGHT', tripType, checkout: tripType === 'ONE_WAY' ? '' : baseParsed.checkout, destination: displayDestination, destinationIata: destinationCode, origin: String(raw.originLabel || raw.origin || originCode), originIata: originCode, adults, children, infants, childAges, infantAges };
    }

    const pricingDestination = displayDestination || 'Voo';
    const offers = (result.offers || []).map((flight, i) => {
      const price = applyMargin(Number(flight.totalAmount || 0), pricingDestination, db.margins, { operator: 'Duffel', channel: 'ONLINE', productType: 'VOO' });
      return {
        id: `flight-${flight.id || i}`, operator: 'Duffel', provider: 'Duffel', productType: 'FLIGHT', live: true, available: true,
        destination: displayDestination, country: '', hotel: tripType === 'MULTI_CITY' ? `Voo multi-cidade · ${displayDestination}` : `Voo ${parsed.originIata || parsed.origin} → ${parsed.destinationIata || displayDestination}`,
        board: 'Voo', nights: 0, rating: 0, freeCancellation: false, nonRefundable: false, adults, children, infants, childAges, infantAges,
        origin: parsed.originIata || parsed.origin, checkin: parsed.checkin, checkout: parsed.checkout, image: '',
        costPrice: price.costPrice, finalPrice: price.finalPrice, marginValue: price.marginValue, flight,
        components: { flight: { componentId: 'flight-selected', provider: 'Duffel', offerId: flight.id, costPrice: price.costPrice, finalPrice: price.finalPrice, offer: flight } },
        operatorReliability: 9, label: tripType === 'MULTI_CITY' ? 'Itinerário multi-cidade' : 'Voo disponível', score: Math.max(1, 100 - i)
      };
    });
    return json(res, 200, { ok: true, parsed, results: attachOfferTokens(offers), count: offers.length, mode: result.mode || duffel.mode?.() || 'test' });
  });

  router.post('/api/experiences/search', async (req, res) => {
    const limited = await rateLimit(req, res, 'experience-search', 20, 60 * 1000);
    if (limited) return limited;
    const body = searchPayload(await ctx.parseBody(req));
    const parsed = searchOffers(body, (await readDb()).margins).parsed;
    const rawDestination = String(parsed.destination || '').trim();
    if (!rawDestination) return json(res, 400, { ok: false, error: 'Escolha um destino válido para procurar experiências.' });
    const destination = resolveDestination(rawDestination);
    const db = await readDb();
    const tasks = [];
    const activities = []; const events = []; const providerStatus = [];
    // Atividades HBX precisam do código interno do destino; sem catálogo
    // ficam simplesmente de fora, com o estado reportado ao frontoffice.
    if (hbx?.isConfigured('activities')) {
      if (destination?.hbxCode) tasks.push(['activities', hbx.searchActivities({ destinationCode: destination.hbxCode, from: parsed.checkin, to: parsed.checkout, adults: parsed.adults, children: parsed.children, infants: parsed.infants, childAges: parsed.childAges, infantAges: parsed.infantAges, limit: 12 })]);
      else providerStatus.push({ provider: 'activities', ok: false, configured: true, error: 'Destino sem catálogo de atividades.' });
    } else {
      providerStatus.push({ provider: 'activities', ok: false, configured: false, error: 'Por configurar' });
    }
    // A Ticketmaster aceita qualquer cidade em texto livre: quando o destino
    // não está no catálogo interno usamos o texto pesquisado como cidade, para
    // que pesquisas como "Lisboa" ou "Porto" mostrem bilhetes na mesma.
    const eventCity = destination?.eventCity || rawDestination;
    if (travelIntelligence?.ticketmaster?.isConfigured?.()) tasks.push(['events', travelIntelligence.ticketmaster.searchEvents({ city: eventCity, countryCode: destination?.countryCode, startDate: parsed.checkin, endDate: parsed.checkout, limit: 12 })]);
    else providerStatus.push({ provider: 'events', ok: false, configured: false, error: 'Por configurar' });
    const settled = await Promise.allSettled(tasks.map(x => x[1]));
    settled.forEach((r, i) => {
      const name = tasks[i][0];
      if (r.status === 'rejected') { providerStatus.push({ provider: name, ok: false, configured: true, error: r.reason?.message || 'Indisponível' }); return; }
      providerStatus.push({ provider: name, ok: true, configured: true });
      if (name === 'activities') {
        for (const [index, a] of (r.value.activities || []).entries()) {
          const base = Number(a.fromPrice || 0); const pricing = base > 0 ? applyMargin(base, destination?.name || rawDestination, db.margins, { operator: 'HBX Activities', channel: 'ONLINE', productType: 'ACTIVITY' }) : { finalPrice: 0 };
          activities.push({ id: a.code || `act-${index}`, name: a.name || 'Experiência', description: String(a.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 320), image: a.image || '', finalPrice: Number(pricing.finalPrice || 0), currency: a.currency || 'EUR', source: 'HBX Activities' });
        }
      } else if (name === 'events') events.push(...(r.value.events || []).map(e => ({ ...e, source: 'Ticketmaster' })));
    });
    return json(res, 200, { ok: true, parsed: { ...parsed, destination: destination?.name || rawDestination }, activities, events, providerStatus });
  });

  router.post('/api/assisted-request', async (req, res) => {
    const limited = await rateLimit(req, res, 'assisted-request', 10, 60 * 60 * 1000);
    if (limited) return limited;
    const body = await ctx.parseBody(req);
    const kind = String(body.kind || 'VIAGEM').toUpperCase().slice(0, 30);
    const name = String(body.name || '').trim().slice(0, 120);
    const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
    const phone = String(body.phone || '').trim().slice(0, 40);
    if (!name || (!email && !phone)) return json(res, 400, { ok: false, error: 'Indique o nome e pelo menos email ou telefone.' });
    const requestId = domain.id('lead');
    await updateDb(d => {
      ensureCollections(d);
      d.leads.unshift({ id: requestId, createdAt: now(), source: 'WEBSITE_ASSISTED', kind, name, email, phone, destination: String(body.destination || '').slice(0, 150), dateStart: String(body.checkin || '').slice(0, 30), dateEnd: String(body.checkout || '').slice(0, 30), adults: Number(body.adults || 2), children: Number(body.children || 0), notes: String(body.notes || '').slice(0, 1500), status: 'NOVO' });
      addOperatorLog(d, 'ASSISTED_REQUEST', { requestId, kind, destination: String(body.destination || '').slice(0, 150) });
    });
    return json(res, 200, { ok: true, requestId, message: 'Pedido registado. A equipa Boomviagens pode agora tratá-lo no backoffice.' });
  });

  // Enriquecimento LAZY: só é chamado quando o cliente abre a página da
  // viagem. Assim, percorrer milhares de hotéis não dispara milhares de
  // chamadas a APIs externas. Uma falha de Duffel/Weather/Ticketmaster não
  // impede o cliente de continuar a reservar o produto principal.
  router.post('/api/travel-intelligence', async (req, res) => {
    const limited = await rateLimit(req, res, 'travel-intelligence', 8, 60 * 1000);
    if (limited) return limited;
    const body = await ctx.parseBody(req);
    const signed = openToken(body.offer?.offerToken || body.offerToken || '');
    if (!signed || signed.scope !== 'offer') return json(res, 400, { ok: false, error: 'Atualize a pesquisa para consultar novamente esta viagem.' });
    const offer = {
      destination: String(signed.destination || '').slice(0, 100),
      origin: String(signed.origin || '').slice(0, 30),
      checkin: /^\d{4}-\d{2}-\d{2}$/.test(String(signed.checkin || '')) ? signed.checkin : '',
      checkout: /^\d{4}-\d{2}-\d{2}$/.test(String(signed.checkout || '')) ? signed.checkout : '',
      adults: Math.max(1, Math.min(8, Number(signed.adults || 1))),
      children: Math.max(0, Math.min(8, Number(signed.children || 0))),
      infants: Math.max(0, Math.min(8, Number(signed.infants || 0))),
      childAges: (Array.isArray(signed.childAges) ? signed.childAges : []).map(Number).filter(Number.isFinite).slice(0, 8),
      infantAges: (Array.isArray(signed.infantAges) ? signed.infantAges : []).map(Number).filter(Number.isFinite).slice(0, 8),
      hbx: signed.hbx && typeof signed.hbx === 'object' ? signed.hbx : null,
      flight: signed.flight && typeof signed.flight === 'object' ? signed.flight : null,
      productType: String(signed.productType || '')
    };
    const data = await travelIntelligence.enrichTrip(offer, { exploreGoogle: false });
    const db = await readDb();
    const destination = resolveDestination(offer.destination);
    const canBuild = Boolean(signed.hbx?.hotelCode || signed.components?.hotel?.hotelCode);
    const providers = { ...data.providers };

    // Nunca devolver preços NET/rateKeys das APIs ao browser. Tudo o que é
    // selecionável é reprecificado no servidor e ganha um token assinado.
    if (providers.flights?.ok) {
      const targetCurrency = String(process.env.CURRENCY || 'EUR').toUpperCase();
      const raw = (providers.flights.data?.offers || []).filter(f => String(f.totalCurrency || targetCurrency).toUpperCase() === targetCurrency);
      providers.flights = {
        provider: 'flights', ok: true,
        data: { offers: raw.slice(0, 6).map((flight, index) => {
          const pricing = applyMargin(Number(flight.totalAmount || 0), destination?.name || offer.destination, db.margins, { operator: 'Duffel', channel: 'ONLINE', productType: 'VOO' });
          return safeFlightOption(flight, pricing, index, signed, canBuild);
        }) }
      };
    }

    if (providers.transfers?.ok) {
      const targetCurrency = String(process.env.CURRENCY || 'EUR').toUpperCase();
      const raw = (providers.transfers.data?.services || []).filter(service => String(service.currency || targetCurrency).toUpperCase() === targetCurrency);
      providers.transfers = {
        provider: 'transfers', ok: true,
        data: { services: raw.slice(0, 6).map((service, index) => {
          const base = Number(service.netAmount || service.totalAmount || 0);
          const pricing = applyMargin(base, destination?.name || offer.destination, db.margins, { operator: 'HBX Transfers', channel: 'ONLINE', productType: 'TRANSFER' });
          return safeTransferOption(service, pricing, index, signed);
        }).filter(x => x.finalPrice > 0), unavailableReason: providers.transfers.data?.unavailableReason || '' }
      };
    }

    if (providers.activities?.ok) {
      const targetCurrency = String(process.env.CURRENCY || 'EUR').toUpperCase();
      const raw = (providers.activities.data?.activities || []).filter(activity => String(activity.currency || targetCurrency).toUpperCase() === targetCurrency);
      providers.activities = {
        provider: 'activities', ok: true,
        data: { activities: raw.slice(0, 8).map((activity, index) => {
          const base = Number(activity.fromPrice || 0);
          const pricing = base > 0 ? applyMargin(base, destination?.name || offer.destination, db.margins, { operator: 'HBX Activities', channel: 'ONLINE', productType: 'ACTIVITY' }) : { costPrice: 0, finalPrice: 0 };
          return safeActivityOption(activity, pricing, index, signed);
        }) }
      };
    }

    return json(res, 200, { ok: true, ...data, providers, selectedExtras: publicSelectedExtras(baseComponentsFromSigned(signed)) });
  });

  // Construtor de viagem: troca/adiciona componentes sem confiar em preço
  // vindo do browser. O componente e a oferta base têm ambos tokens assinados.
  router.post('/api/trip-builder/update', async (req, res) => {
    const limited = await rateLimit(req, res, 'trip-builder-update', 20, 60 * 1000);
    if (limited) return limited;
    const body = await ctx.parseBody(req);
    const signed = openToken(body.offerToken || '');
    if (!signed || signed.scope !== 'offer') return json(res, 400, { ok: false, error: 'A oferta expirou. Atualize a pesquisa.' });

    const components = baseComponentsFromSigned(signed);
    if (!components.hotel) {
      return json(res, 409, { ok: false, error: 'Este pacote é fechado pelo operador e não permite trocar componentes individualmente nesta fase.' });
    }

    const action = String(body.action || 'add').toLowerCase();
    const kind = String(body.kind || '').toLowerCase();
    if (action === 'remove') {
      if (kind === 'transfer') components.transfer = null;
      else if (kind === 'activity') components.activities = (components.activities || []).filter(x => x.componentId !== body.componentId);
      else if (kind === 'flight') components.flight = null;
      else return json(res, 400, { ok: false, error: 'Componente inválido.' });
    } else {
      const component = openToken(body.componentToken || '');
      if (!component || component.scope !== 'trip-component') return json(res, 400, { ok: false, error: 'A opção selecionada expirou. Volte a consultar as alternativas.' });
      if (!component.tripBinding || component.tripBinding !== tripBinding(signed)) {
        return json(res, 400, { ok: false, error: 'Esta opção pertence a outra pesquisa/viagem. Atualize as alternativas.' });
      }
      const componentKind = String(component.kind || '').toLowerCase();
      const payload = component.payload || {};
      const common = { componentId: component.componentId, costPrice: Number(component.costPrice || 0), finalPrice: Number(component.finalPrice || 0), payload };
      if (!(common.costPrice >= 0) || !(common.finalPrice >= common.costPrice)) return json(res, 400, { ok: false, error: 'Preço do componente inválido.' });

      if (componentKind === 'flight') {
        components.flight = { ...common, provider: 'Duffel', offerId: payload.id || '', offer: payload };
      } else if (componentKind === 'transfer') {
        components.transfer = { ...common, provider: 'HBX Transfers', title: payload.vehicle || payload.category || 'Transfer aeroporto ↔ hotel' };
      } else if (componentKind === 'activity') {
        const exists = (components.activities || []).some(x => x.componentId === common.componentId || (payload.code && x.payload?.code === payload.code));
        if (!exists) components.activities.push({ ...common, provider: 'HBX Activities', name: payload.name || 'Atividade' });
      } else {
        return json(res, 400, { ok: false, error: 'Tipo de componente não suportado.' });
      }
    }

    const totals = componentTotals(components);
    if (!(totals.finalPrice > 0) || totals.finalPrice < totals.costPrice) return json(res, 400, { ok: false, error: 'Não foi possível recalcular o total da viagem.' });
    const productType = components.flight ? 'DYNAMIC_PACKAGE' : 'HOTEL';
    const flight = components.flight?.offer || components.flight?.payload || null;
    const nextInternal = {
      ...signed, scope: undefined, exp: undefined,
      costPrice: totals.costPrice, finalPrice: totals.finalPrice, productType,
      operator: productType === 'DYNAMIC_PACKAGE' ? 'HBX + Duffel' : (signed.operator || 'HBX Hotels'),
      components, flight
    };
    const offerToken = signOffer(nextInternal);
    return json(res, 200, {
      ok: true,
      offer: {
        finalPrice: totals.finalPrice, productType, offerToken,
        flight: safeFlight(flight), selectedExtras: publicSelectedExtras(components)
      }
    });
  });

  // Google Places fica deliberadamente fora do carregamento automático.
  // Só há custo quando o utilizador pede explicitamente para explorar a zona
  // e a integração estiver ativada por GOOGLE_PLACES_ENABLED=true.
  router.post('/api/explore-zone', async (req, res) => {
    const limited = await rateLimit(req, res, 'explore-zone', 4, 60 * 1000);
    if (limited) return limited;
    const body = await ctx.parseBody(req);
    const signed = openToken(body.offerToken || '');
    if (!signed || signed.scope !== 'offer') return json(res, 400, { ok: false, error: 'Atualize a pesquisa para explorar esta zona.' });
    const destination = String(signed.destination || '').slice(0, 100);
    try {
      const result = await travelIntelligence.exploreZone(destination);
      return json(res, 200, { ok: true, ...result });
    } catch (err) {
      const status = /desligad|configurad/i.test(err.message) ? 503 : 502;
      return json(res, status, { ok: false, error: safeError(err, 'Não foi possível explorar esta zona.') });
    }
  });

  // Calendário de preços: nunca inventar preços "estimados" a partir das
  // ofertas demo em produção. Até existir histórico/cache real por destino,
  // só fica disponível quando ENABLE_DEMO_SEARCH=true (desenvolvimento).
  // Também evitamos 60 chamadas reais aos fornecedores por simples abertura
  // do calendário.
  router.post('/api/price-calendar', async (req, res) => {
    const limited = await rateLimit(req, res, 'price-calendar', 30, 60 * 1000);
    if (limited) return limited;
    const allowDemo = demoDataEnabled();
    if (!allowDemo) {
      return json(res, 200, { ok: true, available: false, days: [], message: 'O calendário de preços ficará disponível quando existir histórico real suficiente para este destino.' });
    }
    const body = searchPayload(await ctx.parseBody(req));
    const db = await readDb();
    const days = [];
    for (let i = 1; i <= 60; i++) {
      const iso = new Date(Date.now() + i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { results } = searchOffers({ ...body, checkin: iso }, db.margins);
      days.push({ date: iso, price: results[0]?.finalPrice || null });
    }
    return json(res, 200, { ok: true, available: true, demo: true, days });
  });

  router.post('/api/search', async (req, res) => {
    const limited = await rateLimit(req, res, 'search', 30, 60 * 1000);
    if (limited) return limited;
    const rawSearchBody = await ctx.parseBody(req);
    const body = searchPayload(rawSearchBody);
    if (rawSearchBody.destinationIata) body.destinationIata = String(rawSearchBody.destinationIata).toUpperCase().trim();
    const db = await readDb();

    // smartParse continua a ser o normalizador comum (datas/pax/origem), mas
    // os resultados demo deixaram de ser fallback universal. Um destino sem
    // stock devolve vazio em vez de Disneyland/Maldivas/Punta Cana aleatórios.
    const demoSearch = searchOffers(body, db.margins);
    const parsed = demoSearch.parsed;
    const requestedSearchType = String(body.searchType || parsed.searchType || 'PACKAGE').toUpperCase();
    const searchType = ['PACKAGE', 'HOTEL'].includes(requestedSearchType) ? requestedSearchType : 'PACKAGE';
    const rawDestinationIata = String(body.destinationIata || '').toUpperCase().trim();
    let destination = resolveDestination(parsed.destination);
    if (!destination && /^[A-Z]{3}$/.test(rawDestinationIata)) {
      destination = { name: parsed.destination || rawDestinationIata, country: '', countryCode: '', iata: rawDestinationIata, hbxCode: rawDestinationIata, eventCity: parsed.destination || '', icon: '•' };
    }
    const origin = resolveOrigin(parsed.origin);
    if (!destination) {
      return json(res, 200, {
        ok: true, parsed, results: [],
        providerSummary: { consulted: 0, available: 0, partial: false },
        operatorStatus: { source: 'no_destination_mapping' },
        message: `Ainda não reconhecemos “${parsed.destination}” como destino pesquisável. Escolha uma das sugestões.`
      });
    }

    const providerStates = [];
    const tasks = [];
    const queryKey = providerQueryKey(destination, origin, parsed);

    // HBX = alojamento real. Em TEST, o cliente usa um pequeno portfolio em
    // cache por destino e depois Availability. Em produção o conteúdo deve
    // ser sincronizado periodicamente (ver docs/HBX_CONTENT_SYNC.md).
    if (hbx?.isConfigured('hotels') && destination.hbxCode) {
      tasks.push({
        id: 'hbx-hotels',
        promise: cachedProviderCall('hbx-hotels', queryKey, 5 * 60 * 1000, () => hbx.searchHotels({
          destinationCode: destination.hbxCode,
          checkIn: parsed.checkin,
          checkOut: parsed.checkout,
          adults: parsed.adults,
          children: parsed.children,
          infants: parsed.infants,
          childAges: parsed.childAges,
          infantAges: parsed.infantAges,
          limit: 80
        }))
      });
    }

    // Uma única consulta Duffel por pesquisa. Serve para construir soluções
    // voo+hotel; nunca fazemos uma chamada por cada hotel.
    if (searchType === 'PACKAGE' && duffel?.isConfigured() && origin?.iata && destination.iata) {
      tasks.push({
        id: 'duffel',
        // Ofertas aereas expiram rapidamente, por isso a cache Duffel e
        // deliberadamente curta. O checkout volta sempre a revalidar.
        promise: cachedProviderCall('duffel', queryKey, 60 * 1000, () => duffel.searchFlights({
          origin: origin.iata,
          destination: destination.iata,
          departureDate: parsed.checkin,
          returnDate: parsed.checkout,
          adults: parsed.adults,
          children: parsed.children,
          infants: parsed.infants,
          childAges: parsed.childAges,
          infantAges: parsed.infantAges,
          limit: 6
        }))
      });
    }

    if (searchType === 'PACKAGE' && tourdiezAdapter.isConfigured()) {
      tasks.push({ id: 'tourdiez', promise: cachedProviderCall('tourdiez', queryKey, 2 * 60 * 1000, () => tourdiezAdapter.liveOffers(parsed, db.margins)) });
    }

    const settled = await Promise.allSettled(tasks.map(x => x.promise));
    const byId = {};
    settled.forEach((result, index) => {
      const id = tasks[index].id;
      if (result.status === 'fulfilled') {
        byId[id] = result.value;
        providerStates.push({ id, ok: true, count: id === 'hbx-hotels' ? (result.value.hotels?.length || 0) : id === 'duffel' ? (result.value.offers?.length || 0) : (result.value.offers?.length || 0) });
      } else {
        providerStates.push({ id, ok: false, error: result.reason?.message || 'Fornecedor indisponível' });
      }
    });

    let hotelOffers = hbxHotelOffers(byId['hbx-hotels'], parsed, db.margins, destination);
    const flightOffers = byId.duffel?.offers || [];
    const cheapestFlight = flightOffers[0] || null;
    let dynamicOffers = cheapestFlight ? hotelOffers.slice(0, 30).map(h => combineHotelWithFlight(h, cheapestFlight, db.margins, destination)).filter(Boolean) : [];

    let packageOffers = [];
    const liveTour = byId.tourdiez;
    if (liveTour?.offers?.length) {
      // A sandbox TourDiez pode devolver stock de outra cidade. Só entra no
      // resultado se o destino devolvido corresponde ao pesquisado.
      packageOffers = liveTour.offers.filter(o => destinationMatches(destination.name, o.destination));
      if (!packageOffers.length) {
        providerStates.push({ id: 'tourdiez-destination-check', ok: false, error: `TourDiez devolveu ${liveTour.offers.length} oferta(s), mas de outro destino; foram ocultadas.` });
      }
    }

    // Demos só aparecem se explicitamente ativadas e, mesmo assim, apenas
    // quando pertencem ao destino pesquisado. Nunca mais há fallback global.
    const allowDemo = demoDataEnabled();
    const demoOffers = allowDemo ? demoSearch.results.filter(o => destinationMatches(destination.name, o.destination)) : [];

    // Resultados em três famílias, prontos para novos bedbanks no futuro.
    // A UI pode filtrar por productType sem conhecer o fornecedor interno.
    const selectedOffers = searchType === 'HOTEL'
      ? hotelOffers
      : [...dynamicOffers, ...packageOffers, ...hotelOffers, ...demoOffers];
    const results = rankOffers(selectedOffers.map(o => ({ ...o, destination: destination.name, country: destination.country })));

    // Em evaluation/test o HBX pode devolver pouca disponibilidade apesar de
    // existir um catálogo muito maior. Para uma apresentação útil mostramos
    // alojamentos adicionais do Content API SEM PREÇO e claramente marcados
    // como "disponibilidade a consultar". Nunca fabricamos preço/stock.
    let catalogTeasers = [];
    if (hbx?.isConfigured('hotels') && destination.hbxCode && hotelOffers.length < 6) {
      try {
        const catalog = await cachedProviderCall('hbx-catalog', `catalog:${destination.hbxCode}`, 6 * 60 * 60 * 1000, () => hbx.hotelCatalog({ destinationCode: destination.hbxCode, limit: 80 }));
        const liveCodes = new Set(hotelOffers.map(x => String(x.hbx?.hotelCode || '')));
        catalogTeasers = (catalog.hotels || []).filter(h => !liveCodes.has(String(h.hotelCode || ''))).slice(0, 12).map(h => ({
          hotelCode: h.hotelCode, name: h.name, stars: h.stars, image: h.image, city: h.city, address: h.address,
          description: h.description, availabilityStatus: 'TO_CONFIRM', destination: destination.name, country: destination.country
        }));
      } catch (err) {
        providerStates.push({ id: 'hbx-content', ok: false, error: safeError(err, 'Catálogo HBX indisponível') });
      }
    }

    const operatorLogs = [];
    if (byId['hbx-hotels']) operatorLogs.push({ type: 'SEARCH_HBX', payload: { destination: destination.name, code: destination.hbxCode, hotels: hotelOffers.length } });
    if (byId.duffel) operatorLogs.push({ type: 'SEARCH_DUFFEL', payload: { origin: origin?.iata, destination: destination.iata, offers: flightOffers.length } });
    if (byId.tourdiez) operatorLogs.push({ type: 'SEARCH_TOURDIEZ_AVAIL', payload: { destination: destination.name, offers: packageOffers.length } });
    if (operatorLogs.length) await updateDb(d => { ensureCollections(d); operatorLogs.forEach(x => addOperatorLog(d, x.type, x.payload)); });

    return json(res, 200, {
      ok: true,
      parsed: { ...parsed, destination: destination.name, searchType },
      results: attachOfferTokens(results),
      catalogTeasers,
      providerSummary: {
        consulted: providerStates.length,
        available: providerStates.filter(x => x.ok).length,
        partial: providerStates.some(x => !x.ok)
      },
      productCounts: {
        dynamic: searchType === 'PACKAGE' ? dynamicOffers.length : 0,
        packages: searchType === 'PACKAGE' ? packageOffers.length : 0,
        hotels: hotelOffers.length,
        demo: searchType === 'PACKAGE' ? demoOffers.length : 0
      },
      operatorStatus: { source: results.some(x => x.live) ? 'verified_or_live' : 'no_live_stock' },
      message: results.length ? null : `Não encontrámos disponibilidade real para ${destination.name} nestas condições. Experimente outras datas; não mostramos destinos diferentes como substitutos.`
    });
  });


  // Guardar/partilhar uma viagem sem criar ainda uma reserva. O link e
  // assinado e contem apenas dados comerciais seguros (nunca custo NET,
  // margem ou notas internas). Serve para casal/familia comparar a mesma
  // proposta antes do checkout. O offerToken original continua a mandar na
  // validade do preco; se expirar, o checkout pede nova pesquisa/revalidacao.
  router.post('/api/share-trip', async (req, res) => {
    const limited = await rateLimit(req, res, 'share-trip', 30, 60 * 1000);
    if (limited) return limited;
    const body = await ctx.parseBody(req);
    const offer = body.offer || {};
    const signedOffer = openToken(offer.offerToken);
    if (!signedOffer || signedOffer.scope !== 'offer') {
      return json(res, 400, { ok: false, error: 'A oferta ja nao e valida. Atualize a pesquisa antes de partilhar.' });
    }
    const safeOffer = {
      id: signedOffer.id || '', destination: signedOffer.destination || '', country: signedOffer.country || '',
      hotel: signedOffer.hotel || '', board: signedOffer.board || '', roomName: signedOffer.roomName || '',
      nights: Number(signedOffer.nights || 0), rating: Number(signedOffer.rating || 0),
      freeCancellation: Boolean(signedOffer.freeCancellation), nonRefundable: Boolean(signedOffer.nonRefundable),
      freeCancellationUntil: signedOffer.freeCancellationUntil || null,
      adults: Number(signedOffer.adults || 1), children: Number(signedOffer.children || 0), infants: Number(signedOffer.infants || 0),
      childAges: Array.isArray(signedOffer.childAges) ? signedOffer.childAges : [], infantAges: Array.isArray(signedOffer.infantAges) ? signedOffer.infantAges : [],
      origin: signedOffer.origin || '', checkin: signedOffer.checkin || '', checkout: signedOffer.checkout || '',
      finalPrice: Number(signedOffer.finalPrice || 0), live: Boolean(offer.live), productType: signedOffer.productType || '', offerToken: offer.offerToken,
      flight: safeFlight(signedOffer.flight), selectedExtras: publicSelectedExtras(baseComponentsFromSigned(signedOffer)),
      image: signedOffer.image || ''
    };
    const token = sealToken({ scope: 'shared-trip', offer: safeOffer, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
    const origin = publicBaseUrl(req);
    return json(res, 200, { ok: true, token, url: `${origin}/?trip=${encodeURIComponent(token)}` });
  });

  router.get('/api/share-trip', async (req, res, url) => {
    const payload = openToken(url.searchParams.get('token'));
    if (!payload || payload.scope !== 'shared-trip' || !payload.offer) {
      return json(res, 404, { ok: false, error: 'Esta viagem partilhada expirou ou ja nao esta disponivel.' });
    }
    return json(res, 200, { ok: true, offer: payload.offer });
  });

  router.post('/api/chat', async (req, res) => {
    const limited = await rateLimit(req, res, 'chat', 60, 60 * 1000);
    if (limited) return limited;
    const body = await ctx.parseBody(req);
    const msg = String(body.message || '').toLowerCase();
    let answer = 'Posso ajudar a encontrar férias por destino, orçamento, datas e nº de passageiros. Exemplo: “7 noites em Punta Cana em agosto, tudo incluído, até 2500€”.';
    if (msg.includes('pag')) answer = 'Aceitamos, em modo de teste, MB WAY, referência Multibanco e cartão. Em produção deve ligar a SIBS, Easypay ou Stripe.';
    if (msg.includes('cancel')) answer = 'Antes da confirmação final mostramos as condições de cancelamento do operador. Na API TourDiez existe fluxo de cancelamento/simulação.';
    if (msg.includes('rn') || msg.includes('rnavt')) answer = 'O rodapé e os termos já estão preparados para indicar o RNAVT da About Destiny / Boomviagens. Deve inserir o número final na configuração.';
    if (msg.includes('cara') || msg.includes('punta') || msg.includes('caribe')) answer = 'Para Caraíbas, recomendo começar por Punta Cana ou Riviera Maya. O motor compara preço, regime, avaliação, cancelamento e margem.';
    return json(res, 200, { ok: true, answer, handoff: /humano|operador|urgente|problema/.test(msg) });
  });
};
