// Resultados de pesquisa V3: experiência mais comercial, filtrável e
// interativa. A pesquisa base continua barata: APIs de enriquecimento como
// Duffel/Weather/Ticketmaster só entram quando o cliente abre uma viagem.

import { $, esc, money, dateRange, shortDate, api, formToJson, safeImageUrl, safeExternalUrl, cssImageUrl, notify } from './utils.js';
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
let currentCatalogTeasers = [];
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
  if (button) { button.textContent = 'Guardada'; button.classList.add('is-saved'); }
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
  } catch (err) { notify(err.message); }
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
  if (type === 'DYNAMIC_PACKAGE') return 'Voo + hotel';
  if (type === 'PACKAGE') return 'Pacotes';
  if (type === 'HOTEL') return 'Só hotel';
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
      <button type="button" class="result-save" onclick="saveResultTrip(${hotelIndex}, this)" aria-label="Guardar viagem">Guardar</button>
      <span class="result-source">${sourceLabel(offer)}</span>
    </div>
    <div class="hotel-row-info">
      <div class="hotel-title-line"><div><h3>${esc(offer.hotel)}</h3><div class="hotel-row-stars">${stars}</div></div></div>
      <p class="muted small">${esc(offer.destination)}${offer.country ? ` · ${esc(offer.country)}` : ''}${trip ? ` · ${trip}` : ''}</p>
      <div class="result-reasons">${reasons.map(r => `<span>✓ ${esc(r)}</span>`).join('')}</div>
      <div class="result-card-actions">
        <button type="button" class="text-action" onclick="toggleCompare(${hotelIndex})">${isCompared ? 'A comparar' : 'Comparar'}</button>
        <button type="button" class="text-action" onclick="shareResultTrip(${hotelIndex}, this)">Partilhar</button>
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
  existing.hidden = filteredCount === 0 && tabs.length === 0;
  if (existing.hidden) { existing.innerHTML = ''; return; }
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
  document.querySelector('.results-layout')?.classList.toggle('is-empty', base.length === 0);
  $('#resultCount').textContent = currentProductFilter === 'ALL' ? `${filtered.length} opções` : `${filtered.length} ${productTabLabel(currentProductFilter).replace(/^[^ ]+ /,'').toLowerCase()}`;
  renderToolbar(filtered.length);
  renderHighlights(base, currentParsed.budget);
  const liveHtml = filtered.length ? filtered.map(r => renderHotelRow(r, currentSearchResults.indexOf(r))).join('') : `<div class="empty-search"><b>${base.length ? 'Não encontrámos opções com estes filtros.' : 'Não encontrámos disponibilidade nesta categoria.'}</b><span>${esc(currentSearchMessage || (base.length ? 'Experimente aumentar o preço máximo ou remover um filtro.' : 'Veja outra categoria, altere as datas ou a origem. O destino pesquisado nunca é substituído por outro.'))}</span></div>`;
  const teasersHtml = (currentParsed.searchType === 'HOTEL' || currentProductFilter === 'HOTEL') ? renderCatalogTeasers(currentCatalogTeasers) : '';
  $('#results').innerHTML = liveHtml + teasersHtml;
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
    if (compared.size >= 3) { notify('Pode comparar até 3 hotéis de cada vez.'); return; }
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

function updateTripSummary(parsed = {}, offer = null) {
  const box = $('#tripSummary');
  if (!box) return;
  const destination = parsed.destination || offer?.destination || 'A sua viagem';
  const dates = dateRange(parsed.checkin || offer?.checkin, parsed.checkout || offer?.checkout) || 'Datas por confirmar';
  const travellers = Number(parsed.adults || offer?.adults || 1) + Number(parsed.children || offer?.children || 0) + Number(parsed.infants || offer?.infants || 0);
  const price = Number(offer?.finalPrice || 0);
  const tripType = parsed.tripType === 'MULTI_CITY' ? 'Multi-cidade' : parsed.tripType === 'ONE_WAY' ? 'Só ida' : parsed.tripType ? 'Ida e volta' : '';
  box.innerHTML = `<p class="eyebrow">A sua pesquisa</p><h3>${esc(destination)}</h3><div class="trip-summary-list"><div class="trip-summary-line"><span>Datas</span><b>${esc(dates)}</b></div><div class="trip-summary-line"><span>Viajantes</span><b>${travellers}</b></div>${tripType ? `<div class="trip-summary-line"><span>Viagem</span><b>${tripType}</b></div>` : ''}</div>${price > 0 ? `<div class="trip-summary-price"><span>Opção selecionada</span><strong>${money(price)}</strong></div>` : '<p>Compare as opções e escolha a que melhor se adapta à sua viagem.</p>'}`;
}

export function renderResultsPage(data) {
  currentSearchResults = data.results || []; currentParsed = data.parsed || {}; currentSearchMessage = data.message || ''; currentCatalogTeasers = data.catalogTeasers || []; currentProductCounts = data.productCounts || { dynamic: 0, packages: 0, hotels: 0 }; compared.clear(); renderCompareBar();
  currentProductFilter = currentProductCounts.dynamic ? 'DYNAMIC_PACKAGE' : currentProductCounts.packages ? 'PACKAGE' : currentProductCounts.hotels ? 'HOTEL' : 'ALL';
  activeFilters = { stars: new Set(), boards: new Set(), freeCancellation: false, maxPrice: null, sort: 'recommended' };
  const tripDates = dateRange(data.parsed.checkin, data.parsed.checkout);
  $('#resultsRecapTitle').textContent = data.parsed.destination;
  $('#resultsRecapDetails').textContent = `${tripDates ? tripDates + ' · ' : ''}${data.parsed.nights} noites · ${data.parsed.adults} adultos${data.parsed.children ? ` + ${data.parsed.children} crianças` : ''}${data.parsed.infants ? ` + ${data.parsed.infants} bebés` : ''} · saída ${data.parsed.origin}`;
  $('#parsedBox').innerHTML = `<div class="search-confidence"><span class="search-confidence-icon">✓</span><div><b>Pesquisa concluída</b><span>${esc(customerStatusText(data.operatorStatus || {}))}</span></div></div>`;
  updateTripSummary(data.parsed);
  const initial = productResults(); if (initial.length) renderFilters(initial); else $('#resultsFilters').hidden = true; renderResultsList();
}


function assistedRequestHtml(kind, context = {}) {
  const destination = context.destination || currentParsed.destination || '';
  const notes = context.notes || '';
  return `<section class="assisted-request-card" data-assisted-box>
    <div><p class="eyebrow">Pedido assistido</p><h3>${kind === 'CRUZEIRO' ? 'Encontre o cruzeiro certo para si' : 'Quer que confirmemos esta opção?'}</h3><p class="muted">Deixe um contacto. O pedido fica registado no backoffice com o destino e as datas que está a consultar.</p></div>
    <form class="assisted-request-form" data-kind="${esc(kind)}" data-destination="${esc(destination)}" data-notes="${esc(notes)}">
      <input name="name" placeholder="Nome" required maxlength="120" />
      <input name="email" type="email" placeholder="Email" />
      <input name="phone" placeholder="Telefone" />
      <button class="btn" type="submit">Enviar pedido</button>
    </form><div class="assisted-feedback" aria-live="polite"></div></section>`;
}

function renderCatalogTeasers(items = []) {
  if (!items.length) return '';
  return `<section class="catalog-teasers"><div class="catalog-teasers-head"><div><p class="eyebrow">Mais alojamentos neste destino</p><h3>Catálogo disponível para consulta</h3></div><span>Sem preço inventado: disponibilidade a confirmar</span></div><div class="catalog-teaser-grid">${items.map((h,i)=>`<article class="catalog-teaser-card">${h.image?`<img src="${esc(safeImageUrl(h.image))}" loading="lazy" alt=""/>`:'<div class="catalog-teaser-placeholder"></div>'}<div><div class="hotel-row-stars">${'★'.repeat(Math.max(1, Math.min(5, Math.round(h.stars||4))))}</div><h4>${esc(h.name)}</h4><p class="muted small">${esc(h.city || h.address || currentParsed.destination || '')}</p><span class="status-chip neutral">Preço e disponibilidade a confirmar</span><button type="button" class="ghost mini-action catalog-interest" data-catalog-index="${i}">Pedir cotação</button></div></article>`).join('')}</div></section>`;
}

function flightLegSummary(flight = {}) {
  const slices = flight.slices || []; const out = slices[0] || {}; const ret = slices[1] || {};
  return { slices, out, ret, carriers: (flight.carriers || []).join(' / ') || out.segments?.[0]?.operatingCarrier || 'Companhia aérea' };
}
function flightSliceRow(slice = {}, index = 0, total = 1) {
  const dep = slice.departureAt ? new Date(slice.departureAt) : null;
  const date = dep && !Number.isNaN(dep.getTime()) ? dep.toLocaleDateString('pt-PT',{day:'2-digit',month:'short'}) : '';
  const duration = Number(slice.durationMinutes||0); const durationLabel = duration ? `${Math.floor(duration/60)}h${String(duration%60).padStart(2,'0')}` : '';
  return `<div class="flight-slice-row"><div class="flight-slice-seq">${total>2?`Trajeto ${index+1}`:(index===0?'Ida':'Volta')}<small>${esc(date)}</small></div><div class="flight-point"><strong>${esc(slice.origin||'')}</strong><span>${timeOnly(slice.departureAt)}</span></div><div class="flight-line"><small>${esc(durationLabel)}</small><i></i><span>${slice.stops?`${slice.stops} escala${slice.stops===1?'':'s'}`:'Direto'}</span></div><div class="flight-point"><strong>${esc(slice.destination||'')}</strong><span>${timeOnly(slice.arrivalAt)}</span></div></div>`;
}
function timeOnly(value) { try { return value ? new Date(value).toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'}) : ''; } catch { return ''; } }

function renderFlightResults(data) {
  currentSearchResults = data.results || []; currentParsed = data.parsed || {}; currentCatalogTeasers = [];
  document.querySelector('.results-layout')?.classList.toggle('is-empty', currentSearchResults.length === 0);
  const multi = currentParsed.tripType === 'MULTI_CITY';
  const tripDates = multi ? `${currentParsed.slices?.length || 0} trajetos` : dateRange(currentParsed.checkin, currentParsed.checkout);
  $('#resultsRecapTitle').textContent = multi ? 'Voos multi-cidade' : `Voos para ${currentParsed.destination || ''}`;
  $('#resultsRecapDetails').textContent = `${tripDates}${currentParsed.origin ? ` · ${currentParsed.origin}` : ''} · ${currentParsed.adults || 1} adulto(s)`;
  $('#parsedBox').innerHTML = `<div class="search-confidence"><span class="search-confidence-icon">✓</span><div><b>${currentSearchResults.length} opções encontradas</b><span>Pesquisa mundial Duffel. Comparamos companhias, escalas e preço total; a oferta é revalidada antes da reserva.</span></div></div>`;
  $('#resultsFilters').hidden = true; $('#resultsHighlights').innerHTML=''; $('#resultCount').textContent=`${currentSearchResults.length} voos`;
  $('#resultsToolbar').innerHTML = '';
  updateTripSummary(currentParsed);
  $('#results').innerHTML = currentSearchResults.length ? `<div class="flight-results-context"><div><b>${currentSearchResults.length} opções encontradas</b><span>${data.mode==='test'?'Ambiente Duffel TEST: o inventário é propositadamente reduzido. Em LIVE podem existir muitas mais opções.':'Compare por preço, duração e escalas.'}</span></div><div class="flight-filter-chips"><button class="is-active" data-flight-sort="recommended">Recomendados</button><button data-flight-sort="price">Mais baratos</button><button data-flight-sort="duration">Mais rápidos</button></div></div><div class="standalone-flight-list flight-results-v5">${currentSearchResults.map((o,i)=>{const f=flightLegSummary(o.flight);return `<article class="standalone-flight-card"><div class="flight-brand"><span>${i===0?'Melhor preço':i===1?'Boa alternativa':'Opção'}</span><b>${esc(f.carriers)}</b><small>${f.slices.length>2?'Multi-cidade':f.slices.length===1?'Só ida':'Ida e volta'}</small></div><div class="standalone-flight-legs">${f.slices.map((slice,idx)=>flightSliceRow(slice,idx,f.slices.length)).join('')}</div><div class="standalone-flight-price"><span>Total da viagem</span><strong>${money(o.finalPrice)}</strong><small>${currentParsed.adults>1?`${money(o.finalPrice/Math.max(1,currentParsed.adults))} / adulto`:''}</small><button type="button" class="btn" data-flight-select="${i}">Escolher</button></div></article>`}).join('')}</div></div>` : `<div class="empty-search"><b>Não encontrámos voos para estas condições.</b><span>Experimente outras datas, aeroportos próximos ou permita mais escalas.</span></div>`;
  document.querySelectorAll('[data-flight-select]').forEach(btn => btn.onclick=()=>showReview(currentSearchResults[Number(btn.dataset.flightSelect)]));
  document.querySelectorAll('[data-flight-sort]').forEach(btn => btn.onclick=()=>{
    const mode=btn.dataset.flightSort;
    document.querySelectorAll('[data-flight-sort]').forEach(x=>x.classList.toggle('is-active',x===btn));
    if(mode==='price') currentSearchResults.sort((a,b)=>Number(a.finalPrice||0)-Number(b.finalPrice||0));
    else if(mode==='duration') currentSearchResults.sort((a,b)=>((a.flight?.slices||[]).reduce((n,x)=>n+Number(x.durationMinutes||99999),0))-((b.flight?.slices||[]).reduce((n,x)=>n+Number(x.durationMinutes||99999),0)));
    else currentSearchResults.sort((a,b)=>Number(b.score||0)-Number(a.score||0));
    renderFlightResults({results:currentSearchResults,parsed:currentParsed,mode:data.mode});
  });
}
function eventPriceLabel(e = {}) {
  const min = Number(e.priceMin || 0); const max = Number(e.priceMax || 0);
  if (min > 0 && max > min) return `${money(min)} – ${money(max)}`;
  if (min > 0) return `desde ${money(min)}`;
  return '';
}

function eventWhenWhere(e = {}) {
  const date = e.date ? shortDate(e.date) : '';
  const time = /^\d{2}:\d{2}/.test(String(e.time || '')) ? String(e.time).slice(0, 5) : '';
  const where = [e.venue, e.city].filter(Boolean).join(' · ');
  return [date && time ? `${date} · ${time}` : date, where].filter(Boolean);
}

function renderEventCard(e = {}) {
  const url = safeExternalUrl(e.url || '');
  const price = eventPriceLabel(e);
  const whenWhere = eventWhenWhere(e);
  return `<article class="event-card">
    ${e.image ? `<img src="${esc(safeImageUrl(e.image))}" loading="lazy" alt=""/>` : '<div class="experience-placeholder"></div>'}
    <div>
      ${e.category ? `<span class="event-category">${esc(e.category)}</span>` : ''}
      <h4>${esc(e.name || e.title || 'Evento')}</h4>
      ${whenWhere.length ? `<p class="muted">${esc(whenWhere.join(' — '))}</p>` : ''}
      <div class="experience-card-bottom">
        <strong>${esc(price || 'Preço no site oficial')}</strong>
        ${url ? `<a class="btn mini-action" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Ver bilhetes</a>` : ''}
      </div>
    </div>
  </article>`;
}

// Estado por fonte (atividades/eventos): se a API não estiver configurada
// mostramos um caminho assistido em vez de um erro ou de um vazio ambíguo.
function experienceSourceFallback(kind, status) {
  const notConfigured = status && status.configured === false;
  if (kind === 'events') {
    return `<div class="empty-search experience-fallback">
      <b>${notConfigured ? 'Bilhetes online a caminho.' : 'Sem eventos publicados nestas datas.'}</b>
      <span>${notConfigured ? 'A ligação direta à bilheteira ainda não está ativa neste ambiente. Diga-nos o evento que procura e a equipa trata dos bilhetes consigo.' : 'Não encontrámos eventos neste destino para o período escolhido. Experimente outras datas ou peça ajuda à equipa.'}</span>
      <button type="button" class="btn mini-action" data-event-request>Pedir bilhetes com ajuda</button>
    </div>`;
  }
  return `<div class="empty-search experience-fallback">
    <b>${notConfigured ? 'Atividades online a caminho.' : 'Sem atividades publicadas nestas datas.'}</b>
    <span>${notConfigured ? 'A reserva direta de atividades ainda não está ativa neste ambiente, mas podemos organizar tudo por pedido assistido.' : 'Não encontrámos atividades neste destino para o período escolhido.'}</span>
    <button type="button" class="btn mini-action" data-activity-request>Pedir proposta de atividades</button>
  </div>`;
}

function renderExperienceResults(data) {
  currentSearchResults=[]; currentParsed=data.parsed||{}; currentCatalogTeasers=[];
  const activities=data.activities||[]; const events=data.events||[];
  const status=data.providerStatus||[];
  const activitiesStatus=status.find(x=>x.provider==='activities');
  const eventsStatus=status.find(x=>x.provider==='events');
  updateTripSummary(currentParsed);
  $('#resultsRecapTitle').textContent=`Experiências em ${currentParsed.destination||''}`;
  $('#resultsRecapDetails').textContent=`${dateRange(currentParsed.checkin,currentParsed.checkout)} · ${currentParsed.adults||1} adulto(s)`;
  $('#parsedBox').innerHTML=`<div class="search-confidence"><span class="search-confidence-icon">✓</span><div><b>${activities.length+events.length} sugestões encontradas</b><span>Atividades e bilhetes de eventos aparecem separados para saber exatamente o que está disponível.</span></div></div>`;
  $('#resultsFilters').hidden=true; $('#resultsHighlights').innerHTML=''; $('#resultCount').textContent=`${activities.length+events.length} opções`; $('#resultsToolbar').innerHTML='';
  const activityHtml=`<section class="experience-source"><div class="experience-source-head"><div><p class="eyebrow">Atividades</p><h3>Experiências reserváveis no destino</h3></div><span>HBX Activities</span></div>${activities.length?`<div class="experience-grid">${activities.map((a,i)=>`<article class="experience-card">${a.image?`<img src="${esc(safeImageUrl(a.image))}" loading="lazy" alt=""/>`:'<div class="experience-placeholder"></div>'}<div><h4>${esc(a.name)}</h4><p>${esc(a.description||'')}</p><div class="experience-card-bottom"><strong>${a.finalPrice>0?money(a.finalPrice):'Preço a confirmar'}</strong><button type="button" class="ghost mini-action activity-interest" data-activity-index="${i}">Tenho interesse</button></div></div></article>`).join('')}</div>`:experienceSourceFallback('activities',activitiesStatus)}</section>`;
  const eventHtml=`<section class="experience-source"><div class="experience-source-head"><div><p class="eyebrow">Durante a sua estadia</p><h3>Eventos e bilhetes nestas datas</h3></div><span>Ticketmaster</span></div>${events.length?`<div class="event-grid">${events.map(renderEventCard).join('')}</div>`:experienceSourceFallback('events',eventsStatus)}</section>`;
  $('#results').innerHTML=activityHtml+eventHtml;
}

const CRUISE_REGIONS = ['Mediterrâneo', 'Ilhas Gregas', 'Caraíbas', 'Norte da Europa e Fjords', 'Canárias e Madeira', 'Transatlântico', 'Cruzeiros fluviais', 'Volta ao mundo', 'Ainda não sei / outra'];
const CRUISE_LINES = ['Sem preferência', 'MSC Cruzeiros', 'Costa Cruzeiros', 'Royal Caribbean', 'Norwegian Cruise Line', 'Celebrity Cruises', 'Princess Cruises', 'Outra'];
const CRUISE_CABINS = ['Sem preferência', 'Interior', 'Exterior com janela', 'Varanda', 'Suite'];
const CRUISE_NIGHTS = ['3 a 5 noites', '6 a 8 noites', '9 a 14 noites', '15 ou mais noites'];

function cruiseOptions(list, selected) {
  return list.map(x => `<option value="${esc(x)}" ${x === selected ? 'selected' : ''}>${esc(x)}</option>`).join('');
}

// Cruzeiros não têm API ligada: em vez de um beco sem saída, o separador
// "Cruzeiros" abre um pedido assistido com campos próprios. O pedido entra
// no CRM com tipo CRUISE e as preferências estruturadas nas notas.
function renderCruiseRequest(payload) {
  currentParsed=payload; currentSearchResults=[]; currentCatalogTeasers=[];
  updateTripSummary(payload);
  $('#resultsRecapTitle').textContent='Cruzeiros à sua medida';
  $('#resultsRecapDetails').textContent=`${payload.destination||'Destino flexível'} · ${dateRange(payload.checkin,payload.checkout)||'Datas flexíveis'}`;
  $('#parsedBox').innerHTML='<div class="search-confidence"><span class="search-confidence-icon">⚓</span><div><b>Pedido especializado</b><span>Os cruzeiros são tratados por um especialista: preenche o pedido e recebes uma proposta com itinerário, cabine e preço final.</span></div></div>';
  $('#resultsFilters').hidden=true;$('#resultsHighlights').innerHTML='';$('#resultsToolbar').innerHTML='';$('#resultCount').textContent='Pedido assistido';
  const knownRegion = CRUISE_REGIONS.find(r => r.toLowerCase() === String(payload.destination || '').trim().toLowerCase());
  $('#results').innerHTML=`<section class="assisted-request-card cruise-request">
    <div><p class="eyebrow">Pedido de cruzeiro</p><h3>Encontre o cruzeiro certo para si</h3><p class="muted">Trabalhamos com as principais companhias. Conte-nos o que imagina e um especialista responde com propostas reais — sem compromisso.</p></div>
    <form class="cruise-form">
      <label><span>Região ou itinerário</span><select name="cruiseRegion">${cruiseOptions(CRUISE_REGIONS, knownRegion || (payload.destination ? 'Ainda não sei / outra' : CRUISE_REGIONS[0]))}</select></label>
      <label><span>Data de partida pretendida</span><input name="checkin" type="date" value="${esc(payload.checkin || '')}" /></label>
      <label><span>Duração</span><select name="cruiseNights">${cruiseOptions(CRUISE_NIGHTS, CRUISE_NIGHTS[1])}</select></label>
      <label><span>Companhia preferida</span><select name="cruiseLine">${cruiseOptions(CRUISE_LINES, CRUISE_LINES[0])}</select></label>
      <label><span>Tipo de cabine</span><select name="cruiseCabin">${cruiseOptions(CRUISE_CABINS, CRUISE_CABINS[0])}</select></label>
      <label><span>Adultos</span><input name="adults" type="number" min="1" max="20" value="${Number(payload.adults || 2)}" /></label>
      <label><span>Crianças</span><input name="children" type="number" min="0" max="10" value="${Number(payload.children || 0)}" /></label>
      <label><span>Nome</span><input name="name" required maxlength="120" autocomplete="name" /></label>
      <label><span>Email</span><input name="email" type="email" autocomplete="email" /></label>
      <label><span>Telefone</span><input name="phone" type="tel" autocomplete="tel" /></label>
      <label class="full"><span>Observações</span><textarea name="notes" rows="3" placeholder="Porto de embarque, ocasião especial, orçamento por pessoa, acessibilidade...">${payload.destination && !knownRegion ? `Itinerário pretendido: ${esc(payload.destination)}` : ''}</textarea></label>
      <p class="form-feedback full" data-cruise-feedback aria-live="polite"></p>
      <button class="btn wide full" type="submit">Pedir proposta de cruzeiro</button>
    </form></section>`;
}

document.addEventListener('submit', async e => {
  const form=e.target.closest('.cruise-form'); if(!form)return;
  e.preventDefault();
  const feedback=form.querySelector('[data-cruise-feedback]'); const button=form.querySelector('button[type="submit"]');
  const fd=formToJson(form);
  if (!fd.email && !fd.phone) { feedback.textContent='Indique pelo menos um email ou telefone.'; return; }
  const parts=[
    `Região/itinerário: ${fd.cruiseRegion}`,
    fd.checkin ? `Partida pretendida: ${fd.checkin}` : '',
    `Duração: ${fd.cruiseNights}`,
    `Companhia preferida: ${fd.cruiseLine}`,
    `Tipo de cabine: ${fd.cruiseCabin}`
  ].filter(Boolean);
  const notes=[parts.join(' · '), String(fd.notes||'').trim()].filter(Boolean).join('\n');
  button.disabled=true; button.textContent='A registar o pedido…'; feedback.textContent='';
  try {
    const data=await api('/api/assisted-request',{method:'POST',body:JSON.stringify({kind:'CRUISE',name:fd.name,email:fd.email,phone:fd.phone,destination:fd.cruiseRegion,checkin:fd.checkin,checkout:'',adults:fd.adults,children:fd.children,notes})});
    feedback.innerHTML=`<b>✓ Pedido registado</b> · referência ${esc(data.requestId)}. Um especialista de cruzeiros vai entrar em contacto consigo.`;
    form.querySelectorAll('input,select,textarea').forEach(el=>{el.disabled=true;});
    button.hidden=true;
  } catch(err){ feedback.textContent=err.message; button.disabled=false; button.textContent='Pedir proposta de cruzeiro'; }
});

document.addEventListener('submit', async e => {
  const form=e.target.closest('.assisted-request-form'); if(!form)return;
  e.preventDefault(); const feedback=form.parentElement.querySelector('.assisted-feedback'); const fd=formToJson(form);
  try { feedback.textContent='A registar pedido…'; const data=await api('/api/assisted-request',{method:'POST',body:JSON.stringify({...fd,kind:form.dataset.kind,destination:form.dataset.destination,checkin:currentParsed.checkin,checkout:currentParsed.checkout,adults:currentParsed.adults,children:currentParsed.children,notes:form.dataset.notes})}); feedback.innerHTML=`<b>✓ Pedido registado</b> · referência ${esc(data.requestId)}`; form.hidden=true; }
  catch(err){feedback.textContent=err.message;}
});

document.addEventListener('click', e => {
  const cat=e.target.closest('.catalog-interest'); if(cat){ const h=currentCatalogTeasers[Number(cat.dataset.catalogIndex)]; if(!h)return; const container=document.createElement('div');container.innerHTML=assistedRequestHtml('HOTEL',{destination:currentParsed.destination,notes:`Pedido de cotação para ${h.name}.`});cat.closest('.catalog-teaser-card')?.appendChild(container.firstElementChild);cat.disabled=true; }
  const act=e.target.closest('.activity-interest'); if(act){ const box=act.closest('.experience-card'); const name=box?.querySelector('h4')?.textContent||'Experiência'; const container=document.createElement('div');container.innerHTML=assistedRequestHtml('EXPERIENCIA',{destination:currentParsed.destination,notes:`Interesse na experiência: ${name}.`});box?.appendChild(container.firstElementChild);act.disabled=true; }
  const evReq=e.target.closest('[data-event-request]'); if(evReq){ const box=evReq.closest('.experience-source'); const container=document.createElement('div');container.innerHTML=assistedRequestHtml('EXPERIENCIA',{destination:currentParsed.destination,notes:'Pedido de bilhetes para evento (bilheteira online por configurar).'});box?.appendChild(container.firstElementChild);evReq.disabled=true; }
  const actReq=e.target.closest('[data-activity-request]'); if(actReq){ const box=actReq.closest('.experience-source'); const container=document.createElement('div');container.innerHTML=assistedRequestHtml('EXPERIENCIA',{destination:currentParsed.destination,notes:'Pedido de proposta de atividades (reserva online por configurar).'});box?.appendChild(container.firstElementChild);actReq.disabled=true; }
});

const SEARCH_STAGES = ['A consultar disponibilidade…', 'A organizar tarifas e condições…', 'A comparar preço e flexibilidade…', 'A ordenar as opções mais relevantes…', 'A preparar a sua viagem…'];
function renderSearchLoading() {
  $('#results').innerHTML = `<div class="search-loading"><div class="search-loading-bar"><span></span></div><p id="searchLoadingText">${SEARCH_STAGES[0]}</p><small>Pode guardar, comparar e personalizar uma opção sem perder a pesquisa.</small></div>`;
  let i = 0; const timer = setInterval(() => { i = (i + 1) % SEARCH_STAGES.length; const el = document.getElementById('searchLoadingText'); if (el) el.textContent = SEARCH_STAGES[i]; else clearInterval(timer); }, 750);
  return () => clearInterval(timer);
}

$('#searchForm').addEventListener('submit', async e => {
  e.preventDefault();
  const payload=formToJson(e.target); const type=String(payload.searchType||e.target.dataset.searchType||'PACKAGE').toUpperCase();
  if (!payload.destination?.trim()) { $('#destinationInput')?.focus(); return; }
  goToResults(); $('#parsedBox').innerHTML=''; $('#resultsFilters').hidden=true; $('#resultCount').textContent='A procurar…'; $('#resultsRecapTitle').textContent='A procurar as melhores opções…'; $('#resultsRecapDetails').textContent=''; $('#resultsHighlights').innerHTML='';
  if(type==='CRUISE'){renderCruiseRequest(payload);return;}
  const stopLoading=renderSearchLoading(); const minDelay=new Promise(resolve=>setTimeout(resolve,650));
  try {
    if(type==='FLIGHT') { const [data]=await Promise.all([api('/api/flights/search',{method:'POST',body:JSON.stringify(payload)}),minDelay]); stopLoading(); renderFlightResults(data); return; }
    if(type==='EXPERIENCE') { const [data]=await Promise.all([api('/api/experiences/search',{method:'POST',body:JSON.stringify(payload)}),minDelay]); stopLoading(); renderExperienceResults(data); return; }
    const [data]=await Promise.all([api('/api/search',{method:'POST',body:JSON.stringify(payload)}),minDelay]); stopLoading(); renderResultsPage(data);
  } catch(err){stopLoading();$('#results').innerHTML=`<div class="empty-search"><b>Não foi possível concluir esta pesquisa.</b><span>${esc(err.message)}</span></div>`;}
});

$('#newSearchBtn').onclick = goHome;
window.reserveRate = function(hotelIndex, rateIndex) {
  const source = currentSearchResults[hotelIndex]; if (!source) return;
  const offer = { ...source };
  if (rateIndex != null && offer.roomOptions?.[rateIndex]) applyRoomOption(offer, offer.roomOptions[rateIndex]);
  showReview(offer);
};
