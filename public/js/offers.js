// Aplica uma opcao de quarto/tarifa escolhida a uma oferta - usado tanto
// ao reservar uma tarifa nos resultados como ao aplicar uma sugestao de
// upgrade no passo de revisao.

export function applyRoomOption(offer, option) {
  // O browser só escolhe a apresentação comercial. NET, margem e referências
  // do fornecedor vivem exclusivamente no offerToken assinado pelo servidor.
  offer.finalPrice = option.finalPrice;
  offer.board = option.mealPlanLabel;
  offer.freeCancellation = option.freeCancellation;
  offer.nonRefundable = Boolean(option.nonRefundable);
  offer.freeCancellationUntil = option.freeCancellationUntil || null;
  // Cada opcao de quarto tem o seu proprio preco, logo o seu proprio
  // offerToken assinado no servidor (ver publicRoutes.js) - trocar de
  // quarto tem de trocar tambem o token, senao o checkout via verificar
  // o preco do quarto anterior.
  if (option.offerToken) offer.offerToken = option.offerToken;
}

// Porque razoes mostrar junto de cada destaque (escolha/preco/hotel) -
// mesma oferta pode aparecer em categorias diferentes, o texto muda
// consoante o motivo do destaque. Usado tanto nos resultados de pesquisa
// como nos destaques "Recomendado para si" da homepage.
function reasonsFor(offer, kind, budget) {
  const reasons = [];
  if (kind === 'escolha') {
    if (offer.finalPrice <= budget) reasons.push('Dentro do orçamento');
    if (offer.freeCancellation) reasons.push('Cancelamento flexível');
    if (/tudo inclu/i.test(offer.board || '')) reasons.push('Tudo incluído');
  } else if (kind === 'preco') {
    reasons.push('Preço mais baixo da pesquisa');
    if (offer.rating) reasons.push(`${offer.rating}★ de avaliação`);
    if (offer.freeCancellation) reasons.push('Cancelamento flexível');
  } else {
    if (offer.rating) reasons.push(`Classificação mais alta (${offer.rating}★)`);
    if (/tudo inclu/i.test(offer.board || '')) reasons.push('Tudo incluído');
    if (offer.freeCancellation) reasons.push('Cancelamento flexível');
  }
  return reasons.slice(0, 3);
}

// Escolhe ate 3 ofertas em destaque (melhor escolha/preco/hotel) de uma
// lista - a mesma oferta nunca aparece duas vezes, so a primeira
// categoria que a apanhar.
export function computeHighlights(results, budget) {
  if (!results.length) return [];
  const byScore = [...results].sort((a, b) => (b.score || 0) - (a.score || 0));
  const byPrice = [...results].sort((a, b) => a.finalPrice - b.finalPrice);
  const byRating = [...results].sort((a, b) => (b.rating || 0) - (a.rating || 0) || (b.score || 0) - (a.score || 0));

  const used = new Set();
  const picks = [];
  const add = (label, ribbon, kind, offer) => {
    if (!offer || used.has(offer.id)) return;
    used.add(offer.id);
    picks.push({ label, ribbon, offer, reasons: reasonsFor(offer, kind, budget), hotelIndex: results.indexOf(offer) });
  };
  add('Melhor escolha', '🏆', 'escolha', byScore[0]);
  add('Melhor preço', '💰', 'preco', byPrice[0]);
  add('Melhor hotel', '✨', 'hotel', byRating[0]);
  return picks;
}
