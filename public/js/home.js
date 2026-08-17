// Homepage por baixo do hero: o carrossel de fundo do hero, o grid de
// "Ofertas em destaque", os destaques "Recomendado para si" (mesma
// logica de results.js#renderHighlights, ver offers.js) e as 4 agencias,
// todos alimentados por /api/deals e /api/config. Os tiles "Explore por
// tipo de viagem" chamam data-destino/data-prompt (ver nav.js), nao
// precisam de JS proprio.

import { $, api, money, esc, safeImageUrl, cssImageUrl } from './utils.js';
import { computeHighlights } from './offers.js';

let heroDeals = [];
let heroIndex = 0;
let heroTimer = null;

const EDITORIAL_INSPIRATION = [
  { title:'Gran Canaria', subtitle:'Espanha', image:'https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=800&q=80', text:'Sol, praias e opções para famílias.' },
  { title:'Atenas', subtitle:'Grécia', image:'https://images.unsplash.com/photo-1555993539-1732b0258235?auto=format&fit=crop&w=800&q=80', text:'Cultura, gastronomia e escapadinhas.' },
  { title:'Riviera Maya', subtitle:'México', image:'https://images.unsplash.com/photo-1510097467424-192d713fd8b2?auto=format&fit=crop&w=800&q=80', text:'Praia e resorts tudo incluído.' },
  { title:'Madeira', subtitle:'Portugal', image:'https://images.unsplash.com/photo-1526392060635-9d6019884377?auto=format&fit=crop&w=800&q=80', text:'Natureza e experiências todo o ano.' },
  { title:'Paris', subtitle:'França', image:'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=800&q=80', text:'Cidade, cultura e eventos.' },
  { title:'Sal', subtitle:'Cabo Verde', image:'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=800&q=80', text:'Praia, descanso e sol.' }
];

function renderEditorialInspiration(target) {
  const heading = document.querySelector('#novidades .showcase-head h2');
  const eyebrow = document.querySelector('#novidades .showcase-head .eyebrow');
  if (heading) heading.textContent = 'Ideias para começar a procurar';
  if (eyebrow) eyebrow.textContent = 'Inspiração';
  target.innerHTML = EDITORIAL_INSPIRATION.map((d,i)=>`<article class="deal-card inspiration-card"><div class="deal-card-media"><img src="${esc(safeImageUrl(d.image))}" alt="${esc(d.title)}" loading="lazy"/><span class="deal-tag">Inspiração</span></div><div class="deal-body"><p class="deal-dest">${esc(d.subtitle)}</p><h3>${esc(d.title)}</h3><p class="muted small">${esc(d.text)}</p><div class="deal-bottom inspiration-bottom"><span><small>Consulte preço e disponibilidade</small></span><button class="btn" data-inspiration-index="${i}">Explorar</button></div></div></article>`).join('');
  target.querySelectorAll('[data-inspiration-index]').forEach(btn=>btn.addEventListener('click',()=>{const d=EDITORIAL_INSPIRATION[Number(btn.dataset.inspirationIndex)];const form=$('#searchForm');form.destination.value=d.title;form.prompt.value=`Quero explorar viagens para ${d.title}.`;location.hash='#pesquisa';form.requestSubmit();}));
}

// So o fundo do hero roda entre as fotos das novidades - o cabecalho
// (h1/tagline) e fixo desde o pedido de aproximar o visual ao VIAJA+,
// que usa uma pergunta generica em vez de um carrossel de texto.
function renderHeroBackground(i) {
  const deal = heroDeals[i];
  if (!deal) return;
  const image = cssImageUrl(deal.image);
  if (image) document.querySelector('.hero').style.setProperty('--hero-bg', `url('${image}')`);
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

function dealCard(deal, index) {
  const image = safeImageUrl(deal.image);
  return `
    <article class="deal-card">
      <div class="deal-card-media">
        ${image ? `<img src="${esc(image)}" alt="${esc(deal.title)}" loading="lazy" />` : '<div class="deal-image-placeholder" aria-hidden="true"></div>'}
        <span class="deal-tag">${esc(deal.tag || '')}</span>
        <button type="button" class="deal-favorite" aria-label="Guardar">Guardar</button>
      </div>
      <div class="deal-body">
        <p class="deal-dest">${esc(deal.title)}</p>
        <h3>${esc(deal.hotel)}</h3>
        <div class="hotel-row-stars">${stars(deal.rating)}</div>
        <div class="deal-meta">
          <span>Partida: ${esc(deal.origin)}</span>
          <span>${Number(deal.nights || 0)} noites</span>
          <span>${esc(deal.board)}</span>
        </div>
        <div class="deal-bottom">
          <span>desde <strong>${money(deal.price)}</strong><small>/ pessoa</small></span>
          <button class="btn" data-home-deal-index="${index}">Ver oferta</button>
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
    const visibleDeals = data.deals.slice(0, 8);
    if (!visibleDeals.length) {
      renderEditorialInspiration(target);
      window.__boomHomeDeals = [];
      renderRecommended([]);
      loadAgencies();
      return;
    }
    window.__boomHomeDeals = visibleDeals;
    target.innerHTML = visibleDeals.map(dealCard).join('');
    target.querySelectorAll('[data-home-deal-index]').forEach(btn => btn.addEventListener('click', () => searchDeal(visibleDeals[Number(btn.dataset.homeDealIndex)])));
    renderRecommended(data.deals);
  } catch (err) {
    target.innerHTML = `<p class="error">${esc(err.message)}</p>`;
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
const RECOMMENDED_RIBBON = { 'Melhor escolha': 'A nossa recomendação', 'Melhor preço': 'Melhor preço', 'Melhor hotel': 'Melhor hotel' };

function renderRecommended(deals) {
  const section = $('#recomendado');
  const target = $('#recommendedGrid');
  if (!section || !target) return;
  const asResults = deals.map(d => ({ ...d, finalPrice: d.price, destination: d.title, country: d.subtitle }));
  const picks = computeHighlights(asResults, TYPICAL_BUDGET);
  if (picks.length < 2) { section.hidden = true; return; }
  section.hidden = false;
  target.innerHTML = picks.map((p, index) => `
    <article class="recommended-card">
      <span class="highlight-ribbon">${esc(RECOMMENDED_RIBBON[p.label] || p.label)}</span>
      ${safeImageUrl(p.offer.image) ? `<img src="${esc(safeImageUrl(p.offer.image))}" alt="${esc(p.offer.hotel)}" loading="lazy" />` : '<div class="deal-image-placeholder" aria-hidden="true"></div>'}
      <div class="recommended-body">
        <p class="deal-dest">${esc(p.offer.title)}</p>
        <h3>${esc(p.offer.hotel)}</h3>
        <div class="hotel-row-stars">${stars(p.offer.rating)}</div>
        <p class="recommended-why">Porque recomendamos esta viagem</p>
        <ul class="highlight-reasons">${p.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
        <div class="deal-bottom">
          <span>desde <strong>${money(p.offer.price)}</strong><small>/ pessoa</small></span>
          <button class="btn" data-recommended-index="${index}">Ver oferta</button>
        </div>
      </div>
    </article>`).join('');
  target.querySelectorAll('[data-recommended-index]').forEach(btn => btn.addEventListener('click', () => searchDeal(picks[Number(btn.dataset.recommendedIndex)]?.offer)));
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
        <div class="agency-card-icon" aria-hidden="true"></div>
        <b>${esc(b.name)}</b>
        <span class="muted small">${esc(b.address || '')}</span>
        ${b.phone ? `<a href="tel:${esc(String(b.phone).replace(/[^+\d]/g, ''))}" class="agency-card-phone">${esc(b.phone)}</a>` : ''}
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
