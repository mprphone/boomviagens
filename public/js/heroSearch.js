// Pesquisa principal: destino assistido pelo servidor, calendário de preços
// e passageiros com idades. O objetivo é pedir informação suficiente para
// obter tarifas corretas sem transformar a pesquisa num formulário pesado.

import { $, esc, api } from './utils.js';

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
    <button type="button" class="suggest-item" data-value="${esc(d.name)}">
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

$('#destinationInput')?.addEventListener('input', e => queueDestinationSuggestions(e.target.value));
$('#destinationInput')?.addEventListener('focus', e => renderDestinationSuggestions(e.target.value));
$('#destinationSuggest')?.addEventListener('click', e => {
  const btn = e.target.closest('.suggest-item');
  if (!btn) return;
  $('#destinationInput').value = btn.dataset.value;
  $('#destinationSuggest').hidden = true;
  calendarCache = null;
});

// Calendário de preços: usa a estimativa local do motor atual. Não faz uma
// chamada a um fornecedor por cada dia mostrado.
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
  if (calendarCache?.key === key) return calendarCache.days;
  try {
    const data = await api('/api/price-calendar', { method: 'POST', body: JSON.stringify(params) });
    calendarCache = { key, days: data.days };
    return data.days;
  } catch {
    return [];
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
  const days = await loadPriceCalendar();
  const months = groupDaysByMonth(days).slice(0, 2);
  const destino = $('#destinationInput').value || 'o destino escolhido';
  panel.innerHTML = `
    <p class="muted small">Preços estimados para ${esc(destino)}. O preço final é confirmado na pesquisa.</p>
    <div class="cal-months">${months.map(renderCalendarMonth).join('')}</div>`;
}

$('#checkinInput')?.addEventListener('click', openCalendar);
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

syncPaxUi();
