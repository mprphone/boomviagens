// Rotas publicas: nada disto exige sessao. Pesquisa, calendario de precos,
// destaques da homepage, saude do servico e o chat local.

// Preco cotado fica valido por 30 minutos - depois disso o checkout pede
// para pesquisar de novo em vez de aceitar um preco antigo.
const OFFER_TOKEN_TTL_MS = 30 * 60 * 1000;

module.exports = function registerPublicRoutes(router, ctx) {
  const { json, readDb, updateDb, tourdiezAdapter, searchOffers, baseOffers, getOfferById, searchPayload, normalize, rateLimit, domain, travelIntelligence } = ctx;
  const { publicDeals, ensureCollections, addOperatorLog, now } = domain;
  const { signToken } = ctx.auth;

  // Assina costPrice/finalPrice/referencias do operador no momento em que
  // o preco e calculado no servidor (ver auditoria) - o browser reenvia
  // isto tal e qual no checkout, mas so os valores de dentro do token
  // assinado sao usados para dinheiro; nunca o que o browser disser que
  // costPrice/finalPrice sao.
  function signOffer(offer) {
    return signToken({
      scope: 'offer',
      costPrice: offer.costPrice,
      finalPrice: offer.finalPrice,
      operator: offer.operator || null,
      tourdiez: offer.tourdiez || null,
      // Campos de viagem também ficam assinados. As APIs de enriquecimento
      // usam estes valores, nunca destino/datas/pax arbitrários enviados pelo
      // browser, reduzindo abuso de quotas externas.
      destination: offer.destination || '',
      origin: offer.origin || '',
      checkin: offer.checkin || '',
      checkout: offer.checkout || '',
      adults: Number(offer.adults || 1),
      children: Number(offer.children || 0),
      infants: Number(offer.infants || 0),
      childAges: Array.isArray(offer.childAges) ? offer.childAges : [],
      infantAges: Array.isArray(offer.infantAges) ? offer.infantAges : [],
      exp: Date.now() + OFFER_TOKEN_TTL_MS
    });
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
    delete copy.tourdiez;
    delete copy.operatorRefs;
    delete copy.operatorData;
    delete copy.targetPrice;
    delete copy.minimumPrice;
    delete copy.minimumMarginPercent;
    delete copy.concessionAvailable;
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
                } : null
              };
              return { ...publicOfferFields(opt), offerToken: signOffer(signedOption) };
            })
          : offer.roomOptions
      };
    });
  }

  router.get('/api/health', async (req, res) => {
    return json(res, 200, { ok: true, service: 'Boomviagens', time: now(), mode: process.env.TOURDIEZ_MODE || 'mock' });
  });

  router.get('/api/config', async (req, res) => {
    const db = ensureCollections(await readDb());
    // So agencias com morada preenchida (nunca uma agencia recem-criada e
    // ainda vazia) - ver seccao "4 agencias" da homepage.
    const branches = db.branches.filter(b => b.active && b.address).map(b => ({ name: b.name, address: b.address, phone: b.phone }));
    const integrationStatus = travelIntelligence.status();
    return json(res, 200, {
      company: db.company,
      branches,
      paymentsMode: process.env.PAYMENTS_MODE || 'mock',
      // O site público conhece capacidades, não nomes/estado comercial dos
      // fornecedores. A topologia completa só existe no API Lab do backoffice.
      features: {
        exploreZone: integrationStatus.some(x => x.id === 'google-places' && x.enabled),
        travelIntelligence: true
      }
    });
  });

  router.get('/api/deals', async (req, res) => {
    const db = await readDb();
    return json(res, 200, { ok: true, deals: publicDeals(db, baseOffers, getOfferById) });
  });

  // Sugestões de destino vêm do servidor para o frontend não ficar preso a
  // uma lista hardcoded. Incluem o aeroporto de referência usado pelo motor
  // de voos, mas nunca credenciais de fornecedores.
  router.get('/api/destinations/suggest', async (req, res, url) => {
    const limited = rateLimit(req, res, 'destinations-suggest', 120, 60 * 1000);
    if (limited) return limited;
    const q = String(url.searchParams.get('q') || '').slice(0, 80);
    return json(res, 200, { ok: true, destinations: travelIntelligence.suggest(q, 10) });
  });

  // Enriquecimento LAZY: só é chamado quando o cliente abre a página da
  // viagem. Assim, percorrer milhares de hotéis não dispara milhares de
  // chamadas a APIs externas. Uma falha de Duffel/Weather/Ticketmaster não
  // impede o cliente de continuar a reservar o produto principal.
  router.post('/api/travel-intelligence', async (req, res) => {
    const limited = rateLimit(req, res, 'travel-intelligence', 8, 60 * 1000);
    if (limited) return limited;
    const body = await ctx.parseBody(req);
    const signed = ctx.auth.verifyToken(body.offer?.offerToken || body.offerToken || '');
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
      infantAges: (Array.isArray(signed.infantAges) ? signed.infantAges : []).map(Number).filter(Number.isFinite).slice(0, 8)
    };
    const data = await travelIntelligence.enrichTrip(offer, { exploreGoogle: false });
    return json(res, 200, { ok: true, ...data });
  });

  // Google Places fica deliberadamente fora do carregamento automático.
  // Só há custo quando o utilizador pede explicitamente para explorar a zona
  // e a integração estiver ativada por GOOGLE_PLACES_ENABLED=true.
  router.post('/api/explore-zone', async (req, res) => {
    const limited = rateLimit(req, res, 'explore-zone', 4, 60 * 1000);
    if (limited) return limited;
    const body = await ctx.parseBody(req);
    const signed = ctx.auth.verifyToken(body.offerToken || '');
    if (!signed || signed.scope !== 'offer') return json(res, 400, { ok: false, error: 'Atualize a pesquisa para explorar esta zona.' });
    const destination = String(signed.destination || '').slice(0, 100);
    try {
      const result = await travelIntelligence.exploreZone(destination);
      return json(res, 200, { ok: true, ...result });
    } catch (err) {
      const status = /desligad|configurad/i.test(err.message) ? 503 : 502;
      return json(res, status, { ok: false, error: err.message });
    }
  });

  // Calendario de precos por dia no campo Data (like gurudasviagens.pt).
  // Usa sempre a mesma formula de estimativa local (nao a TourDiez em
  // direto) - 60 chamadas reais por cada vez que se abre o calendario
  // seria pesado para a sandbox do operador e lento para o utilizador. Os
  // precos sao genuinamente calculados pelo motor de precos, so nao sao o
  // preco confirmado ao vivo - o proprio calendario diz isso.
  router.post('/api/price-calendar', async (req, res) => {
    const limited = rateLimit(req, res, 'price-calendar', 30, 60 * 1000);
    if (limited) return limited;
    const body = searchPayload(await ctx.parseBody(req));
    const db = await readDb();
    const days = [];
    for (let i = 1; i <= 60; i++) {
      const iso = new Date(Date.now() + i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { results } = searchOffers({ ...body, checkin: iso }, db.margins);
      days.push({ date: iso, price: results[0]?.finalPrice || null });
    }
    return json(res, 200, { ok: true, days });
  });

  router.post('/api/search', async (req, res) => {
    const limited = rateLimit(req, res, 'search', 60, 60 * 1000);
    if (limited) return limited;
    const body = searchPayload(await ctx.parseBody(req));
    const db = await readDb();
    const demoSearch = searchOffers(body, db.margins);
    const parsed = demoSearch.parsed;
    let results = demoSearch.results;
    let operatorStatus = { source: 'estimated' };
    let operatorLog = null;
    if (tourdiezAdapter.isConfigured()) {
      try {
        const live = await tourdiezAdapter.liveOffers(parsed, db.margins);
        operatorLog = { type: 'SEARCH_TOURDIEZ_AVAIL', payload: { params: live.params, offers: live.offers.length, statusCode: live.raw.statusCode } };
        // A sandbox da TourDiez so tem stock de teste numa cidade fixa
        // (Torremolinos), seja qual for o destino pesquisado. Mostrar essas
        // ofertas como se fossem "resultados para Disneyland Paris" (por
        // exemplo) e enganador - so substitui os resultados demo quando a
        // cidade devolvida tem mesmo a ver com o que foi pesquisado.
        const searchedDest = normalize(parsed.destination || '');
        const foundDest = normalize(live.offers[0]?.destination || '');
        const relatedMatch = live.offers.length && searchedDest && foundDest && (searchedDest.includes(foundDest) || foundDest.includes(searchedDest));
        if (relatedMatch) {
          results = live.offers;
          operatorStatus = { source: 'verified' };
        } else if (live.offers.length) {
          operatorStatus = { source: 'requires_validation' };
        } else {
          operatorStatus = { source: 'requires_validation' };
        }
      } catch (e) {
        operatorLog = { type: 'SEARCH_TOURDIEZ_ERROR', payload: { error: e.message, destination: parsed.destination } };
        operatorStatus = { source: 'requires_validation' };
      }
    }
    // Uma pesquisa, por si so, nao e um interesse - a maioria e so
    // curiosidade/comparacao de precos. Criar um lead (e mandar email) por
    // cada pesquisa poluia o pipeline de Interesses sem sinal nenhum de
    // intencao real (o "email" nem sequer vinha do visitante - era sempre o
    // mesmo valor fixo escondido no formulario). Registar aqui apenas o log
    // tecnico do operador; o lead so nasce mais tarde, quando ha um sinal
    // real de interesse (ex.: avancar para o checkout).
    if (operatorLog) await updateDb(d => { ensureCollections(d); addOperatorLog(d, operatorLog.type, operatorLog.payload); });
    return json(res, 200, { ok: true, parsed, results: attachOfferTokens(results), operatorStatus });
  });


  // Guardar/partilhar uma viagem sem criar ainda uma reserva. O link e
  // assinado e contem apenas dados comerciais seguros (nunca custo NET,
  // margem ou notas internas). Serve para casal/familia comparar a mesma
  // proposta antes do checkout. O offerToken original continua a mandar na
  // validade do preco; se expirar, o checkout pede nova pesquisa/revalidacao.
  router.post('/api/share-trip', async (req, res) => {
    const limited = rateLimit(req, res, 'share-trip', 30, 60 * 1000);
    if (limited) return limited;
    const body = await ctx.parseBody(req);
    const offer = body.offer || {};
    const signedOffer = ctx.auth.verifyToken(offer.offerToken);
    if (!signedOffer || signedOffer.scope !== 'offer') {
      return json(res, 400, { ok: false, error: 'A oferta ja nao e valida. Atualize a pesquisa antes de partilhar.' });
    }
    const safeOffer = {
      id: offer.id || '', operator: offer.operator || '', destination: offer.destination || '', country: offer.country || '',
      hotel: offer.hotel || '', board: offer.board || '', nights: Number(offer.nights || 0), rating: Number(offer.rating || 0),
      freeCancellation: Boolean(offer.freeCancellation), adults: Number(offer.adults || 1), children: Number(offer.children || 0),
      origin: offer.origin || '', checkin: offer.checkin || '', checkout: offer.checkout || '', finalPrice: Number(signedOffer.finalPrice || offer.finalPrice || 0),
      live: Boolean(offer.live), offerToken: offer.offerToken,
      tourdiez: offer.tourdiez ? { idDistributions: offer.tourdiez.idDistributions || '', hotelCode: offer.tourdiez.hotelCode || '' } : undefined
    };
    const token = signToken({ scope: 'shared-trip', offer: safeOffer, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
    const origin = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;
    return json(res, 200, { ok: true, token, url: `${origin}/?trip=${encodeURIComponent(token)}` });
  });

  router.get('/api/share-trip', async (req, res, url) => {
    const payload = ctx.auth.verifyToken(url.searchParams.get('token'));
    if (!payload || payload.scope !== 'shared-trip' || !payload.offer) {
      return json(res, 404, { ok: false, error: 'Esta viagem partilhada expirou ou ja nao esta disponivel.' });
    }
    return json(res, 200, { ok: true, offer: payload.offer });
  });

  router.post('/api/chat', async (req, res) => {
    const limited = rateLimit(req, res, 'chat', 60, 60 * 1000);
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
