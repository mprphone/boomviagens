// Formulario de pesquisa inteligente: sugestao de destinos enquanto se
// escreve e o calendario de precos por dia no campo Data.

import { $, esc, api } from './utils.js';

// Destinos que o motor de pesquisa reconhece (ver smartParse em
// src/mockOperators.js) - a sugestao so mostra o que realmente vai dar
// resultados relevantes, nao uma lista generica desligada dos dados.
const KNOWN_DESTINATIONS = [
  { name: 'Punta Cana', icon: '🏝️' },
  { name: 'Riviera Maya', icon: '🌊' },
  { name: 'Sal', icon: '🏖️' },
  { name: 'Boa Vista', icon: '🏖️' },
  { name: 'Maldivas', icon: '🌴' },
  { name: 'Disneyland Paris', icon: '🎢' },
  { name: 'Madeira', icon: '🌋' },
  { name: 'Torremolinos', icon: '🏨' }
];

// Os paineis usam position:fixed (nao absolute) porque o hero tem
// overflow:hidden e altura limitada - um dropdown "absolute" dentro dele
// fica cortado. Calculamos a posicao a partir do input real.
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

function renderDestinationSuggestions(query) {
  const panel = $('#destinationSuggest');
  if (!panel) return;
  const q = query.trim().toLowerCase();
  const matches = KNOWN_DESTINATIONS.filter(d => !q || d.name.toLowerCase().includes(q));
  if (!matches.length) { panel.hidden = true; return; }
  positionPanelBelow(panel, $('#destinationInput'), false);
  panel.innerHTML = matches.map(d => `<button type="button" class="suggest-item" data-value="${d.name}"><span>${d.icon}</span>${d.name}</button>`).join('');
  panel.hidden = false;
}

$('#destinationInput')?.addEventListener('input', e => renderDestinationSuggestions(e.target.value));
$('#destinationInput')?.addEventListener('focus', e => renderDestinationSuggestions(e.target.value));
$('#destinationSuggest')?.addEventListener('click', e => {
  const btn = e.target.closest('.suggest-item');
  if (!btn) return;
  $('#destinationInput').value = btn.dataset.value;
  $('#destinationSuggest').hidden = true;
  calendarCache = null;
});

// Calendario de precos por dia (campo Data) - preco estimado pelo mesmo
// motor que a pesquisa demo usa, para nao ter de bater na API real da
// TourDiez 60 vezes de cada vez que se abre o calendario.
let calendarCache = null;

async function loadPriceCalendar() {
  const form = $('#searchForm');
  const params = {
    destination: form.destination.value,
    nights: form.nights.value,
    adults: form.adults.value,
    children: form.children.value
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
  panel.innerHTML = '<p class="muted small">A calcular precos...</p>';
  const days = await loadPriceCalendar();
  const months = groupDaysByMonth(days).slice(0, 2);
  const destino = $('#destinationInput').value || 'o destino escolhido';
  panel.innerHTML = `
    <p class="muted small">Precos estimados para ${esc(destino)}. O preco final e confirmado na pesquisa.</p>
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
  if (destinationInput && destinationPanel && e.target !== destinationInput && !destinationPanel.contains(e.target)) {
    destinationPanel.hidden = true;
  }
  const checkinInput = $('#checkinInput');
  const calendarPanel = $('#calendarPanel');
  if (checkinInput && calendarPanel && e.target !== checkinInput && !calendarPanel.contains(e.target)) {
    calendarPanel.hidden = true;
  }
});
