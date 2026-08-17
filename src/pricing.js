function normalize(text = '') {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function textRuleMatches(ruleValue, contextValue) {
  if (!ruleValue || ruleValue === '*') return true;
  const terms = normalize(ruleValue).split(',').map(s => s.trim()).filter(Boolean);
  const target = normalize(contextValue || '');
  return Boolean(target) && terms.some(t => target.includes(t) || t.includes(target));
}

function destinationScore(rule, destination) {
  if (rule.match === '*' || !rule.match) return 0;
  const target = normalize(destination);
  const terms = normalize(rule.match).split(',').map(s => s.trim()).filter(Boolean);
  return terms.some(t => target.includes(t) || t.includes(target)) ? 10 : -1000;
}

// Pricing V2: uma regra pode continuar a ser apenas por destino (compatível
// com o formato antigo), mas também pode ser específica por operador, canal
// e produto. Quanto mais específica, maior a prioridade.
function findMarginRule(destination, margins = [], context = {}) {
  const active = margins.filter(m => m.active !== false);
  const candidates = active.map((rule, index) => {
    let score = destinationScore(rule, destination);
    if (score < 0) return null;
    for (const [field, value] of [['operator', context.operator], ['channel', context.channel], ['productType', context.productType]]) {
      if (!rule[field] || rule[field] === '*') continue;
      if (!textRuleMatches(rule[field], value)) return null;
      score += 4;
    }
    return { rule, score, index };
  }).filter(Boolean).sort((a, b) => b.score - a.score || a.index - b.index);
  return candidates[0]?.rule || active.find(m => m.match === '*') || { percent: 5, min: 0, roundTo: 5, name: 'Regra geral' };
}

function roundCommercial(value, roundTo = 5) {
  const step = Number(roundTo) || 5;
  return Math.ceil(value / step) * step;
}

function percentOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// A percentagem é markup sobre o NET, porque é assim que o utilizador quer
// gerir as regras comerciais ("quanto quero ganhar acima do NET").
// context.concessionPercent pode ceder parte do markup, mas nunca desce do
// minimumPercent/minPercent nem da margem mínima fixa da regra.
function applyMargin(baseCost, destination, margins = [], context = {}) {
  const cost = Number(baseCost);
  if (!Number.isFinite(cost) || cost < 0) throw new Error('Custo NET inválido');
  const rule = findMarginRule(destination, margins, context);
  const targetPercent = Math.max(0, percentOr(rule.targetPercent, percentOr(rule.percent, 5)));
  const minimumPercent = Math.max(0, Math.min(targetPercent, percentOr(rule.minimumPercent, percentOr(rule.minPercent, 0))));
  const requested = Number.isFinite(Number(context.requestedMarkupPercent))
    ? Number(context.requestedMarkupPercent)
    : targetPercent - Math.max(0, percentOr(context.concessionPercent, 0));
  const appliedPercent = Math.max(minimumPercent, Math.min(targetPercent, requested));
  const fixedMinimum = Math.max(0, Number(rule.min || 0));
  const targetMargin = Math.max(cost * targetPercent / 100, fixedMinimum);
  const appliedMargin = Math.max(cost * appliedPercent / 100, fixedMinimum);
  const minimumMargin = Math.max(cost * minimumPercent / 100, fixedMinimum);
  const roundTo = rule.roundTo || 5;
  const targetPrice = roundCommercial(cost + targetMargin, roundTo);
  const finalPrice = roundCommercial(cost + appliedMargin, roundTo);
  const minimumPrice = roundCommercial(cost + minimumMargin, roundTo);
  const actualMargin = finalPrice - cost;
  const rebatePercent = Math.max(0, percentOr(rule.rebatePercent, 0));
  const expectedRebateValue = cost * rebatePercent / 100;
  const expectedEconomicMargin = actualMargin + expectedRebateValue;
  return {
    costPrice: Number(cost.toFixed(2)),
    marginRule: rule.name,
    marginPercent: Number(appliedPercent.toFixed(2)),
    targetMarginPercent: Number(targetPercent.toFixed(2)),
    minimumMarginPercent: Number(minimumPercent.toFixed(2)),
    effectiveMarkupPercent: cost ? Number((actualMargin / cost * 100).toFixed(2)) : 0,
    marginValue: Number(actualMargin.toFixed(2)),
    rebatePercent: Number(rebatePercent.toFixed(2)),
    expectedRebateValue: Number(expectedRebateValue.toFixed(2)),
    expectedEconomicMargin: Number(expectedEconomicMargin.toFixed(2)),
    expectedEconomicMarkupPercent: cost ? Number((expectedEconomicMargin / cost * 100).toFixed(2)) : 0,
    targetPrice: Number(targetPrice.toFixed(2)),
    minimumPrice: Number(minimumPrice.toFixed(2)),
    concessionAvailable: Number(Math.max(0, targetPrice - minimumPrice).toFixed(2)),
    finalPrice: Number(finalPrice.toFixed(2))
  };
}

function computeScore(item, context = {}) {
  const priceScore = Math.max(0, 100 - (item.finalPrice / Math.max(context.budget || item.finalPrice, 1)) * 35);
  const ratingScore = (item.rating || 4) * 12;
  const cancellationScore = item.freeCancellation ? 12 : 4;
  const availabilityScore = item.available ? 18 : 0;
  const regimeScore = /tudo incluido|all inclusive/i.test(item.board || '') ? 10 : 6;
  const operatorScore = item.operatorReliability || 8;
  return Math.round(Math.min(99, priceScore + ratingScore + cancellationScore + availabilityScore + regimeScore + operatorScore));
}

function marginSchemeVat(marginValue, vatRate = 23) {
  const margin = Number(marginValue) || 0;
  const vatAmount = Number((margin - margin / (1 + vatRate / 100)).toFixed(2));
  return { vatAmount, netMargin: Number((margin - vatAmount).toFixed(2)) };
}

module.exports = { applyMargin, computeScore, findMarginRule, normalize, marginSchemeVat, roundCommercial };
