// Pesquisa principal: destino assistido pelo servidor, calendário de preços
// e passageiros com idades. O objetivo é pedir informação suficiente para
// obter tarifas corretas sem transformar a pesquisa num formulário pesado.

import { $, esc, api } from './utils.js';

const SEARCH_MODES = {
  PACKAGE: { destination: 'Para onde quer ir?', checkin: 'Ida / entrada', checkout: 'Volta / saída', submit: 'Pesquisar viagens', origin: true },
  HOTEL: { destination: 'Cidade, ilha ou localidade', checkin: 'Entrada', checkout: 'Saída', submit: 'Pesquisar hotéis', origin: false },
  FLIGHT: { destination: 'Para onde quer voar?', checkin: 'Ida', checkout: 'Volta', submit: 'Pesquisar voos', origin: true },
  EXPERIENCE: { destination: 'Onde quer descobrir experiências?', checkin: 'Desde', checkout: 'Até', submit: 'Ver experiências', origin: false },
  CRUISE: { destination: 'Destino, região ou itinerário', checkin: 'A partir de', checkout: 'Até', submit: 'Pedir proposta', origin: false }
};

function isoDateOffset(days) {
  const d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()+days); return d.toISOString().slice(0,10);
}
function syncNightsFromDates() {
  const a = $('#checkinInput')?.value; const b = $('#checkoutInput')?.value;
  if (!a || !b) return;
  const diff = Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
  if (diff > 0 && $('#nightsInput')) $('#nightsInput').value = String(Math.min(60, diff));
}
export function setSearchType(type = 'PACKAGE') {
  type = String(type || 'PACKAGE').toUpperCase();
  if (!SEARCH_MODES[type]) type = 'PACKAGE';
  const cfg = SEARCH_MODES[type]; const form = $('#searchForm');
  if (!form) return;
  form.dataset.searchType = type; $('#searchTypeInput').value = type;
  document.querySelectorAll('#productSwitch [data-search-type]').forEach(btn => btn.classList.toggle('is-active', btn.dataset.searchType === type));
  const destination = $('#destinationInput'); if (destination) destination.placeholder = cfg.destination;
  if ($('#checkinLabel')) $('#checkinLabel').textContent = cfg.checkin;
  if ($('#checkoutLabel')) $('#checkoutLabel').textContent = cfg.checkout;
  if ($('#originField')) $('#originField').hidden = !cfg.origin;
  const flightMode = type === 'FLIGHT';
  const flightPanel = $('#flightSearchPanel'); if (flightPanel) flightPanel.hidden = !flightMode;
  const genericPills = form.querySelector('.search-pills'); if (genericPills) genericPills.hidden = flightMode;
  form.classList.toggle('flight-mode', flightMode);
  const submit = form.querySelector('.search-submit'); if (submit) submit.textContent = cfg.submit;
  const trust = form.querySelector('.search-trust-line');
  if (trust) trust.innerHTML = type === 'FLIGHT' ? '<span>✓ Comparamos horários e preços</span><span>✓ Tarifas revalidadas antes de reservar</span><span>✓ Apoio humano sempre que precisar</span>' : type === 'EXPERIENCE' ? '<span>✓ Atividades HBX</span><span>✓ Eventos Ticketmaster</span><span>✓ Sem inventar disponibilidade</span>' : type === 'CRUISE' ? '<span>✓ Pedido tratado por especialista</span><span>✓ Guardamos o seu interesse</span><span>✓ Sem compromisso</span>' : '<span>✓ Comparamos preço e condições</span><span>✓ Pagamento seguro</span><span>✓ Apoio humano sempre que precisar</span>';
}

document.querySelectorAll('#productSwitch [data-search-type]').forEach(btn => btn.addEventListener('click', () => setSearchType(btn.dataset.searchType)));

document.querySelectorAll('.search-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.search-tab').forEach(t => {
      t.classList.toggle('is-active', t === tab);
      t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
    });
    $('#searchForm').classList.toggle('mode-ai', tab.dataset.mode === 'ai');
  });
});

const DESTINATION_FALLBACK = [
  { name: 'Punta Cana', country: 'República Dominicana', icon: '🏝️' },
  { name: 'Riviera Maya', country: 'México', icon: '🌊' },
  { name: 'Sal', country: 'Cabo Verde', icon: '🏖️' },
  { name: 'Maldivas', country: 'Maldivas', icon: '🌴' },
  { name: 'Disneyland Paris', country: 'França', icon: '🎢' },
  { name: 'Madeira', country: 'Portugal', icon: '🌋' }
];
let destinationTimer = null;
let destinationRequestSeq = 0;

function positionPanelBelow(panel, input, alignRight) {
  const rect = input.getBoundingClientRect();
  panel.style.top = `${rect.bottom + 6}px`;
  if (alignRight) {
    panel.style.left = 'auto';
    panel.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
  } else {
    panel.style.left = `${rect.left}px`;
    panel.style.right = 'auto';
  }
}

function localDestinationSuggestions(query) {
  const q = String(query || '').trim().toLowerCase();
  return DESTINATION_FALLBACK.filter(d => !q || `${d.name} ${d.country}`.toLowerCase().includes(q));
}

function paintDestinationSuggestions(items) {
  const panel = $('#destinationSuggest');
  if (!panel) return;
  if (!items?.length) { panel.hidden = true; return; }
  positionPanelBelow(panel, $('#destinationInput'), false);
  panel.innerHTML = items.map(d => `
    <button type="button" class="suggest-item" data-value="${esc(d.name)}" data-iata="${esc(d.iata || '')}">
      <span class="suggest-icon">${esc(d.icon || '📍')}</span>
      <span><b>${esc(d.name)}</b>${d.country ? `<small>${esc(d.country)}${d.iata ? ` · ${esc(d.iata)}` : ''}</small>` : ''}</span>
    </button>`).join('');
  panel.hidden = false;
}

async function renderDestinationSuggestions(query) {
  const seq = ++destinationRequestSeq;
  try {
    const data = await api(`/api/destinations/suggest?q=${encodeURIComponent(String(query || '').slice(0, 80))}`);
    if (seq !== destinationRequestSeq) return;
    paintDestinationSuggestions(data.destinations || []);
  } catch {
    if (seq !== destinationRequestSeq) return;
    paintDestinationSuggestions(localDestinationSuggestions(query));
  }
}

function queueDestinationSuggestions(query) {
  clearTimeout(destinationTimer);
  destinationTimer = setTimeout(() => renderDestinationSuggestions(query), 160);
}

$('#destinationInput')?.addEventListener('input', e => { if ($('#destinationIataInput')) $('#destinationIataInput').value=''; queueDestinationSuggestions(e.target.value); });
$('#destinationInput')?.addEventListener('focus', e => renderDestinationSuggestions(e.target.value));
$('#destinationSuggest')?.addEventListener('click', e => {
  const btn = e.target.closest('.suggest-item');
  if (!btn) return;
  $('#destinationInput').value = btn.dataset.value;
  if ($('#destinationIataInput')) $('#destinationIataInput').value = btn.dataset.iata || '';
  $('#destinationSuggest').hidden = true;
  calendarCache = null;
});

// Calendário de preços: só aparece quando o servidor dispõe de uma fonte
// segura (ou em modo demo de desenvolvimento). Nunca inventa preços públicos.
let calendarCache = null;

async function loadPriceCalendar() {
  const form = $('#searchForm');
  const params = {
    destination: form.destination.value,
    nights: form.nights.value,
    adults: form.adults.value,
    children: form.children.value,
    infants: form.infants?.value || 0,
    childAges: form.childAges?.value || '',
    infantAges: form.infantAges?.value || ''
  };
  const key = JSON.stringify(params);
  if (calendarCache?.key === key) return calendarCache;
  try {
    const data = await api('/api/price-calendar', { method: 'POST', body: JSON.stringify(params) });
    calendarCache = { key, days: data.days || [], available: data.available !== false, message: data.message || '', demo: Boolean(data.demo) };
    return calendarCache;
  } catch {
    return { key, days: [], available: false, message: 'Calendário temporariamente indisponível.' };
  }
}

function groupDaysByMonth(days) {
  const months = new Map();
  days.forEach(d => {
    const date = new Date(`${d.date}T00:00:00`);
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    if (!months.has(key)) {
      months.set(key, { year: date.getFullYear(), month: date.getMonth(), label: date.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' }), priceByDay: new Map() });
    }
    months.get(key).priceByDay.set(date.getDate(), d.price);
  });
  return [...months.values()];
}

function renderCalendarMonth(group) {
  const firstWeekday = (new Date(group.year, group.month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(group.year, group.month + 1, 0).getDate();
  let cells = '';
  for (let i = 0; i < firstWeekday; i++) cells += '<span class="cal-cell cal-empty"></span>';
  for (let day = 1; day <= daysInMonth; day++) {
    const price = group.priceByDay.get(day);
    const iso = `${group.year}-${String(group.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    cells += price
      ? `<button type="button" class="cal-cell cal-day" data-date="${iso}"><span>${day}</span><small>${Math.round(price)}€</small></button>`
      : `<span class="cal-cell cal-day cal-unavailable">${day}</span>`;
  }
  const label = group.label.charAt(0).toUpperCase() + group.label.slice(1);
  return `<div class="cal-month"><h4>${label}</h4><div class="cal-weekdays"><span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span><span>Dom</span></div><div class="cal-grid">${cells}</div></div>`;
}

async function openCalendar() {
  const panel = $('#calendarPanel');
  if (!panel) return;
  $('#destinationSuggest').hidden = true;
  positionPanelBelow(panel, $('#checkinInput'), true);
  panel.hidden = false;
  panel.innerHTML = '<p class="muted small">A calcular preços…</p>';
  const calendar = await loadPriceCalendar();
  const destino = $('#destinationInput').value || 'o destino escolhido';
  if (!calendar.available || !calendar.days.length) {
    panel.innerHTML = `<p class="muted small"><b>Escolha a data da viagem</b></p><p class="muted small">${esc(calendar.message || 'Ainda não temos histórico real suficiente para apresentar preços por dia.')}</p>`;
    return;
  }
  const months = groupDaysByMonth(calendar.days).slice(0, 2);
  panel.innerHTML = `
    <p class="muted small">${calendar.demo ? 'Preços de demonstração' : 'Preços de referência'} para ${esc(destino)}. O preço final é confirmado na pesquisa.</p>
    <div class="cal-months">${months.map(renderCalendarMonth).join('')}</div>`;
}

$('#calendarPanel')?.addEventListener('click', e => {
  const btn = e.target.closest('.cal-day:not(.cal-unavailable)');
  if (!btn?.dataset.date) return;
  $('#checkinInput').value = btn.dataset.date;
  $('#calendarPanel').hidden = true;
});
$('#nightsInput')?.addEventListener('change', () => { calendarCache = null; });

document.addEventListener('click', e => {
  const destinationInput = $('#destinationInput');
  const destinationPanel = $('#destinationSuggest');
  if (destinationInput && destinationPanel && e.target !== destinationInput && !destinationPanel.contains(e.target)) destinationPanel.hidden = true;
  const checkinInput = $('#checkinInput');
  const calendarPanel = $('#calendarPanel');
  if (checkinInput && calendarPanel && e.target !== checkinInput && !calendarPanel.contains(e.target)) calendarPanel.hidden = true;
});

function parseAgeInput(id, count, fallback) {
  const raw = String($(id)?.value || '').split(',').map(x => Number(x)).filter(Number.isFinite);
  return Array.from({ length: count }, (_, i) => Number.isFinite(raw[i]) ? raw[i] : fallback);
}

function renderAgeSelectors() {
  const children = Number($('#childrenInput')?.value || 0);
  const infants = Number($('#infantsInput')?.value || 0);
  const childAges = parseAgeInput('#childAgesInput', children, 8).map(x => Math.max(2, Math.min(11, x)));
  const infantAges = parseAgeInput('#infantAgesInput', infants, 1).map(x => Math.max(0, Math.min(1, x)));

  const childBox = $('#childAgesBox');
  if (childBox) {
    childBox.hidden = !children;
    childBox.innerHTML = children ? `<span class="field-label">Idades das crianças na data da viagem</span><div class="pax-age-grid">${childAges.map((age, i) => `<label>Criança ${i + 1}<select data-child-age="${i}">${Array.from({ length: 10 }, (_, j) => j + 2).map(v => `<option value="${v}" ${v === age ? 'selected' : ''}>${v} anos</option>`).join('')}</select></label>`).join('')}</div>` : '';
  }
  const infantBox = $('#infantAgesBox');
  if (infantBox) {
    infantBox.hidden = !infants;
    infantBox.innerHTML = infants ? `<span class="field-label">Idades dos bebés na data da viagem</span><div class="pax-age-grid">${infantAges.map((age, i) => `<label>Bebé ${i + 1}<select data-infant-age="${i}"><option value="0" ${age === 0 ? 'selected' : ''}>Menos de 1 ano</option><option value="1" ${age === 1 ? 'selected' : ''}>1 ano</option></select></label>`).join('')}</div>` : '';
  }
  $('#childAgesInput').value = childAges.join(',');
  $('#infantAgesInput').value = infantAges.join(',');
}

function paxSummaryText() {
  const adults = Number($('#adultsInput')?.value || 1);
  const children = Number($('#childrenInput')?.value || 0);
  const infants = Number($('#infantsInput')?.value || 0);
  return `${adults} adulto${adults === 1 ? '' : 's'}${children ? ` · ${children} criança${children === 1 ? '' : 's'}` : ''}${infants ? ` · ${infants} bebé${infants === 1 ? '' : 's'}` : ''}`;
}

function syncPaxUi() {
  const adults = Number($('#adultsInput')?.value || 1);
  const children = Number($('#childrenInput')?.value || 0);
  const infants = Number($('#infantsInput')?.value || 0);
  if ($('#adultsCount')) $('#adultsCount').textContent = adults;
  if ($('#childrenCount')) $('#childrenCount').textContent = children;
  if ($('#infantsCount')) $('#infantsCount').textContent = infants;
  if ($('#paxSummary')) $('#paxSummary').textContent = paxSummaryText();
  renderAgeSelectors();
  calendarCache = null;
}

function openPaxPanel() {
  const panel = $('#paxPanel');
  const trigger = $('#paxTrigger');
  if (!panel || !trigger) return;
  positionPanelBelow(panel, trigger, true);
  panel.hidden = false;
  syncPaxUi();
}

$('#paxTrigger')?.addEventListener('click', openPaxPanel);
$('#paxTrigger')?.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPaxPanel(); } });
$('#paxPanelClose')?.addEventListener('click', () => { $('#paxPanel').hidden = true; });
$('#paxApplyBtn')?.addEventListener('click', () => { syncPaxUi(); $('#paxPanel').hidden = true; });
$('#paxPanel')?.addEventListener('change', e => {
  if (e.target.matches('[data-child-age]')) {
    const children = Number($('#childrenInput').value || 0);
    const ages = parseAgeInput('#childAgesInput', children, 8);
    ages[Number(e.target.dataset.childAge)] = Number(e.target.value);
    $('#childAgesInput').value = ages.join(',');
    calendarCache = null;
  }
  if (e.target.matches('[data-infant-age]')) {
    const infants = Number($('#infantsInput').value || 0);
    const ages = parseAgeInput('#infantAgesInput', infants, 1);
    ages[Number(e.target.dataset.infantAge)] = Number(e.target.value);
    $('#infantAgesInput').value = ages.join(',');
    calendarCache = null;
  }
});
$('#paxPanel')?.addEventListener('click', e => {
  const btn = e.target.closest('[data-pax]');
  if (!btn) return;
  const id = btn.dataset.pax === 'adults' ? '#adultsInput' : btn.dataset.pax === 'children' ? '#childrenInput' : '#infantsInput';
  const input = $(id);
  const min = btn.dataset.pax === 'adults' ? 1 : 0;
  const max = 8;
  input.value = Math.min(max, Math.max(min, Number(input.value || min) + Number(btn.dataset.delta || 0)));
  syncPaxUi();
});

document.addEventListener('click', e => {
  const panel = $('#paxPanel');
  const trigger = $('#paxTrigger');
  if (panel && trigger && !panel.hidden && !panel.contains(e.target) && !trigger.contains(e.target)) panel.hidden = true;
});


// --- Pesquisa aérea mundial -------------------------------------------------
// A Duffel expõe Places (cidades e aeroportos). Usamos esse endpoint para
// nunca limitar o cliente a Lisboa/Porto/Faro e para aceitar áreas
// metropolitanas (LON, NYC, PAR...) além de aeroportos concretos.
let airportRequestSeq = 0;
const airportTimers = new WeakMap();

function airportLabel(place = {}) {
  const code = place.iataCode || '';
  const city = place.cityName || '';
  const name = place.name || city;
  if (place.type === 'city') return `${city || name} (${code}) · todos os aeroportos`;
  return `${city ? `${city} · ` : ''}${name} (${code})`;
}

function closeAirportSuggests(except = null) {
  document.querySelectorAll('.airport-suggest').forEach(el => { if (el !== except) el.hidden = true; });
}

async function loadAirportSuggestions(input, panel, hidden) {
  const q = String(input.value || '').trim();
  hidden.value = '';
  if (q.length < 2) { panel.hidden = true; return; }
  const seq = ++airportRequestSeq;
  panel.hidden = false;
  panel.innerHTML = '<div class="airport-suggest-loading">A procurar no mundo inteiro…</div>';
  try {
    const data = await api(`/api/airports/suggest?q=${encodeURIComponent(q)}`);
    if (seq !== airportRequestSeq) return;
    const places = data.places || [];
    if (!places.length) {
      panel.innerHTML = '<div class="airport-suggest-empty">Nenhum aeroporto ou cidade encontrado.</div>';
      return;
    }
    panel.innerHTML = places.map(p => `<button type="button" class="airport-option" data-iata="${esc(p.iataCode)}" data-label="${esc(airportLabel(p))}">
      <span class="airport-code">${esc(p.iataCode)}</span>
      <span class="airport-copy"><b>${esc(p.cityName || p.name)}</b><small>${esc(p.type === 'city' ? `Cidade · ${p.countryCode || ''}` : `${p.name || ''} · ${p.countryCode || ''}`)}</small></span>
      <span class="airport-type">${p.type === 'city' ? 'Cidade' : 'Aeroporto'}</span>
    </button>`).join('');
  } catch (err) {
    panel.innerHTML = `<div class="airport-suggest-empty">${esc(err.message || 'Pesquisa temporariamente indisponível.')}</div>`;
  }
}

function wireAirportField(input, hidden, panel) {
  if (!input || !hidden || !panel || input.dataset.airportWired) return;
  input.dataset.airportWired = '1';
  input.addEventListener('input', () => {
    hidden.value = '';
    clearTimeout(airportTimers.get(input));
    airportTimers.set(input, setTimeout(() => loadAirportSuggestions(input, panel, hidden), 180));
  });
  input.addEventListener('focus', () => { closeAirportSuggests(panel); if (input.value.trim().length >= 2) loadAirportSuggestions(input, panel, hidden); });
  panel.addEventListener('click', e => {
    const btn = e.target.closest('.airport-option'); if (!btn) return;
    input.value = btn.dataset.label || btn.dataset.iata;
    hidden.value = btn.dataset.iata || '';
    panel.hidden = true;
  });
}

function wireAllAirportFields(root = document) {
  root.querySelectorAll('[data-airport-field]').forEach(field => {
    const input = field.querySelector('input:not([type="hidden"])');
    const hidden = field.querySelector('input[type="hidden"]');
    const panel = field.querySelector('.airport-suggest');
    wireAirportField(input, hidden, panel);
  });
}

document.addEventListener('click', e => {
  if (!e.target.closest('[data-airport-field]')) closeAirportSuggests();
});

let flightTripType = 'ROUND_TRIP';
function setFlightTripType(type) {
  flightTripType = ['ROUND_TRIP','ONE_WAY','MULTI_CITY'].includes(type) ? type : 'ROUND_TRIP';
  if ($('#flightTripType')) $('#flightTripType').value = flightTripType;
  document.querySelectorAll('#tripTypeSwitch [data-trip-type]').forEach(b => b.classList.toggle('is-active', b.dataset.tripType === flightTripType));
  if ($('#flightSimpleRow')) $('#flightSimpleRow').hidden = flightTripType === 'MULTI_CITY';
  if ($('#multiCityPanel')) $('#multiCityPanel').hidden = flightTripType !== 'MULTI_CITY';
  if ($('#flightReturnField')) $('#flightReturnField').hidden = flightTripType === 'ONE_WAY';
  if (flightTripType === 'MULTI_CITY' && !$('#multiCityRows')?.children.length) renderMultiCityRows([
    { originLabel: '', origin: '', destinationLabel: '', destination: '', departureDate: $('#flightDepartureDate')?.value || isoDateOffset(30) },
    { originLabel: '', origin: '', destinationLabel: '', destination: '', departureDate: $('#flightReturnDate')?.value || isoDateOffset(37) }
  ]);
}

document.querySelectorAll('#tripTypeSwitch [data-trip-type]').forEach(btn => btn.addEventListener('click', () => setFlightTripType(btn.dataset.tripType)));

function multiCityRowHtml(leg = {}, index = 0) {
  return `<div class="multicity-row" data-leg-index="${index}">
    <span class="multicity-number">${index + 1}</span>
    <label class="flight-place-field" data-airport-field><small>De</small><input placeholder="Cidade ou aeroporto" value="${esc(leg.originLabel || '')}" autocomplete="off"><input type="hidden" value="${esc(leg.origin || '')}"><div class="airport-suggest" hidden></div></label>
    <label class="flight-place-field" data-airport-field><small>Para</small><input placeholder="Cidade ou aeroporto" value="${esc(leg.destinationLabel || '')}" autocomplete="off"><input type="hidden" value="${esc(leg.destination || '')}"><div class="airport-suggest" hidden></div></label>
    <label class="flight-date-field"><small>Data</small><input type="date" value="${esc(leg.departureDate || isoDateOffset(30 + index * 3))}" min="${isoDateOffset(1)}"></label>
    ${index >= 2 ? '<button type="button" class="remove-leg" aria-label="Remover trajeto">×</button>' : '<span class="remove-leg-placeholder"></span>'}
  </div>`;
}

function readMultiCityRows() {
  return [...document.querySelectorAll('#multiCityRows .multicity-row')].map(row => {
    const fields = row.querySelectorAll('[data-airport-field]');
    return {
      originLabel: fields[0]?.querySelector('input:not([type="hidden"])')?.value || '',
      origin: fields[0]?.querySelector('input[type="hidden"]')?.value || '',
      destinationLabel: fields[1]?.querySelector('input:not([type="hidden"])')?.value || '',
      destination: fields[1]?.querySelector('input[type="hidden"]')?.value || '',
      departureDate: row.querySelector('input[type="date"]')?.value || ''
    };
  });
}

function renderMultiCityRows(legs) {
  const host = $('#multiCityRows'); if (!host) return;
  host.innerHTML = legs.slice(0,6).map(multiCityRowHtml).join('');
  wireAllAirportFields(host);
  host.querySelectorAll('.remove-leg').forEach(btn => btn.addEventListener('click', () => {
    const current = readMultiCityRows(); const idx = Number(btn.closest('.multicity-row')?.dataset.legIndex || -1);
    if (idx >= 2) { current.splice(idx,1); renderMultiCityRows(current); }
  }));
}

$('#addMultiCityLeg')?.addEventListener('click', () => {
  const current = readMultiCityRows(); if (current.length >= 6) return;
  const previous = current[current.length - 1] || {};
  current.push({ originLabel: previous.destinationLabel || '', origin: previous.destination || '', destinationLabel: '', destination: '', departureDate: isoDateOffset(30 + current.length * 3) });
  renderMultiCityRows(current);
});

function syncFlightDatesToForm() {
  if ($('#checkinInput')) $('#checkinInput').value = $('#flightDepartureDate')?.value || '';
  if ($('#checkoutInput')) $('#checkoutInput').value = flightTripType === 'ONE_WAY' ? '' : ($('#flightReturnDate')?.value || '');
  if ($('#destinationInput')) $('#destinationInput').value = $('#flightDestinationText')?.value || $('#flightDestinationIata')?.value || 'Voo';
  const originSelect = document.querySelector('#originField select[name="origin"]');
  if (originSelect && $('#flightOriginIata')?.value) {
    let opt = [...originSelect.options].find(x => x.value === $('#flightOriginIata').value);
    if (!opt) { opt = new Option($('#flightOriginIata').value, $('#flightOriginIata').value); originSelect.add(opt); }
    originSelect.value = $('#flightOriginIata').value;
  }
  if ($('#flightPaxSummary')) $('#flightPaxSummary').textContent = paxSummaryText();
  if ($('#multiPaxSummary')) $('#multiPaxSummary').textContent = paxSummaryText();
}

function validateAirportSelection(textId, iataId, label) {
  const text = $(textId)?.value.trim(); let iata = $(iataId)?.value.trim().toUpperCase();
  if (!iata && /^[A-Za-z]{3}$/.test(text || '')) { iata = text.toUpperCase(); $(iataId).value = iata; }
  if (!text || !/^[A-Z]{3}$/.test(iata)) {
    $(textId)?.focus();
    throw new Error(`Escolha ${label} a partir da lista de cidades/aeroportos (ou escreva o código IATA).`);
  }
}

function submitFlightSearch() {
  try {
    syncFlightDatesToForm();
    if (flightTripType === 'MULTI_CITY') {
      const legs = readMultiCityRows();
      if (legs.length < 2) throw new Error('Adicione pelo menos dois trajetos.');
      legs.forEach((leg, i) => {
        if (!/^[A-Z]{3}$/.test(leg.origin) || !/^[A-Z]{3}$/.test(leg.destination)) throw new Error(`Escolha origem e destino do trajeto ${i+1} a partir das sugestões.`);
        if (!leg.departureDate) throw new Error(`Indique a data do trajeto ${i+1}.`);
      });
      $('#multiCitySlicesInput').value = JSON.stringify(legs.map(x => ({ origin:x.origin, destination:x.destination, departureDate:x.departureDate })));
      $('#destinationInput').value = legs.map(x => `${x.origin}-${x.destination}`).join(' · ');
      $('#checkinInput').value = legs[0].departureDate; $('#checkoutInput').value = legs[legs.length-1].departureDate;
    } else {
      validateAirportSelection('#flightOriginText','#flightOriginIata','a origem');
      validateAirportSelection('#flightDestinationText','#flightDestinationIata','o destino');
      if (!$('#flightDepartureDate').value) throw new Error('Escolha a data de ida.');
      if (flightTripType === 'ROUND_TRIP' && !$('#flightReturnDate').value) throw new Error('Escolha a data de volta.');
      $('#multiCitySlicesInput').value = '';
    }
    $('#searchForm').requestSubmit();
  } catch (err) {
    const note = $('#flightWorldNoteError');
    if (note) note.textContent = err.message;
    else alert(err.message);
  }
}

$('#flightSearchSubmit')?.addEventListener('click', submitFlightSearch);
$('#multiCitySearchSubmit')?.addEventListener('click', submitFlightSearch);
$('#flightPaxTrigger')?.addEventListener('click', openPaxPanel);
$('#multiPaxTrigger')?.addEventListener('click', openPaxPanel);
$('#swapAirportsBtn')?.addEventListener('click', () => {
  const aText=$('#flightOriginText'), bText=$('#flightDestinationText'), aCode=$('#flightOriginIata'), bCode=$('#flightDestinationIata');
  [aText.value,bText.value]=[bText.value,aText.value]; [aCode.value,bCode.value]=[bCode.value,aCode.value];
});
wireAllAirportFields();
setFlightTripType('ROUND_TRIP');

const today = isoDateOffset(1);
if ($('#flightDepartureDate')) { $('#flightDepartureDate').min=today; if(!$('#flightDepartureDate').value) $('#flightDepartureDate').value=isoDateOffset(30); }
if ($('#flightReturnDate')) { $('#flightReturnDate').min=today; if(!$('#flightReturnDate').value) $('#flightReturnDate').value=isoDateOffset(37); }
const checkin = $('#checkinInput'); const checkout = $('#checkoutInput');
if (checkin) { checkin.min = today; if (!checkin.value) checkin.value = isoDateOffset(30); }
if (checkout) { checkout.min = checkin?.value || today; if (!checkout.value) checkout.value = isoDateOffset(37); }
checkin?.addEventListener('change', () => {
  if (checkout) { checkout.min = checkin.value || today; if (!checkout.value || checkout.value <= checkin.value) checkout.value = isoDateOffset(37); }
  syncNightsFromDates(); calendarCache = null;
});
checkout?.addEventListener('change', syncNightsFromDates);
syncNightsFromDates();
setSearchType($('#searchTypeInput')?.value || 'PACKAGE');
syncPaxUi();
