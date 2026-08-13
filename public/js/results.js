// Pagina de resultados: normaliza nomes de quarto vindos do operador,
// filtra por categoria/regime, renderiza os cartoes de hotel com as
// tarifas expansiveis e conduz a pesquisa em si (submit do formulario).

import { $, esc, money, dateRange, api, formToJson } from './utils.js';
import { goHome, goToResults } from './router.js';
import { applyRoomOption } from './offers.js';
import { showReview } from './review.js';

// Nomes tal como vem do sistema do operador sao codigos internos em
// espanhol, em maiusculas (ex.: "DOBLE NO REEMBOLSABLE") - parecem erro de
// integracao, nao texto para o cliente ver. Traduz os padroes conhecidos;
// para codigos desconhecidos (ex.: "DOBLE EPKT"), poe em capitalizacao
// normal em vez de adivinhar uma traducao que pode estar errada.
const KNOWN_ROOM_NAMES = {
  'DOBLE NO REEMBOLSABLE': 'Quarto duplo - tarifa não reembolsável',
  'DOBLE OFERTA': 'Quarto duplo - oferta promocional',
  'DOBLE STANDARD': 'Quarto duplo standard'
};

function humanizeRoomName(raw) {
  const key = String(raw || '').trim().toUpperCase();
  if (!key) return '';
  if (KNOWN_ROOM_NAMES[key]) return KNOWN_ROOM_NAMES[key];
  return key.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
}

let currentSearchResults = [];
let activeFilters = { stars: new Set(), boards: new Set() };

function offerRateOptions(offer) {
  return offer.roomOptions?.length ? offer.roomOptions : [{
    idDistributions: null, roomName: '', mealPlanLabel: offer.board,
    freeCancellation: offer.freeCancellation, finalPrice: offer.finalPrice
  }];
}

function computeFilterOptions(results) {
  const stars = new Set();
  const boards = new Set();
  results.forEach(r => {
    stars.add(Math.max(1, Math.min(5, Math.round(r.rating || 4))));
    offerRateOptions(r).forEach(o => boards.add(o.mealPlanLabel));
  });
  return { stars: [...stars].sort((a, b) => b - a), boards: [...boards].sort() };
}

function passesFilters(offer) {
  const starVal = Math.max(1, Math.min(5, Math.round(offer.rating || 4)));
  const starsOk = !activeFilters.stars.size || activeFilters.stars.has(starVal);
  const boardsOk = !activeFilters.boards.size || offerRateOptions(offer).some(o => activeFilters.boards.has(o.mealPlanLabel));
  return starsOk && boardsOk;
}

function renderFilters(results) {
  const { stars, boards } = computeFilterOptions(results);
  const el = $('#resultsFilters');
  if (stars.length <= 1 && boards.length <= 1) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = `
    <h3>Filtrar resultados</h3>
    ${stars.length > 1 ? `
    <div class="filter-group">
      <p class="field-label">Categoria do hotel</p>
      ${stars.map(s => `<label class="filter-check"><input type="checkbox" data-filter="stars" value="${s}" ${activeFilters.stars.has(s) ? 'checked' : ''} /> ${'★'.repeat(s)}</label>`).join('')}
    </div>` : ''}
    ${boards.length > 1 ? `
    <div class="filter-group">
      <p class="field-label">Regime alimentar</p>
      ${boards.map(b => `<label class="filter-check"><input type="checkbox" data-filter="boards" value="${b}" ${activeFilters.boards.has(b) ? 'checked' : ''} /> ${b}</label>`).join('')}
    </div>` : ''}`;
  el.querySelectorAll('input[type="checkbox"]').forEach(input => {
    input.addEventListener('change', () => {
      const set = activeFilters[input.dataset.filter];
      const val = input.dataset.filter === 'stars' ? Number(input.value) : input.value;
      if (input.checked) set.add(val); else set.delete(val);
      renderResultsList();
    });
  });
}

function rateLine(hotelIndex, rateIndex, option) {
  const name = [humanizeRoomName(option.roomName), option.mealPlanLabel].filter(Boolean).join(' · ');
  return `
    <div class="rate-line">
      <span class="rate-line-name">${esc(name)}</span>
      <span class="rate-line-tag">${option.freeCancellation ? 'Cancelamento flexível' : 'Não reembolsável'}</span>
      <span class="rate-line-price">${money(option.finalPrice)}</span>
      <button type="button" class="btn mini-action" onclick="reserveRate(${hotelIndex}, ${rateIndex})">Reservar</button>
    </div>`;
}

function renderHotelRow(offer, hotelIndex) {
  const options = offerRateOptions(offer).map((o, i) => ({ ...o, __rateIndex: offer.roomOptions?.length ? i : null }));
  const sorted = [...options].sort((a, b) => a.finalPrice - b.finalPrice);
  const visible = sorted.slice(0, 3);
  const rest = sorted.slice(3);
  const stars = '★'.repeat(Math.max(1, Math.min(5, Math.round(offer.rating || 4))));
  const trip = dateRange(offer.checkin, offer.checkout);
  return `
    <article class="hotel-row" data-index="${hotelIndex}">
      <div class="hotel-row-media" aria-hidden="true">🏨</div>
      <div class="hotel-row-info">
        <div class="meta">${offer.live ? '<span class="pill live">Preço real</span>' : '<span class="pill">Simulação</span>'}</div>
        <h3>${esc(offer.hotel)}</h3>
        <div class="hotel-row-stars">${stars}</div>
        <p class="muted small">${esc(offer.destination)}${offer.country ? `, ${esc(offer.country)}` : ''}${trip ? ` · ${trip}` : ''}</p>
      </div>
      <div class="hotel-row-rates">
        ${visible.map(o => rateLine(hotelIndex, o.__rateIndex, o)).join('')}
        ${rest.length ? `
        <button type="button" class="ghost mini-action rate-expand-toggle" data-hotel="${hotelIndex}" data-more-label="+${rest.length} opções">+${rest.length} opções</button>
        <div class="rate-line-extra" data-hotel="${hotelIndex}" hidden>${rest.map(o => rateLine(hotelIndex, o.__rateIndex, o)).join('')}</div>` : ''}
      </div>
    </article>`;
}

function renderResultsList() {
  const filtered = currentSearchResults.filter(passesFilters);
  $('#resultCount').textContent = filtered.length === currentSearchResults.length
    ? `${filtered.length} opcoes`
    : `${filtered.length} de ${currentSearchResults.length} opcoes`;
  $('#results').innerHTML = filtered.length
    ? filtered.map(r => renderHotelRow(r, currentSearchResults.indexOf(r))).join('')
    : '<p class="muted">Sem resultados para estes filtros.</p>';
}

$('#results').addEventListener('click', e => {
  const btn = e.target.closest('.rate-expand-toggle');
  if (!btn) return;
  const extra = document.querySelector(`.rate-line-extra[data-hotel="${btn.dataset.hotel}"]`);
  if (!extra) return;
  extra.hidden = !extra.hidden;
  btn.textContent = extra.hidden ? btn.dataset.moreLabel : 'Mostrar menos';
});

// "As melhores opcoes para ti": destaca ate 3 ofertas distintas dos
// proprios resultados (nunca inventadas) - a que tem maior pontuacao
// de compatibilidade (ja calculada no servidor por computeScore), a
// mais barata e a mais bem avaliada. Se duas categorias caírem na
// mesma oferta, so aparece uma vez.
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

function computeHighlights(results, budget) {
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

function renderHighlights(results, budget) {
  const el = $('#resultsHighlights');
  const picks = computeHighlights(results, budget);
  if (picks.length < 2) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <p class="eyebrow">As melhores opções para ti</p>
    <div class="highlight-grid">
      ${picks.map(p => `
        <article class="highlight-card">
          <span class="highlight-ribbon">${p.ribbon} ${esc(p.label)}</span>
          <div class="highlight-media" aria-hidden="true">🏨</div>
          <h4>${esc(p.offer.hotel)}</h4>
          <div class="hotel-row-stars">${'★'.repeat(Math.max(1, Math.min(5, Math.round(p.offer.rating || 4))))}</div>
          <p class="muted small">${esc(p.offer.destination)}${p.offer.country ? `, ${esc(p.offer.country)}` : ''}</p>
          <ul class="highlight-reasons">
            ${p.reasons.map(r => `<li>${esc(r)}</li>`).join('')}
          </ul>
          <div class="highlight-bottom">
            <div>
              <strong>${money(p.offer.finalPrice)}</strong>
              ${p.offer.score != null ? `<span class="highlight-score">${p.offer.score}% compatível</span>` : ''}
            </div>
            <button type="button" class="btn mini-action highlight-goto" data-hotel="${p.hotelIndex}">Ver oferta</button>
          </div>
        </article>`).join('')}
    </div>`;

  el.querySelectorAll('.highlight-goto').forEach(btn => {
    btn.addEventListener('click', () => goToHotelRow(btn.dataset.hotel));
  });
}

function goToHotelRow(hotelIndex) {
  const row = document.querySelector(`.hotel-row[data-index="${hotelIndex}"]`);
  if (!row) return;
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.classList.add('hotel-row-flash');
  setTimeout(() => row.classList.remove('hotel-row-flash'), 1600);
}

function renderResultsPage(data) {
  currentSearchResults = data.results;
  activeFilters = { stars: new Set(), boards: new Set() };
  const status = data.operatorStatus || {};
  const statusText = status.message || (status.source === 'tourdiez'
    ? 'Precos reais confirmados pela TourDiez neste momento.'
    : 'A mostrar alternativas enquanto o operador real nao responde.');
  const tripDates = dateRange(data.parsed.checkin, data.parsed.checkout);
  $('#resultsRecapTitle').textContent = data.parsed.destination;
  $('#resultsRecapDetails').textContent = `${tripDates ? tripDates + ' · ' : ''}${data.parsed.nights} noites · ${data.parsed.adults} adultos${data.parsed.children ? ` + ${data.parsed.children} criancas` : ''} · saida ${data.parsed.origin} · orcamento ${money(data.parsed.budget)}`;
  $('#parsedBox').innerHTML = `<b>Fonte:</b> ${esc(statusText)}`;
  renderHighlights(data.results, data.parsed.budget);
  renderFilters(data.results);
  renderResultsList();
}

// Etapas mostradas enquanto a pesquisa real corre (TourDiez + margens).
// Um resultado instantaneo sem nenhum feedback parece falso, mesmo quando o
// operador responde depressa - mostrar o que esta a acontecer da confianca.
const SEARCH_STAGES = [
  'A ligar ao operador TourDiez...',
  'A verificar disponibilidade real...',
  'A comparar precos entre operadores...',
  'A aplicar margens comerciais...',
  'A montar a melhor proposta...'
];

function renderSearchLoading() {
  $('#results').innerHTML = `
    <div class="search-loading">
      <div class="search-loading-bar"><span></span></div>
      <p id="searchLoadingText">${SEARCH_STAGES[0]}</p>
    </div>`;
  let i = 0;
  const timer = setInterval(() => {
    i = (i + 1) % SEARCH_STAGES.length;
    const el = document.getElementById('searchLoadingText');
    if (el) el.textContent = SEARCH_STAGES[i]; else clearInterval(timer);
  }, 750);
  return () => clearInterval(timer);
}

$('#searchForm').addEventListener('submit', async e => {
  e.preventDefault();
  goToResults();
  $('#parsedBox').innerHTML = '';
  $('#resultsFilters').hidden = true;
  $('#resultCount').textContent = 'A procurar...';
  $('#resultsRecapTitle').textContent = 'A procurar as melhores opcoes...';
  $('#resultsRecapDetails').textContent = '';
  const stopLoading = renderSearchLoading();
  const minDelay = new Promise(resolve => setTimeout(resolve, 1300));
  try {
    const [data] = await Promise.all([
      api('/api/search', { method: 'POST', body: JSON.stringify(formToJson(e.target)) }),
      minDelay
    ]);
    stopLoading();
    renderResultsPage(data);
  } catch (err) {
    stopLoading();
    $('#results').innerHTML = `<p class="error">${err.message}</p>`;
  }
});

$('#newSearchBtn').onclick = goHome;

window.reserveRate = function(hotelIndex, rateIndex) {
  const source = currentSearchResults[hotelIndex];
  if (!source) return;
  const offer = { ...source };
  if (rateIndex != null && offer.roomOptions?.[rateIndex]) applyRoomOption(offer, offer.roomOptions[rateIndex]);
  showReview(offer);
};
