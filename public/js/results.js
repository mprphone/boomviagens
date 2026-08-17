// Resultados de pesquisa V3: experiência mais comercial, filtrável e
// interativa. A pesquisa base continua barata: APIs de enriquecimento como
// Duffel/Weather/Ticketmaster só entram quando o cliente abre uma viagem.

import { $, esc, money, dateRange, api, formToJson, safeImageUrl, cssImageUrl } from './utils.js';
import { goHome, goToResults } from './router.js';
import { applyRoomOption, computeHighlights } from './offers.js';
import { showReview } from './review.js';

const RESULT_IMAGES = {
  'Punta Cana': 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=80',
  'Riviera Maya': 'https://images.unsplash.com/photo-1510097467424-192d713fd8b2?auto=format&fit=crop&w=900&q=80',
  'Sal': 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80',
  'Maldivas': 'https://images.unsplash.com/photo-1573843981267-be1999ff37cd?auto=format&fit=crop&w=900&q=80',
  'Disneyland Paris': 'https://images.unsplash.com/photo-1499856871958-5b9627545d1a?auto=format&fit=crop&w=900&q=80',
  'Madeira': 'https://images.unsplash.com/photo-1526392060635-9d6019884377?auto=format&fit=crop&w=900&q=80',
  'Gran Canaria': 'https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=900&q=80',
  'Tenerife': 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=80',
  'Atenas': 'https://images.unsplash.com/photo-1555993539-1732b0258235?auto=format&fit=crop&w=900&q=80',
  'Paris': 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=900&q=80',
  'Roma': 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?auto=format&fit=crop&w=900&q=80'
};

const KNOWN_ROOM_NAMES = {
  'DOBLE NO REEMBOLSABLE': 'Quarto duplo · tarifa não reembolsável',
  'DOBLE OFERTA': 'Quarto duplo · oferta promocional',
  'DOBLE STANDARD': 'Quarto duplo standard'
};

function resultImage(offer) { const fallback = RESULT_IMAGES[offer?.destination] || 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=900&q=80'; return safeImageUrl(offer?.image, fallback) || fallback; }
function humanizeRoomName(raw) {
  const key = String(raw || '').trim().toUpperCase();
  if (!key) return '';
  if (KNOWN_ROOM_NAMES[key]) return KNOWN_ROOM_NAMES[key];
  return key.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
}

let currentSearchResults = [];
let currentParsed = {};
let currentSearchMessage = '';
let currentProductFilter = 'ALL';
let currentProductCounts = { dynamic: 0, packages: 0, hotels: 0 };
let activeFilters = { stars: new Set(), boards: new Set(), freeCancellation: false, maxPrice: null, sort: 'recommended' };
const compared = new Set();

function saveOfferLocally(offer) {
  const key = 'boom_saved_trips_v1';
  const current = JSON.parse(localStorage.getItem(key) || '[]');
  const safe = { ...offer, costPrice: undefined, marginValue: undefined, marginPercent: undefined, trace: undefined, savedAt: new Date().toISOString() };
  localStorage.setItem(key, JSON.stringify([safe, ...current.filter(x => x.id !== offer.id)].slice(0, 20)));
}

window.saveResultTrip = function(hotelIndex, button) {
  const offer = currentSearchResults[hotelIndex];
  if (!offer) return;
  saveOfferLocally(offer);
  if (button) { button.textContent = '♥ Guardada'; button.classList.add('is-saved'); }
};

window.shareResultTrip = async function(hotelIndex, button) {
  const offer = currentSearchResults[hotelIndex];
  if (!offer) return;
  const original = button?.textContent || 'Partilhar';
  if (button) { button.disabled = true; button.textContent = 'A preparar…'; }
  try {
    const data = await api('/api/share-trip', { method: 'POST', body: JSON.stringify({ offer }) });
    if (navigator.share) await navigator.share({ title: `Viagem a ${offer.destination}`, text: `${offer.hotel} · ${money(offer.finalPrice)}`, url: data.url });
    else {
      await navigator.clipboard.writeText(data.url);
      if (button) button.textContent = 'Ligação copiada ✓';
    }
  } catch (err) { alert(err.message); }
  finally {
    if (button) { button.disabled = false; setTimeout(() => { if (button.isConnected) button.textContent = original; }, 1800); }
  }
};

function offerRateOptions(offer) {
  return offer.roomOptions?.length ? offer.roomOptions : [{ idDistributions: null, roomName: '', mealPlanLabel: offer.board, freeCancellation: offer.freeCancellation, nonRefundable: offer.nonRefundable, freeCancellationUntil: offer.freeCancellationUntil, finalPrice: offer.finalPrice }];
}

function optionsWithIndex(offer) {
  return offerRateOptions(offer).map((o, i) => ({ ...o, __rateIndex: offer.roomOptions?.length ? i : null }));
}
function cheapestOption(offer) { return [...optionsWithIndex(offer)].sort((a, b) => a.finalPrice - b.finalPrice)[0]; }

function productGroup(offer) {
  if (offer.productType === 'DYNAMIC_PACKAGE') return 'DYNAMIC_PACKAGE';
  if (offer.productType === 'PACKAGE' || offer.productType === 'PACOTE') return 'PACKAGE';
  if (offer.productType === 'HOTEL') return 'HOTEL';
  return 'OTHER';
}
function productResults() {
  return currentProductFilter === 'ALL' ? currentSearchResults : currentSearchResults.filter(o => productGroup(o) === currentProductFilter);
}
function productTabLabel(type) {
  if (type === 'DYNAMIC_PACKAGE') return '✈ Voo + hotel';
  if (type === 'PACKAGE') return '🧳 Pacotes';
  if (type === 'HOTEL') return '🏨 Só hotel';
  return 'Todas';
}

function computeFilterOptions(results) {
  const stars = new Set(); const boards = new Set();
  results.forEach(r => {
    stars.add(Math.max(1, Math.min(5, Math.round(r.rating || 4))));
    offerRateOptions(r).forEach(o => boards.add(o.mealPlanLabel));
  });
  const prices = results.map(r => cheapestOption(r)?.finalPrice || r.finalPrice).filter(Number.isFinite);
  return {
    stars: [...stars].sort((a, b) => b - a),
    boards: [...boards].sort(),
    minPrice: prices.length ? Math.min(...prices) : 0,
    maxPrice: prices.length ? Math.max(...prices) : 0
  };
}

function passesFilters(offer) {
  const starVal = Math.max(1, Math.min(5, Math.round(offer.rating || 4)));
  if (activeFilters.stars.size && !activeFilters.stars.has(starVal)) return false;
  if (activeFilters.boards.size && !offerRateOptions(offer).some(o => activeFilters.boards.has(o.mealPlanLabel))) return false;
  if (activeFilters.freeCancellation && !offerRateOptions(offer).some(o => o.freeCancellation)) return false;
  if (activeFilters.maxPrice && (cheapestOption(offer)?.finalPrice || offer.finalPrice) > activeFilters.maxPrice) return false;
  return true;
}

function sortResults(results) {
  const list = [...results];
  if (activeFilters.sort === 'price') return list.sort((a, b) => (cheapestOption(a)?.finalPrice || a.finalPrice) - (cheapestOption(b)?.finalPrice || b.finalPrice));
  if (activeFilters.sort === 'rating') return list.sort((a, b) => (b.rating || 0) - (a.rating || 0) || a.finalPrice - b.finalPrice);
  if (activeFilters.sort === 'flexible') return list.sort((a, b) => Number(Boolean(b.freeCancellation)) - Number(Boolean(a.freeCancellation)) || (b.score || 0) - (a.score || 0));
  return list.sort((a, b) => (b.score || 0) - (a.score || 0) || a.finalPrice - b.finalPrice);
}

function renderFilters(results) {
  const opts = computeFilterOptions(results);
  const el = $('#resultsFilters');
  el.hidden = false;
  const cap = Number.isFinite(opts.maxPrice) ? Math.ceil(opts.maxPrice / 50) * 50 : 5000;
  const currentMax = activeFilters.maxPrice || cap;
  el.innerHTML = `
    <div class="filters-head"><h3>Filtrar</h3><button type="button" class="filter-reset" id="resetFiltersBtn">Limpar</button></div>
    <div class="filter-group">
      <p class="field-label">Preço máximo <b id="priceFilterValue">${money(currentMax)}</b></p>
      <input class="price-range" id="priceFilter" type="range" min="${Math.max(50, Math.floor((opts.minPrice || 50) / 50) * 50)}" max="${cap}" step="50" value="${currentMax}" />
    </div>
    <div class="filter-group">
      <label class="filter-switch"><input id="freeCancellationFilter" type="checkbox" ${activeFilters.freeCancellation ? 'checked' : ''}/><span></span> Cancelamento flexível</label>
    </div>
    ${opts.stars.length > 1 ? `<div class="filter-group"><p class="field-label">Categoria</p>${opts.stars.map(s => `<label class="filter-check"><input type="checkbox" data-filter="stars" value="${s}" ${activeFilters.stars.has(s) ? 'checked' : ''}/> ${'★'.repeat(s)}</label>`).join('')}</div>` : ''}
    ${opts.boards.length > 1 ? `<div class="filter-group"><p class="field-label">Regime</p>${opts.boards.map(b => `<label class="filter-check"><input type="checkbox" data-filter="boards" value="${esc(b)}" ${activeFilters.boards.has(b) ? 'checked' : ''}/> ${esc(b)}</label>`).join('')}</div>` : ''}`;

  el.querySelectorAll('input[data-filter]').forEach(input => input.addEventListener('change', () => {
    const set = activeFilters[input.dataset.filter];
    const val = input.dataset.filter === 'stars' ? Number(input.value) : input.value;
    input.checked ? set.add(val) : set.delete(val);
    renderResultsList();
  }));
  $('#freeCancellationFilter').onchange = e => { activeFilters.freeCancellation = e.target.checked; renderResultsList(); };
  $('#priceFilter').oninput = e => { activeFilters.maxPrice = Number(e.target.value); $('#priceFilterValue').textContent = money(activeFilters.maxPrice); renderResultsList(); };
  $('#resetFiltersBtn').onclick = () => { activeFilters = { stars: new Set(), boards: new Set(), freeCancellation: false, maxPrice: null, sort: activeFilters.sort }; renderFilters(results); renderResultsList(); };
}

function rateLine(hotelIndex, rateIndex, option) {
  const name = [humanizeRoomName(option.roomName), option.mealPlanLabel].filter(Boolean).join(' · ');
  return `<div class="rate-line">
    <span class="rate-line-name">${esc(name || 'Tarifa disponível')}</span>
    <span class="rate-line-tag ${option.freeCancellation ? 'is-flexible' : ''}">${option.freeCancellation ? '✓ Cancelamento flexível' : option.nonRefundable ? 'Não reembolsável' : 'Com condições de cancelamento'}</span>
    <span class="rate-line-price">${money(option.finalPrice)}</span>
    <button type="button" class="btn mini-action" onclick="reserveRate(${hotelIndex}, ${rateIndex})">Escolher</button>
  </div>`;
}

function sourceLabel(offer) {
  if (offer.productType === 'DYNAMIC_PACKAGE') return 'Voo + hotel';
  if (offer.productType === 'PACKAGE' || offer.productType === 'PACOTE') return 'Pacote';
  if (offer.productType === 'HOTEL') return 'Só hotel';
  if (offer.live) return 'Preço atualizado';
  return 'Proposta';
}


function renderHotelRow(offer, hotelIndex) {
  const options = optionsWithIndex(offer);
  const sorted = [...options].sort((a, b) => a.finalPrice - b.finalPrice);
  const visible = sorted.slice(0, 3); const rest = sorted.slice(3);
  const stars = '★'.repeat(Math.max(1, Math.min(5, Math.round(offer.rating || 4))));
  const trip = dateRange(offer.checkin, offer.checkout);
  const perPerson = Number(sorted[0]?.finalPrice || offer.finalPrice || 0) / Math.max(1, Number(offer.adults || 1) + Number(offer.children || 0) + Number(offer.infants || 0));
  const isCompared = compared.has(hotelIndex);
  const reasons = [offer.freeCancellation ? 'Cancelamento flexível' : null, /tudo inclu/i.test(offer.board || '') ? 'Tudo incluído' : null, Number(offer.rating || 0) >= 4.5 ? 'Excelente classificação' : null].filter(Boolean);
  return `<article class="hotel-row" data-index="${hotelIndex}">
    <div class="hotel-row-media" style="background-image:url('${cssImageUrl(resultImage(offer))}')">
      <button type="button" class="result-save" onclick="saveResultTrip(${hotelIndex}, this)" aria-label="Guardar viagem">♡ Guardar</button>
      <span class="result-source">${sourceLabel(offer)}</span>
    </div>
    <div class="hotel-row-info">
      <div class="hotel-title-line"><div><h3>${esc(offer.hotel)}</h3><div class="hotel-row-stars">${stars}</div></div></div>
      <p class="muted small">${esc(offer.destination)}${offer.country ? ` · ${esc(offer.country)}` : ''}${trip ? ` · ${trip}` : ''}</p>
      <div class="result-reasons">${reasons.map(r => `<span>✓ ${esc(r)}</span>`).join('')}</div>
      <div class="result-card-actions">
        <button type="button" class="text-action" onclick="toggleCompare(${hotelIndex})">${isCompared ? '✓ A comparar' : '⇄ Comparar'}</button>
        <button type="button" class="text-action" onclick="shareResultTrip(${hotelIndex}, this)">↗ Partilhar</button>
      </div>
      <div class="result-from"><span>desde</span><strong>${money(sorted[0]?.finalPrice || offer.finalPrice)}</strong><small>${money(perPerson)} / pessoa</small></div>
    </div>
    <div class="hotel-row-rates">
      <div class="rates-heading"><b>Escolha a tarifa</b><span>${sorted.length} opção${sorted.length === 1 ? '' : 'ões'}</span></div>
      ${visible.map(o => rateLine(hotelIndex, o.__rateIndex, o)).join('')}
      ${rest.length ? `<button type="button" class="ghost mini-action rate-expand-toggle" data-hotel="${hotelIndex}" data-more-label="+${rest.length} opções">+${rest.length} opções</button><div class="rate-line-extra" data-hotel="${hotelIndex}" hidden>${rest.map(o => rateLine(hotelIndex, o.__rateIndex, o)).join('')}</div>` : ''}
    </div>
  </article>`;
}

function renderToolbar(filteredCount) {
  const existing = document.getElementById('resultsToolbar');
  if (!existing) return;
  const tabs = [
    ['DYNAMIC_PACKAGE', currentProductCounts.dynamic || 0],
    ['PACKAGE', currentProductCounts.packages || 0],
    ['HOTEL', currentProductCounts.hotels || 0]
  ].filter(([, count]) => count > 0);
  const totalFamilies = tabs.length;
  existing.innerHTML = `<div class="product-tabs-wrap"><div class="product-tabs">${totalFamilies > 1 ? `<button type="button" data-product="ALL" class="${currentProductFilter==='ALL'?'is-active':''}">Todas <span>${currentSearchResults.length}</span></button>` : ''}${tabs.map(([type,count])=>`<button type="button" data-product="${type}" class="${currentProductFilter===type?'is-active':''}">${productTabLabel(type)} <span>${count}</span></button>`).join('')}</div><small><b>${filteredCount}</b> opções nesta vista</small></div><label>Ordenar por <select id="resultsSort"><option value="recommended">Recomendadas</option><option value="price">Preço mais baixo</option><option value="rating">Melhor classificação</option><option value="flexible">Mais flexíveis</option></select></label>`;
  existing.querySelectorAll('[data-product]').forEach(btn => btn.onclick = () => {
    currentProductFilter = btn.dataset.product;
    activeFilters = { stars: new Set(), boards: new Set(), freeCancellation: false, maxPrice: null, sort: activeFilters.sort };
    const base = productResults();
    if (base.length) renderFilters(base); else $('#resultsFilters').hidden = true;
    renderResultsList();
  });
  $('#resultsSort').value = activeFilters.sort;
  $('#resultsSort').onchange = e => { activeFilters.sort = e.target.value; renderResultsList(); };
}

function renderResultsList() {
  const base = productResults();
  const filtered = sortResults(base.filter(passesFilters));
  $('#resultCount').textContent = currentProductFilter === 'ALL' ? `${filtered.length} opções` : `${filtered.length} ${productTabLabel(currentProductFilter).replace(/^[^ ]+ /,'').toLowerCase()}`;
  renderToolbar(filtered.length);
  renderHighlights(base, currentParsed.budget);
  $('#results').innerHTML = filtered.length ? filtered.map(r => renderHotelRow(r, currentSearchResults.indexOf(r))).join('') : `<div class="empty-search"><b>${base.length ? 'Não encontrámos opções com estes filtros.' : 'Não encontrámos disponibilidade nesta categoria.'}</b><span>${esc(currentSearchMessage || (base.length ? 'Experimente aumentar o preço máximo ou remover um filtro.' : 'Veja outra categoria, altere as datas ou a origem. O destino pesquisado nunca é substituído por outro.'))}</span></div>`;
}

$('#results').addEventListener('click', e => {
  const btn = e.target.closest('.rate-expand-toggle');
  if (!btn) return;
  const extra = document.querySelector(`.rate-line-extra[data-hotel="${btn.dataset.hotel}"]`);
  if (!extra) return;
  extra.hidden = !extra.hidden;
  btn.textContent = extra.hidden ? btn.dataset.moreLabel : 'Mostrar menos';
});

function renderHighlights(results, budget) {
  const el = $('#resultsHighlights'); const picks = computeHighlights(results, budget);
  if (picks.length < 2) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="highlight-head"><div><p class="eyebrow">Comece por aqui</p><h3>As opções que fazem mais sentido</h3></div><span>Selecionadas com base em preço, hotel e condições</span></div><div class="highlight-grid">${picks.map(p => { const globalIndex = currentSearchResults.indexOf(p.offer); return `
    <article class="highlight-card"><span class="highlight-ribbon">${p.ribbon} ${esc(p.label)}</span><div class="highlight-media" style="background-image:url('${cssImageUrl(resultImage(p.offer))}')"></div><h4>${esc(p.offer.hotel)}</h4><div class="hotel-row-stars">${'★'.repeat(Math.max(1, Math.min(5, Math.round(p.offer.rating || 4))))}</div><p class="muted small">${esc(p.offer.destination)}${p.offer.country ? ` · ${esc(p.offer.country)}` : ''}</p><ul class="highlight-reasons">${p.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul><div class="highlight-bottom"><div><strong>${money(p.offer.finalPrice)}</strong><span class="highlight-score">Recomendação Boomviagens</span></div><button type="button" class="btn mini-action highlight-goto" data-hotel="${globalIndex}">Ver opção</button></div></article>`; }).join('')}</div>`;
  el.querySelectorAll('.highlight-goto').forEach(btn => btn.addEventListener('click', () => goToHotelRow(btn.dataset.hotel)));
}

function goToHotelRow(hotelIndex) {
  const row = document.querySelector(`.hotel-row[data-index="${hotelIndex}"]`);
  if (!row) return;
  row.scrollIntoView({ behavior: 'smooth', block: 'center' }); row.classList.add('hotel-row-flash'); setTimeout(() => row.classList.remove('hotel-row-flash'), 1600);
}

function ensureCompareBar() {
  let bar = document.getElementById('compareBar');
  if (!bar) {
    bar = document.createElement('div'); bar.id = 'compareBar'; bar.className = 'compare-bar'; bar.hidden = true; document.body.appendChild(bar);
  }
  return bar;
}

function renderCompareBar() {
  const bar = ensureCompareBar();
  const items = [...compared].map(i => ({ index: i, offer: currentSearchResults[i] })).filter(x => x.offer);
  if (!items.length) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.innerHTML = `<div class="compare-bar-inner"><div class="compare-bar-title"><b>Comparar hotéis</b><span>${items.length}/3 selecionados</span></div><div class="compare-mini-list">${items.map(({ index, offer }) => `<div class="compare-mini"><span>${esc(offer.hotel)}</span><b>${money(cheapestOption(offer)?.finalPrice || offer.finalPrice)}</b><button type="button" onclick="toggleCompare(${index})">×</button></div>`).join('')}</div><button type="button" class="btn" id="openCompareBtn" ${items.length < 2 ? 'disabled' : ''}>Comparar ${items.length > 1 ? items.length : ''}</button></div>`;
  const btn = $('#openCompareBtn'); if (btn) btn.onclick = openCompareModal;
}

window.toggleCompare = function(index) {
  index = Number(index);
  if (compared.has(index)) compared.delete(index);
  else {
    if (compared.size >= 3) { alert('Pode comparar até 3 hotéis de cada vez.'); return; }
    compared.add(index);
  }
  renderResultsList(); renderCompareBar();
};

function openCompareModal() {
  const items = [...compared].map(i => ({ index: i, offer: currentSearchResults[i] })).filter(x => x.offer);
  if (items.length < 2) return;
  let modal = document.getElementById('compareModal');
  if (!modal) { modal = document.createElement('div'); modal.id = 'compareModal'; modal.className = 'compare-modal'; document.body.appendChild(modal); }
  modal.innerHTML = `<div class="compare-dialog"><div class="compare-dialog-head"><div><p class="eyebrow">Comparação lado a lado</p><h2>Qual combina melhor consigo?</h2></div><button type="button" id="closeCompareBtn">×</button></div><div class="compare-grid">${items.map(({ index, offer }) => { const rate = cheapestOption(offer); return `<article><img src="${esc(resultImage(offer))}" alt=""/><h3>${esc(offer.hotel)}</h3><div class="hotel-row-stars">${'★'.repeat(Math.max(1, Math.min(5, Math.round(offer.rating || 4))))}</div><dl><div><dt>Preço</dt><dd>${money(rate?.finalPrice || offer.finalPrice)}</dd></div><div><dt>Regime</dt><dd>${esc(rate?.mealPlanLabel || offer.board)}</dd></div><div><dt>Cancelamento</dt><dd>${rate?.freeCancellation ? 'Flexível' : 'Restrito'}</dd></div><div><dt>Noites</dt><dd>${offer.nights}</dd></div></dl><button type="button" class="btn wide" onclick="reserveRate(${index}, ${rate?.__rateIndex ?? 'null'})">Ver esta viagem</button></article>`; }).join('')}</div></div>`;
  modal.classList.add('is-open'); $('#closeCompareBtn').onclick = () => modal.classList.remove('is-open'); modal.onclick = e => { if (e.target === modal) modal.classList.remove('is-open'); };
}

function customerStatusText(status) {
  if (status.source === 'verified' || status.source === 'verified_or_live') return 'Consultámos os fornecedores disponíveis para este destino e organizámos as soluções por tipo de viagem.';
  if (status.source === 'requires_validation') return 'Algumas opções serão novamente validadas antes do pagamento.';
  return 'Compare, guarde e reveja as condições antes de reservar.';
}

function renderResultsPage(data) {
  currentSearchResults = data.results; currentParsed = data.parsed; currentSearchMessage = data.message || ''; currentProductCounts = data.productCounts || { dynamic: 0, packages: 0, hotels: 0 }; compared.clear(); renderCompareBar();
  currentProductFilter = currentProductCounts.dynamic ? 'DYNAMIC_PACKAGE' : currentProductCounts.packages ? 'PACKAGE' : currentProductCounts.hotels ? 'HOTEL' : 'ALL';
  activeFilters = { stars: new Set(), boards: new Set(), freeCancellation: false, maxPrice: null, sort: 'recommended' };
  const tripDates = dateRange(data.parsed.checkin, data.parsed.checkout);
  $('#resultsRecapTitle').textContent = data.parsed.destination;
  $('#resultsRecapDetails').textContent = `${tripDates ? tripDates + ' · ' : ''}${data.parsed.nights} noites · ${data.parsed.adults} adultos${data.parsed.children ? ` + ${data.parsed.children} crianças` : ''}${data.parsed.infants ? ` + ${data.parsed.infants} bebés` : ''} · saída ${data.parsed.origin}`;
  $('#parsedBox').innerHTML = `<div class="search-confidence"><span class="search-confidence-icon">✓</span><div><b>Pesquisa concluída</b><span>${esc(customerStatusText(data.operatorStatus || {}))}</span></div></div>`;
  const initial = productResults(); if (initial.length) renderFilters(initial); else $('#resultsFilters').hidden = true; renderResultsList();
}

const SEARCH_STAGES = ['A consultar disponibilidade…', 'A organizar tarifas e condições…', 'A comparar preço e flexibilidade…', 'A ordenar as opções mais relevantes…', 'A preparar a sua viagem…'];
function renderSearchLoading() {
  $('#results').innerHTML = `<div class="search-loading"><div class="search-loading-bar"><span></span></div><p id="searchLoadingText">${SEARCH_STAGES[0]}</p><small>Pode guardar, comparar e personalizar uma opção sem perder a pesquisa.</small></div>`;
  let i = 0; const timer = setInterval(() => { i = (i + 1) % SEARCH_STAGES.length; const el = document.getElementById('searchLoadingText'); if (el) el.textContent = SEARCH_STAGES[i]; else clearInterval(timer); }, 750);
  return () => clearInterval(timer);
}

$('#searchForm').addEventListener('submit', async e => {
  e.preventDefault(); goToResults(); $('#parsedBox').innerHTML = ''; $('#resultsFilters').hidden = true; $('#resultCount').textContent = 'A procurar…'; $('#resultsRecapTitle').textContent = 'A procurar as melhores opções…'; $('#resultsRecapDetails').textContent = ''; $('#resultsHighlights').innerHTML = '';
  const stopLoading = renderSearchLoading(); const minDelay = new Promise(resolve => setTimeout(resolve, 900));
  try { const [data] = await Promise.all([api('/api/search', { method: 'POST', body: JSON.stringify(formToJson(e.target)) }), minDelay]); stopLoading(); renderResultsPage(data); }
  catch (err) { stopLoading(); $('#results').innerHTML = `<p class="error">${esc(err.message)}</p>`; }
});

$('#newSearchBtn').onclick = goHome;
window.reserveRate = function(hotelIndex, rateIndex) {
  const source = currentSearchResults[hotelIndex]; if (!source) return;
  const offer = { ...source };
  if (rateIndex != null && offer.roomOptions?.[rateIndex]) applyRoomOption(offer, offer.roomOptions[rateIndex]);
  showReview(offer);
};
