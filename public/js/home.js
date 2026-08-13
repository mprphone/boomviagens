// Homepage por baixo do hero: o carrossel de fundo do hero e o grid de
// "Last call" (novidades), ambos alimentados por /api/deals. Os cartoes
// de inspiracao chamam window.inspireSearch diretamente do HTML estatico.

import { $, api, money } from './utils.js';

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

export async function loadDeals() {
  const target = $('#dealsGrid');
  if (!target) return;
  target.innerHTML = '<p class="muted">A carregar novidades...</p>';
  try {
    const data = await api('/api/deals');
    initHero(data.deals);
    target.innerHTML = data.deals.slice(0, 6).map(deal => `
      <article class="deal-card">
        <img src="${deal.image}" alt="${deal.title}" loading="lazy" />
        <div class="deal-body">
          <span class="deal-tag">${deal.tag}</span>
          <h3>${deal.title}</h3>
          <p>${deal.hotel}</p>
          <div class="deal-meta">
            <span>${deal.board}</span>
            <span>${deal.origin}</span>
            <span>${deal.nights} noites</span>
          </div>
          <div class="deal-bottom">
            <span>desde <strong>${money(deal.price)}</strong></span>
            <button class="btn" onclick='searchDeal(${JSON.stringify(deal).replaceAll("'", "&apos;")})'>Ver mais</button>
          </div>
        </div>
      </article>
    `).join('');
  } catch (err) {
    target.innerHTML = `<p class="error">${err.message}</p>`;
  }
}

window.inspireSearch = function(destino) {
  const form = $('#searchForm');
  form.destination.value = destino;
  form.prompt.value = `Quero viajar para ${destino}, 7 noites para 2 adultos.`;
  location.hash = '#pesquisa';
  form.requestSubmit();
};

window.searchDeal = function(deal) {
  const form = $('#searchForm');
  form.prompt.value = dealToPrompt(deal);
  form.destination.value = deal.title;
  form.origin.value = deal.origin;
  form.nights.value = deal.nights;
  location.hash = '#pesquisa';
  form.requestSubmit();
};
