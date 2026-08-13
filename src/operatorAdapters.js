const { TourDiezClient } = require('./tourdiezClient');
const { applyMargin, computeScore } = require('./pricing');

// Codigos de regime tal como devolvidos pela TourDiez/Sirio (ex.: DE, MP,
// PC, TI). Mapeados para portugues; codigo desconhecido mostra-se tal como
// veio da API em vez de arriscar uma traducao errada.
const MEAL_PLAN_LABELS = {
  SA: 'Sem refeições', RO: 'Sem refeições',
  DE: 'Pequeno-almoço incluído', AD: 'Alojamento e pequeno-almoço', BB: 'Alojamento e pequeno-almoço',
  MP: 'Meia pensão', HB: 'Meia pensão',
  PC: 'Pensão completa', FB: 'Pensão completa',
  TI: 'Tudo incluído', AI: 'Tudo incluído'
};

function mealPlanLabel(code) {
  return MEAL_PLAN_LABELS[String(code || '').toUpperCase()] || code || 'Regime conforme operador';
}

/**
 * Contrato que qualquer fornecedor novo (Hotelbeds, Travelgate, Duffel,
 * W2M real, etc.) tem de implementar para entrar no motor de pesquisa e
 * checkout. Ver docs/OPERATOR_ADAPTERS.md para o guia completo (forma
 * exata da "offer" que o resto da aplicacao espera, como registar o
 * adapter, passo a passo para adicionar um fornecedor).
 *
 * So estes quatro metodos fazem parte do contrato - tudo o resto que a
 * TourDiezAdapter tem a mais (tag/findNumber/availabilityBlocks/...) e
 * especifico do formato XML da TourDiez, nao algo que um adapter novo
 * precise de copiar.
 *
 * De proposito NAO existem classes stub para outros fornecedores
 * (HotelbedsAdapter, DuffelAdapter, ...) - um adapter sem credenciais
 * nem sandbox para testar contra e codigo morto que nunca vai ser
 * validado. Escreve-se um adapter novo quando ha um contrato/sandbox
 * real para o testar, seguindo este mesmo padrao.
 */
class OperatorAdapter {
  /** @param {string} name Nome curto e unico do fornecedor (ex.: "TourDiez"). Usado por OperatorRegistry#getForOffer para escolher o adapter certo a partir de offer.operator - ver docs/OPERATOR_ADAPTERS.md. */
  constructor(name) {
    this.name = name;
  }

  /**
   * Pesquisa disponibilidade no fornecedor. Chamado a partir de
   * liveOffers()/equivalente (nao ha uma chamada generica a search() no
   * resto da app - cada adapter expoe o metodo de alto nivel que lhe faz
   * sentido, ex.: TourDiezAdapter#liveOffers).
   * @param {object} params Parametros de pesquisa especificos do fornecedor (destino/cidade, datas, pax, etc.).
   * @returns {Promise<object>} Resposta em bruto do fornecedor - forma livre, cada adapter decide o que faz sentido devolver aqui.
   */
  async search() {
    throw new Error(`${this.name}: pesquisa nao implementada`);
  }

  /**
   * Revalida preco/disponibilidade de uma oferta antes de a confirmar -
   * chamado em POST /api/checkout (src/routes/checkoutRoutes.js) logo
   * apos o pagamento simulado ser marcado como pago.
   * @param {{ offer: object, reservation: object }} args A oferta tal como guardada na reserva, e a reserva completa.
   * @returns {Promise<{ ok: boolean, operator: string, offerId: string, priceStillValid: boolean, availabilityStillValid: boolean, raw: object, needsHumanReview?: boolean }>}
   *   priceStillValid/availabilityStillValid decidem se a reserva passa a
   *   IN_VALIDATION (ambos true) ou HUMAN_REVIEW (algum false) - ver
   *   checkoutRoutes.js. Usa normalizeValue() abaixo para a forma base.
   */
  async value() {
    throw new Error(`${this.name}: valorizacao nao implementada`);
  }

  /**
   * Confirma a reserva definitivamente no fornecedor - chamado a partir
   * de POST /api/admin/reservations/approve (src/routes/adminRoutes.js),
   * so depois de o pagamento estar confirmado (PAID) e nunca automatico.
   * @param {{ reservation: object, payment: object }} args
   * @returns {Promise<{ ok: boolean, operator: string, locator: string, raw: object, needsHumanReview?: boolean }>}
   *   `locator` e obrigatorio - fica guardado em reservation.operatorLocator
   *   e e o que se mostra ao cliente como referencia da viagem.
   */
  async confirm() {
    throw new Error(`${this.name}: confirmacao nao implementada`);
  }

  /**
   * Cancela uma reserva confirmada no fornecedor. Parte do contrato mas
   * ainda sem nenhuma rota a chamar isto (nao existe ainda um botao
   * "cancelar no operador" no backoffice) - implementar quando essa
   * funcionalidade for pedida.
   * @param {object} params
   * @returns {Promise<object>}
   */
  async cancel() {
    throw new Error(`${this.name}: cancelamento nao implementado`);
  }

  /**
   * Forma minima e valida de uma resposta de value() quando nao ha nada
   * de especial a validar - adapters podem usar isto como base e so
   * substituir os campos que precisam (ver TourDiezAdapter#value).
   */
  normalizeValue(response, offer) {
    return {
      ok: true,
      operator: this.name,
      offerId: offer?.id,
      priceStillValid: true,
      availabilityStillValid: true,
      raw: response
    };
  }
}

class TourDiezAdapter extends OperatorAdapter {
  constructor(env = process.env) {
    super('TourDiez');
    this.client = new TourDiezClient(env);
  }

  isConfigured() {
    return this.client.isConfigured();
  }

  async search(params) {
    return this.client.getAccomodationAvail(params);
  }

  // Nota: o filtro accomodationsCode devolve sempre "No existen datos" na
  // sandbox de testes, mesmo com um unico codigo valido - confirmado por
  // testes diretos contra a API. Pesquisar so por city devolve dados reais
  // (varios hoteis, quartos e regimes). Por isso accomodationsCode so e
  // enviado se for explicitamente definido em TOURDIEZ_DEFAULT_ACCOMMODATIONS.
  defaultSearchParams(parsed = {}) {
    const checkin = parsed.checkin || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const start = new Date(`${checkin}T00:00:00Z`);
    const nights = Number(parsed.nights || 7);
    const checkout = new Date(start.getTime() + nights * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const params = {
      city: process.env.TOURDIEZ_DEFAULT_CITY || 'ES00634',
      checkin,
      checkout,
      nights,
      adults: Number(parsed.adults || 2),
      children: Number(parsed.children || 0),
      retrieveCancelPolicies: true
    };
    if (process.env.TOURDIEZ_DEFAULT_ACCOMMODATIONS) params.accomodationsCode = process.env.TOURDIEZ_DEFAULT_ACCOMMODATIONS;
    return params;
  }

  tag(xml, name) {
    const match = String(xml || '').match(new RegExp(`<${name}>([^<]*)</${name}>`, 'i'));
    return match ? match[1].trim() : '';
  }

  findNumber(xml, names = []) {
    for (const name of names) {
      const raw = this.tag(xml, name);
      if (!raw) continue;
      const value = Number(String(raw).replace(',', '.'));
      if (Number.isFinite(value) && value > 0) return value;
    }
    return 0;
  }

  availabilityBlocks(xml = '') {
    const blocks = [];
    const patterns = [
      /<accomodation\b[\s\S]*?<\/accomodation>/gi,
      /<distribution\b[\s\S]*?<\/distribution>/gi,
      /<availability\b[\s\S]*?<\/availability>/gi
    ];
    for (const pattern of patterns) {
      for (const match of String(xml).matchAll(pattern)) {
        if (this.findNumber(match[0], ['pvp', 'price', 'amount', 'total', 'totalPrice', 'finalPrice'])) blocks.push(match[0]);
      }
      if (blocks.length) return blocks;
    }
    return [];
  }

  // Cada hotel pode ter varios quartos/regimes (distributions) com precos
  // diferentes. Extrai todas as opcoes reais em vez de mostrar so a mais
  // barata - o cliente escolhe no checkout, como num site de reservas a
  // serio. Se o bloco nao tiver <distribution> aninhado (fallback generico
  // do availabilityBlocks), trata o proprio bloco como opcao unica.
  roomOptionsFromBlock(block, destination, margins) {
    const distMatches = [...String(block).matchAll(/<distribution\b[\s\S]*?<\/distribution>/gi)];
    const source = distMatches.length ? distMatches.map(m => m[0]) : [block];
    const options = source.map(distXml => {
      const rawPrice = this.findNumber(distXml, ['pvp', 'price', 'amount', 'total', 'totalPrice', 'finalPrice']);
      if (!rawPrice) return null;
      const priced = applyMargin(rawPrice, destination, margins);
      const mealPlan = this.tag(distXml, 'mealPlan');
      const roomName = this.tag(distXml, 'name') || 'Quarto standard';
      return {
        idDistributions: this.tag(distXml, 'idDistributions'),
        roomCode: this.tag(distXml, 'code'),
        roomName,
        mealPlan,
        mealPlanLabel: mealPlanLabel(mealPlan),
        // Convencao observada nos dados reais da TourDiez: quartos com "NO
        // REEMBOLSABLE" no nome sao tarifa nao reembolsavel; os restantes
        // sao a tarifa flexivel do operador. Testar so o nome do quarto (nao
        // o bloco XML inteiro) - o bloco tem sempre "xmlns" no seu markup,
        // que contem "ns" e dava falso positivo em todas as opcoes.
        freeCancellation: !/non refundable|no reembols/i.test(roomName),
        ...priced
      };
    }).filter(Boolean);
    options.sort((a, b) => a.finalPrice - b.finalPrice);
    return options;
  }

  normalizeAvailabilityOffers(response, parsed = {}, margins = []) {
    const blocks = this.availabilityBlocks(response.responseXml);
    const offers = blocks.slice(0, 12).map((block, index) => {
      const hotel = this.tag(block, 'name') || this.tag(block, 'accomodationName') || this.tag(block, 'hotelName') || `Hotel TourDiez ${index + 1}`;
      // Preferir a cidade real devolvida pela API: o destino pesquisado pelo
      // cliente (ex.: "Madeira") pode nao corresponder ao inventario real
      // disponivel no operador (ex.: sandbox de testes so tem Torremolinos).
      const destination = this.tag(block, 'cityName') || this.tag(block, 'city') || parsed.destination || 'Destino TourDiez';
      const roomOptions = this.roomOptionsFromBlock(block, destination, margins);
      if (!roomOptions.length) return null;
      const cheapest = roomOptions[0];
      const offer = {
        id: `tdz-live-${this.tag(block, 'code') || index + 1}`,
        operator: 'TourDiez',
        destination,
        country: this.tag(block, 'country') || '',
        hotel,
        board: cheapest.mealPlanLabel,
        nights: Number(parsed.nights || 7),
        adults: Number(parsed.adults || 2),
        children: Number(parsed.children || 0),
        origin: parsed.origin || 'Lisboa',
        checkin: parsed.checkin || '',
        checkout: parsed.checkout || '',
        rating: Number(this.tag(block, 'category') || 4) || 4,
        freeCancellation: cheapest.freeCancellation,
        themes: ['preco real', 'operador'],
        available: true,
        operatorReliability: 9,
        live: true,
        roomOptions,
        tourdiez: {
          idOperation: this.tag(block, 'IdOperation') || this.tag(response.responseXml, 'IdOperation'),
          code: this.tag(block, 'code'),
          idDistributions: cheapest.idDistributions
        },
        costPrice: cheapest.costPrice,
        marginRule: cheapest.marginRule,
        marginPercent: cheapest.marginPercent,
        marginValue: cheapest.marginValue,
        finalPrice: cheapest.finalPrice
      };
      offer.score = computeScore(offer, parsed);
      offer.label = index === 0 ? 'Preco real TourDiez' : 'Disponivel TourDiez';
      offer.trace = `Operador: TourDiez; preco real ${offer.costPrice} EUR; regra margem: ${offer.marginRule}; margem ${offer.marginValue} EUR`;
      return offer;
    }).filter(Boolean);
    offers.sort((a, b) => a.finalPrice - b.finalPrice);
    return offers;
  }

  async liveOffers(parsed = {}, margins = []) {
    const params = this.defaultSearchParams(parsed);
    const raw = await this.search(params);
    return { params, raw, offers: this.normalizeAvailabilityOffers(raw, parsed, margins) };
  }

  tourdiezRefs(offer = {}) {
    const refs = offer.tourdiez || offer.operatorRefs || offer.operatorData || {};
    return {
      idOperation: refs.idOperation || refs.IdOperation || offer.idOperation || offer.IdOperation || '',
      code: refs.code || offer.code || '',
      idDistributions: refs.idDistributions || refs.distributionId || offer.idDistributions || offer.distributionId || ''
    };
  }

  hasTourdiezRefs(offer = {}) {
    const refs = this.tourdiezRefs(offer);
    return Boolean(refs.idOperation && refs.code && refs.idDistributions);
  }

  async value({ offer }) {
    if (!this.hasTourdiezRefs(offer)) {
      return {
        ok: true,
        operator: this.name,
        offerId: offer?.id,
        priceStillValid: true,
        availabilityStillValid: true,
        needsHumanReview: true,
        raw: { skipped: true, reason: 'Oferta sem IdOperation/code/idDistributions da TourDiez; fluxo demo mantido para captacao.' }
      };
    }
    const raw = await this.client.value(this.tourdiezRefs(offer));
    return this.normalizeValue(raw, offer);
  }

  async confirm({ reservation }) {
    if (!this.hasTourdiezRefs(reservation.offer)) {
      return {
        ok: true,
        operator: this.name,
        locator: `BDV-${Math.floor(100000 + Math.random() * 900000)}`,
        needsHumanReview: true,
        raw: { skipped: true, reason: 'Oferta sem IdOperation/code/idDistributions da TourDiez; confirmacao real nao enviada.' }
      };
    }
    const raw = await this.client.confirm({
      ...this.tourdiezRefs(reservation.offer),
      clientLocalizer: reservation.id,
      clients: reservation.passengers?.length ? reservation.passengers : [{ name: reservation.customer?.name || 'Cliente' }]
    });
    return {
      ok: true,
      operator: this.name,
      locator: `BDV-${Math.floor(100000 + Math.random() * 900000)}`,
      raw
    };
  }

  async cancel(params) {
    return this.client.cancel(params);
  }
}

/**
 * Guarda a lista de adapters ligados (server.js cria um so:
 * `new OperatorRegistry([tourdiezAdapter])`) e escolhe qual usar para
 * cada oferta em checkout/aprovacao.
 */
class OperatorRegistry {
  constructor(adapters = []) {
    this.adapters = adapters;
  }

  /**
   * Escolhe o adapter cujo `name` aparece (case-insensitive, substring)
   * dentro de `offer.operator` - por isso o `operator` de uma oferta tem
   * de conter o nome exato passado ao construtor do adapter (ex.: uma
   * oferta Hotelbeds real teria de ter operator a incluir "Hotelbeds").
   * As ofertas demo em src/mockOperators.js usam nomes tipo "TourDiez
   * Demo"/"W2M Demo" que nao correspondem a nenhum adapter real, por
   * isso caem sempre no fallback (`this.adapters[0]`) - aceitavel porque
   * ofertas demo nunca chegam a bater num operador de verdade.
   */
  getForOffer(offer = {}) {
    const operator = String(offer.operator || '').toLowerCase();
    return this.adapters.find(adapter => operator.includes(adapter.name.toLowerCase())) || this.adapters[0];
  }

  list() {
    return this.adapters.map(adapter => ({ name: adapter.name, configured: adapter.isConfigured?.() || false }));
  }
}

module.exports = { OperatorAdapter, TourDiezAdapter, OperatorRegistry };
