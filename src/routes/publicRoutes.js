// Rotas publicas: nada disto exige sessao. Pesquisa, calendario de precos,
// destaques da homepage, saude do servico e o chat local.

module.exports = function registerPublicRoutes(router, ctx) {
  const { json, readDb, updateDb, operators, tourdiezAdapter, searchOffers, baseOffers, getOfferById, searchPayload, normalize, rateLimit, domain } = ctx;
  const { publicDeals, ensureCollections, addOperatorLog, now } = domain;

  router.get('/api/health', async (req, res) => {
    return json(res, 200, { ok: true, service: 'Boomviagens', time: now(), mode: process.env.TOURDIEZ_MODE || 'mock' });
  });

  router.get('/api/config', async (req, res) => {
    const db = await readDb();
    return json(res, 200, { company: db.company, margins: db.margins, paymentsMode: process.env.PAYMENTS_MODE || 'mock', operators: operators.list(), tourdiezConfigured: operators.list().some(o => o.name === 'TourDiez' && o.configured) });
  });

  router.get('/api/deals', async (req, res) => {
    const db = await readDb();
    return json(res, 200, { ok: true, deals: publicDeals(db, baseOffers, getOfferById) });
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
    let operatorStatus = { source: 'demo', message: 'Resultados demo usados.' };
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
          operatorStatus = { source: 'tourdiez', message: 'Precos reais TourDiez.' };
        } else if (live.offers.length) {
          operatorStatus = {
            source: 'demo_fallback',
            message: `A TourDiez nao tem disponibilidade real para "${parsed.destination}" neste momento (o operador so confirma stock de teste em ${live.offers[0].destination}); a mostrar alternativas demo para o destino pedido.`
          };
        } else {
          operatorStatus = { source: 'demo_fallback', message: 'TourDiez respondeu sem precos convertiveis; a mostrar alternativas demo.' };
        }
      } catch (e) {
        operatorLog = { type: 'SEARCH_TOURDIEZ_ERROR', payload: { error: e.message, destination: parsed.destination } };
        operatorStatus = { source: 'demo_fallback', message: 'TourDiez indisponivel neste momento; a mostrar alternativas demo.', error: e.message };
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
    return json(res, 200, { ok: true, parsed, results, operatorStatus });
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
