function normalize(text = '') {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function findMarginRule(destination, margins = []) {
  const target = normalize(destination);
  const active = margins.filter(m => m.active !== false);
  for (const rule of active) {
    if (rule.match === '*') continue;
    const terms = normalize(rule.match).split(',').map(s => s.trim()).filter(Boolean);
    if (terms.some(t => target.includes(t) || t.includes(target))) return rule;
  }
  return active.find(m => m.match === '*') || { percent: 5, min: 0, roundTo: 5, name: 'Regra geral' };
}

function roundCommercial(value, roundTo = 5) {
  const step = Number(roundTo) || 5;
  return Math.ceil(value / step) * step;
}

function applyMargin(baseCost, destination, margins = []) {
  const rule = findMarginRule(destination, margins);
  const percentMargin = Number(baseCost) * (Number(rule.percent) / 100);
  const marginValue = Math.max(percentMargin, Number(rule.min || 0));
  const finalPrice = roundCommercial(Number(baseCost) + marginValue, rule.roundTo || 5);
  return {
    costPrice: Number(baseCost.toFixed(2)),
    marginRule: rule.name,
    marginPercent: Number(rule.percent),
    marginValue: Number((finalPrice - baseCost).toFixed(2)),
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

module.exports = { applyMargin, computeScore, findMarginRule, normalize };
