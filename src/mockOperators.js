const { applyMargin, computeScore, normalize } = require('./pricing');

const baseOffers = [
  { id: 'tdz-puj-001', operator: 'TourDiez Demo', destination: 'Punta Cana', country: 'República Dominicana', hotel: 'Caribbean Bay Resort 5★', board: 'Tudo incluído', nights: 7, base: 1090, rating: 4.5, freeCancellation: true, themes: ['caraíbas', 'praia', 'família'], available: true, operatorReliability: 9 },
  { id: 'sol-puj-002', operator: 'Solférias Demo', destination: 'Punta Cana', country: 'República Dominicana', hotel: 'Bahia Azul Palace 5★', board: 'Tudo incluído', nights: 7, base: 1025, rating: 4.2, freeCancellation: false, themes: ['caraíbas', 'praia'], available: true, operatorReliability: 8 },
  { id: 'w2m-rm-003', operator: 'W2M Demo', destination: 'Riviera Maya', country: 'México', hotel: 'Maya Beach Collection 5★', board: 'Tudo incluído', nights: 7, base: 1185, rating: 4.7, freeCancellation: true, themes: ['caraíbas', 'praia', 'luxo'], available: true, operatorReliability: 8 },
  { id: 'tdz-cv-004', operator: 'TourDiez Demo', destination: 'Sal', country: 'Cabo Verde', hotel: 'Dunas Beach Family 4★', board: 'Tudo incluído', nights: 7, base: 765, rating: 4.1, freeCancellation: true, themes: ['praia', 'família', 'cabo verde'], available: true, operatorReliability: 9 },
  { id: 'tdz-mal-005', operator: 'TourDiez Demo', destination: 'Maldivas', country: 'Maldivas', hotel: 'Lagoon Water Villas 5★', board: 'Meia pensão', nights: 7, base: 1890, rating: 4.8, freeCancellation: false, themes: ['luxo', 'lua de mel'], available: true, operatorReliability: 9 },
  { id: 'eur-dis-006', operator: 'EuroDisney Demo', destination: 'Disneyland Paris', country: 'França', hotel: 'Magic Stay Val d’Europe 4★', board: 'Alojamento e pequeno-almoço', nights: 3, base: 425, rating: 4.0, freeCancellation: true, themes: ['disney', 'família', 'paris'], available: true, operatorReliability: 7 },
  { id: 'mad-007', operator: 'Madeira Demo', destination: 'Madeira', country: 'Portugal', hotel: 'Funchal Ocean Hotel 4★', board: 'Pequeno-almoço', nights: 5, base: 540, rating: 4.3, freeCancellation: true, themes: ['ilhas', 'portugal', 'natureza'], available: true, operatorReliability: 8 }
];

function smartParse(input = {}) {
  const prompt = normalize(input.prompt || '');
  const text = `${prompt} ${normalize(input.destination || '')}`;
  const map = [
    ['punta cana', 'Punta Cana'], ['dominicana', 'Punta Cana'], ['caraibas', 'Punta Cana'],
    ['riviera maya', 'Riviera Maya'], ['mexico', 'Riviera Maya'], ['cancun', 'Riviera Maya'],
    ['cabo verde', 'Sal'], ['sal', 'Sal'], ['boavista', 'Boa Vista'],
    ['maldivas', 'Maldivas'], ['disney', 'Disneyland Paris'], ['paris', 'Disneyland Paris'],
    ['madeira', 'Madeira'], ['funchal', 'Madeira']
  ];
  const promptMatch = map.find(([key]) => prompt.includes(key));
  const fieldMatch = map.find(([key]) => normalize(input.destination || '').includes(key));
  const destination = promptMatch?.[1] || fieldMatch?.[1] || input.destination || 'Punta Cana';

  const budgetMatch = (input.budget || prompt).toString().match(/(\d{3,5})(?:\s?€|\s?eur| euros)?/i);
  const budget = Number(input.budget || (budgetMatch ? budgetMatch[1] : 2500));
  const adults = Number(input.adults || (prompt.match(/(\d+)\s*adult/)?.[1]) || 2);
  const children = Number(input.children || (prompt.match(/(\d+)\s*crian/)?.[1]) || 0);
  const nights = Number(input.nights || (prompt.match(/(\d+)\s*(noite|noites|dias)/)?.[1]) || 7);
  const origin = input.origin || (text.includes('porto') ? 'Porto' : 'Lisboa');
  const board = input.board || (text.includes('tudo incluido') || text.includes('all inclusive') ? 'Tudo incluído' : 'Qualquer regime');
  return { destination, budget, adults, children, nights, origin, board, checkin: input.checkin || '', prompt: input.prompt || '' };
}

function searchOffers(input, margins) {
  const parsed = smartParse(input);
  const target = normalize(parsed.destination);
  const prompt = normalize(parsed.prompt || '');
  let offers = baseOffers.filter(o => {
    const hay = normalize(`${o.destination} ${o.country} ${o.hotel} ${o.themes.join(' ')}`);
    return hay.includes(target) || target.includes(normalize(o.destination)) || o.themes.some(t => prompt.includes(normalize(t)));
  });
  if (!offers.length) offers = baseOffers;

  const paxFactor = Math.max(1, parsed.adults + parsed.children * 0.55) / 2;
  const nightsFactor = parsed.nights / 7;
  const results = offers.map((o, index) => {
    const originAdj = parsed.origin === 'Porto' ? 35 : 0;
    const childAdj = parsed.children ? -40 : 0;
    const dynamicAdj = (index % 3) * 22;
    const cost = Math.max(120, (o.base + originAdj + childAdj + dynamicAdj) * paxFactor * nightsFactor);
    const priced = applyMargin(cost, o.destination, margins);
    const result = { ...o, ...priced, nights: parsed.nights, adults: parsed.adults, children: parsed.children, origin: parsed.origin };
    result.score = computeScore(result, parsed);
    result.label = index === 0 ? 'Recomendado Boom' : result.finalPrice <= parsed.budget ? 'Dentro do orçamento' : 'Acima do orçamento';
    result.trace = `Operador: ${o.operator}; regra margem: ${result.marginRule}; custo ${result.costPrice}€; margem ${result.marginValue}€`;
    return result;
  });

  results.sort((a, b) => b.score - a.score || a.finalPrice - b.finalPrice);
  return { parsed, results };
}

function getOfferById(id, margins) {
  const found = baseOffers.find(o => o.id === id);
  if (!found) return null;
  const priced = applyMargin(found.base, found.destination, margins);
  const item = { ...found, ...priced };
  item.score = computeScore(item, { budget: item.finalPrice });
  return item;
}

module.exports = { baseOffers, smartParse, searchOffers, getOfferById };
