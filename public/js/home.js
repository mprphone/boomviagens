// Homepage por baixo do hero: o carrossel de fundo do hero, o grid de
// "Ofertas em destaque", os destaques "Recomendado para si" (mesma
// logica de results.js#renderHighlights, ver offers.js) e as 4 agencias,
// todos alimentados por /api/deals e /api/config. Os tiles "Explore por
// tipo de viagem" chamam data-destino/data-prompt (ver nav.js), nao
// precisam de JS proprio.

import { $, api, money } from './utils.js';
import { computeHighlights } from './offers.js';

let heroDeals = [];
let heroIndex = 0;
let heroTimer = null;

// So o fundo do hero roda entre as fotos das novidades - o cabecalho
// (h1/tagline) e fixo desde o pedido de aproximar o visual ao VIAJA+,
// que usa uma pergunta generica em vez de um carrossel de texto.
function renderHeroBackground(i) {
  const deal = heroDeals[i];
  if (!deal) return;
  document.querySelector('.hero').style.setProperty('--hero-bg', `url("${deal.image}")`);
}

function restartHeroTimer() {
  clearInterval(heroTimer);
  if (heroDeals.length < 2) return;
  heroTimer = setInterval(() => {
    heroIndex = (heroIndex + 1) % heroDeals.length;
    renderHeroBackground(heroIndex);
  }, 6000);
}

function initHero(deals) {
  heroDeals = deals.slice(0, 5);
  if (!heroDeals.length) return;
  renderHeroBackground(0);
  restartHeroTimer();
  const hero = document.querySelector('.hero');
  hero.addEventListener('mouseenter', () => clearInterval(heroTimer));
  hero.addEventListener('mouseleave', restartHeroTimer);
}

function dealToPrompt(deal) {
  return `Quero ${deal.nights} noites em ${deal.title}, ${deal.board}, para 2 adultos, ate ${Math.ceil(deal.price * 2.2)} euros, saida de ${deal.origin}.`;
}

function stars(rating) {
  return '★'.repeat(Math.max(1, Math.min(5, Math.round(rating || 4))));
}

function dealCard(deal) {
  return `
    <article class="deal-card">
      <div class="deal-card-media">
        <img src="${deal.image}" alt="${deal.title}" loading="lazy" />
        <span class="deal-tag">${deal.tag}</span>
        <button type="button" class="deal-favorite" aria-label="Guardar">♡</button>
      </div>
      <div class="deal-body">
        <p class="deal-dest">${deal.title}</p>
        <h3>${deal.hotel}</h3>
        <div class="hotel-row-stars">${stars(deal.rating)}</div>
        <div class="deal-meta">
          <span>✈ ${deal.origin}</span>
          <span>${deal.nights} noites</span>
          <span>${deal.board}</span>
        </div>
        <div class="deal-bottom">
          <span>desde <strong>${money(deal.price)}</strong><small>/ pessoa</small></span>
          <button class="btn" onclick='searchDeal(${JSON.stringify(deal).replaceAll("'", "&apos;")})'>Ver oferta</button>
        </div>
      </div>
    </article>`;
}

export async function loadDeals() {
  const target = $('#dealsGrid');
  if (!target) return;
  target.innerHTML = '<p class="muted">A carregar ofertas...</p>';
  try {
    const data = await api('/api/deals');
    initHero(data.deals);
    target.innerHTML = data.deals.slice(0, 8).map(dealCard).join('');
    renderRecommended(data.deals);
  } catch (err) {
    target.innerHTML = `<p class="error">${err.message}</p>`;
  }
  loadAgencies();
}

// "Recomendado para si": mesmos 3 destaques (melhor escolha/preco/hotel)
// que a pagina de resultados mostra para uma pesquisa concreta, aqui
// aplicados as ofertas em destaque da homepage - mesma logica
// (offers.js#computeHighlights), sem duplicar. 2500€ como referencia de
// orcamento tipico (mesma omissao usada no motor de pesquisa demo,
// ver smartParse em src/mockOperators.js), so para a razao "dentro do
// orcamento" ter algum sentido antes de existir uma pesquisa real.
const TYPICAL_BUDGET = 2500;
const RECOMMENDED_RIBBON = { 'Melhor escolha': '🏆 A nossa recomendação', 'Melhor preço': '💰 Melhor preço', 'Melhor hotel': '⭐ Melhor hotel' };

function renderRecommended(deals) {
  const section = $('#recomendado');
  const target = $('#recommendedGrid');
  if (!section || !target) return;
  const asResults = deals.map(d => ({ ...d, finalPrice: d.price, destination: d.title, country: d.subtitle }));
  const picks = computeHighlights(asResults, TYPICAL_BUDGET);
  if (picks.length < 2) { section.hidden = true; return; }
  section.hidden = false;
  target.innerHTML = picks.map(p => `
    <article class="recommended-card">
      <span class="highlight-ribbon">${RECOMMENDED_RIBBON[p.label] || p.label}</span>
      <img src="${p.offer.image}" alt="${p.offer.hotel}" loading="lazy" />
      <div class="recommended-body">
        <p class="deal-dest">${p.offer.title}</p>
        <h3>${p.offer.hotel}</h3>
        <div class="hotel-row-stars">${stars(p.offer.rating)}</div>
        <p class="recommended-why">Porque recomendamos esta viagem</p>
        <ul class="highlight-reasons">${p.reasons.map(r => `<li>${r}</li>`).join('')}</ul>
        <div class="deal-bottom">
          <span>desde <strong>${money(p.offer.price)}</strong><small>/ pessoa</small></span>
          <button class="btn" onclick='searchDeal(${JSON.stringify(p.offer).replaceAll("'", "&apos;")})'>Ver oferta</button>
        </div>
      </div>
    </article>`).join('');
}

// 4 agencias: so aparecem se ja tiverem morada preenchida no backoffice
// (ver Sistema > Agências) - ver /api/config em src/routes/publicRoutes.js.
async function loadAgencies() {
  const section = $('#agenciasSection');
  const target = $('#agenciesGrid');
  if (!section || !target) return;
  try {
    const data = await api('/api/config');
    const branches = data.branches || [];
    if (!branches.length) { section.hidden = true; return; }
    section.hidden = false;
    $('#agenciesCount').textContent = `${branches.length} agência${branches.length === 1 ? '' : 's'} ao seu lado`;
    target.innerHTML = branches.map(b => `
      <div class="agency-card">
        <div class="agency-card-icon" aria-hidden="true">🏬</div>
        <b>${b.name}</b>
        <span class="muted small">${b.address || ''}</span>
        ${b.phone ? `<a href="tel:${b.phone.replace(/\s+/g, '')}" class="agency-card-phone">📞 ${b.phone}</a>` : ''}
      </div>`).join('');
  } catch {
    section.hidden = true;
  }
}

window.searchDeal = function(deal) {
  const form = $('#searchForm');
  form.prompt.value = dealToPrompt(deal);
  form.destination.value = deal.title;
  form.origin.value = deal.origin;
  form.nights.value = deal.nights;
  location.hash = '#pesquisa';
  form.requestSubmit();
};
