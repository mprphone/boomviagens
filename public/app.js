const $ = sel => document.querySelector(sel);
const money = n => `${Number(n || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
const shortDate = iso => iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
const dateRange = (checkin, checkout) => (checkin && checkout) ? `${shortDate(checkin)} → ${shortDate(checkout)}` : '';
let currentOffer = null;
let lastPayment = null;
let lastReservation = null;
let adminAuthenticated = false;

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(data.error || 'Erro API');
  return data;
}

function formToJson(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function statusLabel(status) {
  return ({
    NEW_LEAD: 'Nova lead',
    PROPOSAL_SENT: 'Proposta enviada',
    PENDING_PAYMENT: 'Em pagamento',
    PAYMENT_RECEIVED: 'Pagamento recebido',
    IN_VALIDATION: 'Em validacao',
    HUMAN_REVIEW: 'Intervencao humana',
    CONFIRMED: 'Confirmada',
    CANCELLED: 'Cancelada',
    OPERATOR_ERROR: 'Erro operador'
  })[status] || status;
}

function setAdminState(authenticated) {
  adminAuthenticated = authenticated;
  $('#adminLogin').hidden = authenticated;
  $('#adminContent').hidden = !authenticated;
  $('#testOperator').hidden = !authenticated;
  $('#refreshAdmin').textContent = authenticated ? 'Terminar sessao' : 'Atualizar painel';
  if (!authenticated) $('#adminLoginMessage').textContent = 'Entre para ver reservas, leads, margens e logs.';
}

const destinationContent = {
  'Punta Cana': 'Praias de areia branca e mar turquesa nas Caraibas. Tudo incluido pensado para relaxar sem preocupacoes, com voos diretos disponiveis.',
  'Riviera Maya': 'Costa do Mexico entre recifes de coral, cenotes e cultura maia. Ideal para quem quer praia e aventura no mesmo destino.',
  'Sal': 'Ilha de Cabo Verde com vento constante, praias quase desertas e ligacao cultural a Portugal. Otima opcao tudo incluido mais perto de casa.',
  'Maldivas': 'Vilas sobre a agua e snorkeling a porta do quarto. O destino de lua-de-mel e longo curso por excelencia.',
  'Disneyland Paris': 'A magia Disney a poucas horas de aviao, ideal para familias com criancas pequenas e fas de sempre.',
  'Madeira': 'Natureza atlantica, levadas e gastronomia portuguesa sem saida de euros nem de fronteiras.'
};

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
    <p class="muted small">Precos estimados para ${destino}. O preco final e confirmado na pesquisa.</p>
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

function applyRoomOption(offer, option) {
  offer.finalPrice = option.finalPrice;
  offer.costPrice = option.costPrice;
  offer.marginRule = option.marginRule;
  offer.marginPercent = option.marginPercent;
  offer.marginValue = option.marginValue;
  offer.board = option.mealPlanLabel;
  offer.freeCancellation = option.freeCancellation;
  offer.tourdiez = { ...offer.tourdiez, idDistributions: option.idDistributions, code: option.roomCode || offer.tourdiez?.code };
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
      <span class="rate-line-name">${name}</span>
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
    <article class="hotel-row">
      <div class="hotel-row-media" aria-hidden="true">🏨</div>
      <div class="hotel-row-info">
        <div class="meta">${offer.live ? '<span class="pill live">Preço real</span>' : '<span class="pill">Simulação</span>'}</div>
        <h3>${offer.hotel}</h3>
        <div class="hotel-row-stars">${stars}</div>
        <p class="muted small">${offer.destination}${offer.country ? `, ${offer.country}` : ''}${trip ? ` · ${trip}` : ''}</p>
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
  $('#parsedBox').innerHTML = `<b>Fonte:</b> ${statusText}`;
  renderFilters(data.results);
  renderResultsList();
}

function dealToPrompt(deal) {
  return `Quero ${deal.nights} noites em ${deal.title}, ${deal.board}, para 2 adultos, ate ${Math.ceil(deal.price * 2.2)} euros, saida de ${deal.origin}.`;
}

let heroDeals = [];
let heroIndex = 0;
let heroTimer = null;

function renderHero(i) {
  const deal = heroDeals[i];
  if (!deal) return;
  document.querySelector('.hero').style.setProperty('--hero-bg', `url("${deal.image}")`);
  $('#heroCopy h1').textContent = deal.title;
  $('#heroCopy .hero-subtitle').textContent = deal.subtitle;
  $('#heroCopy .hero-facts').innerHTML = `<span>${deal.nights} noites</span><span>${deal.board}</span><span>Saida de ${deal.origin}</span>`;
  $('#heroCopy .hero-price').innerHTML = `desde <strong>${money(deal.price)}</strong> <small>por pessoa</small>`;
  $('#heroDots').innerHTML = heroDeals.map((_, idx) => `<button type="button" aria-label="Destaque ${idx + 1}" class="${idx === i ? 'active' : ''}"></button>`).join('');
  $('#heroDots').querySelectorAll('button').forEach((btn, idx) => {
    btn.onclick = () => { heroIndex = idx; renderHero(heroIndex); restartHeroTimer(); };
  });
}

function restartHeroTimer() {
  clearInterval(heroTimer);
  if (heroDeals.length < 2) return;
  heroTimer = setInterval(() => {
    heroIndex = (heroIndex + 1) % heroDeals.length;
    renderHero(heroIndex);
  }, 6000);
}

function initHero(deals) {
  heroDeals = deals.slice(0, 5);
  if (!heroDeals.length) return;
  renderHero(0);
  restartHeroTimer();
  const hero = document.querySelector('.hero');
  hero.addEventListener('mouseenter', () => clearInterval(heroTimer));
  hero.addEventListener('mouseleave', restartHeroTimer);
}

async function loadDeals() {
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

document.querySelectorAll('a[data-destino], a[data-soon]').forEach(link => {
  link.addEventListener('click', e => {
    if (link.dataset.soon) {
      e.preventDefault();
      alert(`${link.dataset.soon}: ainda nao disponivel no Boomviagens. Contacte-nos enquanto isso para tratarmos do pedido a sua medida.`);
      return;
    }
    if (!link.dataset.destino) return;
    e.preventDefault();
    const form = $('#searchForm');
    form.destination.value = link.dataset.destino;
    form.prompt.value = link.dataset.prompt || link.dataset.destino;
    location.hash = '#pesquisa';
    form.requestSubmit();
  });
});

document.querySelectorAll('.nav-dropdown-trigger').forEach(btn => {
  btn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    const parent = btn.closest('.nav-dropdown');
    const wasOpen = parent.classList.contains('open');
    document.querySelectorAll('.nav-dropdown.open').forEach(d => d.classList.remove('open'));
    if (!wasOpen) parent.classList.add('open');
  });
});

document.querySelectorAll('.nav-dropdown-panel a').forEach(link => {
  link.addEventListener('click', () => {
    link.closest('.nav-dropdown')?.classList.remove('open');
  });
});

document.addEventListener('click', e => {
  if (!e.target.closest('.nav-dropdown')) {
    document.querySelectorAll('.nav-dropdown.open').forEach(d => d.classList.remove('open'));
  }
});

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
  form.budget.value = Math.ceil(deal.price * 2.2);
  location.hash = '#pesquisa';
  form.requestSubmit();
};

function setCheckoutStep(step) {
  document.querySelectorAll('#checkoutStepper .stepper-step').forEach(el => {
    const n = Number(el.dataset.step);
    el.classList.toggle('is-active', n === step);
    el.classList.toggle('is-done', n < step);
  });
}

function renderCheckoutSummary(offer) {
  const trip = dateRange(offer.checkin, offer.checkout);
  $('#checkoutSummary').innerHTML = `
    <div class="meta">${offer.live ? '<span class="pill live">Preco real</span>' : '<span class="pill">Simulacao</span>'}</div>
    <h3>${offer.hotel}</h3>
    <p class="muted">${offer.destination}${offer.country ? `, ${offer.country}` : ''}</p>
    ${trip ? `<div class="summary-dates">${trip}</div>` : ''}
    <ul class="summary-facts">
      <li>${offer.board}</li>
      <li>${offer.nights} noites</li>
      <li>${offer.adults} adultos${offer.children ? ` + ${offer.children} criancas` : ''}</li>
      <li>${offer.freeCancellation ? 'Cancelamento flexivel' : 'Tarifa nao reembolsavel'}</li>
    </ul>
    <div class="summary-total"><span>Total</span><strong id="summaryTotalValue">${money(offer.finalPrice)}</strong></div>
    <p class="muted small">${offer.live ? 'Preco obtido diretamente no operador.' : 'Preco demonstrativo - a equipa confirma disponibilidade real antes de emitir documentos.'}</p>`;
}

function passengerFields(offer) {
  const adults = offer.adults || 1;
  const children = offer.children || 0;
  const cards = [];
  for (let i = 0; i < adults + children; i++) {
    const isChild = i >= adults;
    const label = isChild ? `Criança ${i - adults + 1}` : `Adulto ${i + 1}`;
    cards.push(`
      <div class="passenger-card">
        <div class="passenger-card-title">${label}</div>
        <div class="passenger-card-grid">
          <label>Nome <input name="passengerName_${i}" ${i === 0 ? 'value="Cliente Teste"' : ''} required /></label>
          <label>Apelido <input name="passengerSurname_${i}" /></label>
          <label>Data de nascimento <input name="passengerBirthdate_${i}" type="date" /></label>
          <label>Género
            <select name="passengerGender_${i}">
              <option value="">Prefiro não indicar</option>
              <option value="F">Feminino</option>
              <option value="M">Masculino</option>
            </select>
          </label>
          <label>Nacionalidade <input name="passengerNationality_${i}" placeholder="Portuguesa" /></label>
          <label>Tipo de documento
            <select name="passengerDocType_${i}">
              <option value="CC">Cartão de Cidadão</option>
              <option value="PASSPORT">Passaporte</option>
            </select>
          </label>
          <label>Número do documento <input name="passengerDocNumber_${i}" /></label>
          <label>País do documento <input name="passengerDocCountry_${i}" placeholder="Portugal" /></label>
          <label>Validade do documento <input name="passengerDocExpiry_${i}" type="date" /></label>
        </div>
      </div>`);
  }
  return cards.join('');
}

function renderCheckoutStep1() {
  $('#checkoutMain').innerHTML = `
    <form id="checkoutForm" class="checkout-form">
      <h3>Dados de faturacao</h3>
      <div class="form-row">
        <label>Nome completo <input name="name" value="Cliente Teste" required /></label>
        <label>Email <input type="email" name="email" value="cliente@exemplo.pt" required /></label>
      </div>
      <div class="form-row">
        <label>Telefone <input name="phone" value="+351900000000" /></label>
        <label>Contribuinte (NIF) <input name="nif" pattern="[0-9]{9}" maxlength="9" placeholder="opcional" /></label>
      </div>
      <label class="field-label">Passageiros</label>
      <div class="legal-notice">
        <span class="legal-notice-icon">⚠️</span>
        <p>Os nomes têm de corresponder exatamente ao documento de identificação (Cartão de Cidadão ou Passaporte). Correções depois da confirmação podem implicar custos adicionais cobrados pelo operador.</p>
      </div>
      <div class="passenger-list">${passengerFields(currentOffer)}</div>
      <label class="consent"><input type="checkbox" required /><span>Confirmo que os nomes e dados dos passageiros estão corretos e coincidem com o documento de identificação que vão usar na viagem.</span></label>
      <label class="field-label">Metodo de pagamento</label>
      <div class="payment-methods" role="radiogroup" aria-label="Metodo de pagamento">
        <label class="payment-option"><input type="radio" name="paymentMethod" value="MB WAY" checked /><span class="payment-option-icon">\u{1F4F1}</span><span>MB WAY</span></label>
        <label class="payment-option"><input type="radio" name="paymentMethod" value="Referência Multibanco" /><span class="payment-option-icon">\u{1F3E7}</span><span>Multibanco</span></label>
        <label class="payment-option"><input type="radio" name="paymentMethod" value="Cartão" /><span class="payment-option-icon">\u{1F4B3}</span><span>Cartão</span></label>
      </div>
      <label class="consent"><input type="checkbox" required /><span>Li e aceito os <a href="#legal">Termos e Condicoes</a> e a <a href="#legal">Politica de Privacidade</a>.</span></label>
      <div id="checkoutFormError"></div>
      <button class="btn wide" type="submit">Continuar para pagamento</button>
      <p class="trust-note">Ligacao encriptada. Os seus dados servem apenas para tratar esta reserva.</p>
    </form>`;
  $('#checkoutForm').addEventListener('submit', onCheckoutSubmit);
}

function paymentInstructions(method, payment) {
  if (method.includes('MB WAY')) {
    return `<div class="payment-method-box">
      <div class="payment-method-icon">\u{1F4F1}</div>
      <div><b>Confirme na app MB WAY</b><p class="muted">Vai receber um pedido de pagamento de ${money(payment.amount)} para aprovar na app associada ao seu numero.</p></div>
    </div>`;
  }
  if (method.includes('Multibanco')) {
    return `<div class="mb-slip">
        <div class="mb-slip-row"><span>Entidade</span><strong>12345</strong></div>
        <div class="mb-slip-row"><span>Referencia</span><strong>${payment.reference}</strong></div>
        <div class="mb-slip-row"><span>Valor</span><strong>${money(payment.amount)}</strong></div>
      </div>
      <p class="muted small">Valida ate ${new Date(payment.expiresAt).toLocaleString('pt-PT')}.</p>`;
  }
  return `<div class="payment-method-box">
    <div class="payment-method-icon">\u{1F4B3}</div>
    <div><b>Pagamento com cartao</b><p class="muted">Seria redirecionado para um gateway seguro (Stripe/SIBS) para introduzir os dados do cartao.</p></div>
  </div>`;
}

function renderCheckoutStep2(data) {
  $('#checkoutMain').innerHTML = `
    <div class="payment-step">
      <h3>Pagamento - ${data.payment.method}</h3>
      ${paymentInstructions(data.payment.method, data.payment)}
      <div class="secure-box">Reserva <b>${data.reservation.id}</b> criada. Ainda sem emissao final ate o pagamento e a disponibilidade serem validados.</div>
      <div id="checkoutPaymentError"></div>
      <button class="btn wide" id="confirmPayment" type="button">Confirmar pagamento (simulado)</button>
      <p class="trust-note">Ambiente de testes: este pagamento e simulado. Em producao liga a SIBS, Easypay, Ifthenpay, EuPago ou Stripe.</p>
    </div>`;
  $('#confirmPayment').onclick = onConfirmPayment;
}

function renderCheckoutStep3(data) {
  $('#checkoutMain').innerHTML = `
    <div class="confirmation-state">
      <div class="confirmation-icon">✓</div>
      <h3>Reserva registada com sucesso</h3>
      <p class="muted">Referencia interna <b>${data.reservation.id}</b> - estado atual: <b>${statusLabel(data.reservation.status)}</b>.</p>
      <p class="secure-box">A nossa equipa esta a validar disponibilidade e preco com o operador. Assim que confirmado, recebe email com o voucher e todos os detalhes.</p>
      <button class="ghost" type="button" id="checkoutDone">Fechar e fazer nova pesquisa</button>
    </div>`;
  $('#checkoutDone').onclick = () => {
    closeCheckoutModal();
    goHome();
  };
}

function openCheckoutModal() {
  $('#checkoutModal').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeCheckoutModal() {
  $('#checkoutModal').hidden = true;
  document.body.style.overflow = '';
}

$('#closeCheckoutModal').onclick = closeCheckoutModal;
$('#checkoutModal').addEventListener('click', e => {
  if (e.target.id === 'checkoutModal') closeCheckoutModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#checkoutModal').hidden) closeCheckoutModal();
  if (e.key === 'Escape' && !$('#passportModal').hidden) closePassportModal();
});

// Passo "Confirme a sua viagem": mostra o que foi escolhido antes de pedir
// dados pessoais - resumo, sugestao de upgrade (mesma logica que ja usavamos
// no checkout, so que agora o quarto ja fica fechado antes de chegar aqui).
function upgradeSuggestion(offer) {
  const options = offer.roomOptions;
  if (!options || options.length < 2) return null;
  const currentId = offer.tourdiez?.idDistributions;
  const current = options.find(o => o.idDistributions === currentId);
  if (!current) return null;
  const sameRoom = options.filter(o => o.roomCode === current.roomCode).sort((a, b) => a.finalPrice - b.finalPrice);

  if (!current.freeCancellation) {
    const flexible = sameRoom.find(o => o.freeCancellation && o.mealPlan === current.mealPlan);
    if (flexible) return { option: flexible, text: `Cancelamento gratuito por mais ${money(flexible.finalPrice - current.finalPrice)}` };
  }
  const idx = sameRoom.findIndex(o => o.idDistributions === currentId);
  const next = sameRoom.slice(idx + 1).find(o => o.freeCancellation === current.freeCancellation);
  if (next) return { option: next, text: `${next.mealPlanLabel} por mais ${money(next.finalPrice - current.finalPrice)}` };
  return null;
}

window.applyReviewSuggestion = function(idDistributions) {
  const option = currentOffer.roomOptions.find(o => o.idDistributions === idDistributions);
  if (!option) return;
  applyRoomOption(currentOffer, option);
  renderReview(currentOffer);
};

function renderReview(offer) {
  const trip = dateRange(offer.checkin, offer.checkout);
  const suggestion = upgradeSuggestion(offer);
  const story = destinationContent[offer.destination];
  $('#reviewContent').innerHTML = `
    <div class="review-grid">
      <div class="review-card">
        <div class="meta">${offer.live ? '<span class="pill live">Preço real</span>' : '<span class="pill">Simulação</span>'}</div>
        <h3>${offer.hotel}</h3>
        <p class="muted">${offer.destination}${offer.country ? `, ${offer.country}` : ''}</p>
        ${trip ? `<div class="summary-dates">${trip}</div>` : ''}
        <ul class="summary-facts">
          <li>${offer.board}</li>
          <li>${offer.nights} noites</li>
          <li>${offer.adults} adultos${offer.children ? ` + ${offer.children} criancas` : ''}</li>
          <li>${offer.freeCancellation ? 'Cancelamento flexível' : 'Tarifa não reembolsável'}</li>
        </ul>
        ${story ? `<p class="muted">${story}</p>` : ''}
        ${suggestion ? `
        <div class="upgrade-suggestion">
          <span class="upgrade-suggestion-icon">✨</span>
          <div class="upgrade-suggestion-body"><b>Sugestão</b><p>${suggestion.text}</p></div>
          <button type="button" class="ghost mini-action" onclick="applyReviewSuggestion('${suggestion.option.idDistributions}')">Aplicar</button>
        </div>` : ''}
      </div>
      <aside class="review-price">
        <span>Total</span>
        <strong>${money(offer.finalPrice)}</strong>
        <p class="muted small">${offer.live ? 'Preço obtido diretamente no operador.' : 'Preço demonstrativo - a equipa confirma disponibilidade real antes de emitir documentos.'}</p>
        <button type="button" class="btn wide" id="continueToDataBtn">Continuar reserva</button>
      </aside>
    </div>`;
  $('#continueToDataBtn').onclick = openPassportModal;
}

function showReview(offer) {
  currentOffer = offer;
  renderReview(offer);
  $('#reviewPage').hidden = false;
  $('#reviewPage').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

window.reserveRate = function(hotelIndex, rateIndex) {
  const source = currentSearchResults[hotelIndex];
  if (!source) return;
  const offer = { ...source };
  if (rateIndex != null && offer.roomOptions?.[rateIndex]) applyRoomOption(offer, offer.roomOptions[rateIndex]);
  showReview(offer);
};

function openPassportModal() { $('#passportModal').hidden = false; }
function closePassportModal() { $('#passportModal').hidden = true; }

$('#passportModalClose').onclick = closePassportModal;
$('#passportModal').addEventListener('click', e => { if (e.target.id === 'passportModal') closePassportModal(); });
$('#passportModalAccept').onclick = () => {
  closePassportModal();
  openCheckoutModal();
  renderCheckoutSummary(currentOffer);
  setCheckoutStep(1);
  renderCheckoutStep1();
};

$('#backToResultsBtn').onclick = () => {
  $('#reviewPage').hidden = true;
  $('#resultsPage').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

$('#newSearchBtn').onclick = goHome;

document.querySelectorAll('.main-nav a[href="#pesquisa"]:not([data-destino]):not([data-soon])').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    goHome();
  });
});

// A pagina de resultados/revisao deve aparecer sozinha, sem a homepage por
// baixo a fazer ruido visual - por isso hero/novidades/inspiracoes ficam
// escondidos enquanto se navega na pesquisa, e voltam quando se sai dela.
const HOME_SECTIONS = ['pesquisa', 'novidades', 'inspiracoes'];

function goHome() {
  HOME_SECTIONS.forEach(id => { const el = document.getElementById(id); if (el) el.hidden = false; });
  $('#resultsPage').hidden = true;
  $('#reviewPage').hidden = true;
  document.querySelector('.hero').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function goToResults() {
  HOME_SECTIONS.forEach(id => { const el = document.getElementById(id); if (el) el.hidden = true; });
  $('#reviewPage').hidden = true;
  $('#resultsPage').hidden = false;
  $('#resultsPage').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    refreshAdmin();
  } catch (err) {
    stopLoading();
    $('#results').innerHTML = `<p class="error">${err.message}</p>`;
  }
});

async function onCheckoutSubmit(e) {
  e.preventDefault();
  if (!currentOffer) return;
  const form = e.target;
  const f = formToJson(form);
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'A criar reserva...';
  $('#checkoutFormError').innerHTML = '';
  const adults = currentOffer.adults || 1;
  const total = adults + (currentOffer.children || 0);
  const passengers = Array.from({ length: total }, (_, i) => ({
    name: f[`passengerName_${i}`] || '',
    surname: f[`passengerSurname_${i}`] || '',
    type: i < adults ? 'ADT' : 'CHD',
    birthdate: f[`passengerBirthdate_${i}`] || '',
    gender: f[`passengerGender_${i}`] || '',
    nationality: f[`passengerNationality_${i}`] || '',
    documentType: f[`passengerDocType_${i}`] || '',
    documentNumber: f[`passengerDocNumber_${i}`] || '',
    documentCountry: f[`passengerDocCountry_${i}`] || '',
    documentExpiry: f[`passengerDocExpiry_${i}`] || ''
  }));
  try {
    const data = await api('/api/checkout', {
      method: 'POST',
      body: JSON.stringify({
        offer: currentOffer,
        customer: { name: f.name, email: f.email, phone: f.phone, nif: f.nif, passengers },
        paymentMethod: f.paymentMethod,
        idempotencyKey: `${currentOffer.id}-${f.email}-${Date.now()}`
      })
    });
    lastPayment = data.payment;
    lastReservation = data.reservation;
    setCheckoutStep(2);
    renderCheckoutStep2(data);
    refreshAdmin();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Continuar para pagamento';
    $('#checkoutFormError').innerHTML = `<p class="error">${err.message}</p>`;
  }
}

async function onConfirmPayment() {
  const btn = $('#confirmPayment');
  btn.disabled = true;
  btn.textContent = 'A validar...';
  $('#checkoutPaymentError').innerHTML = '';
  try {
    const data = await api('/api/payment/confirm', { method: 'POST', body: JSON.stringify({ paymentId: lastPayment.id }) });
    setCheckoutStep(3);
    renderCheckoutStep3(data);
    refreshAdmin();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Confirmar pagamento (simulado)';
    $('#checkoutPaymentError').innerHTML = `<p class="error">${err.message}</p>`;
  }
}

let pendingCustomerEmail = '';
let pendingCustomerChallenge = '';

function setCustomerState(authenticated) {
  $('#customerLoginForm').hidden = authenticated;
  $('#customerCodeForm').hidden = true;
  $('#customerContent').hidden = !authenticated;
  $('#customerLogout').hidden = !authenticated;
}

async function loadCustomerReservations() {
  try {
    const data = await api('/api/customer/reservations');
    $('#customerReservations').innerHTML = data.reservations.map(r => `
      <div class="mini-item">
        <b>${r.offer?.hotel || ''}</b> - ${statusLabel(r.status)}<br>
        ${r.offer?.destination || ''} - ${r.offer?.nights || ''} noites<br>
        ${money(r.offer?.finalPrice)}${r.operatorLocator ? ` - Localizador: ${r.operatorLocator}` : ''}
      </div>`).join('') || '<div class="mini-item">Ainda nao tem reservas.</div>';
  } catch (err) {
    $('#customerReservations').innerHTML = `<p class="error">${err.message}</p>`;
  }
}

async function refreshCustomerArea() {
  let data;
  try {
    data = await api('/api/customer/session');
  } catch (err) {
    setCustomerState(false);
    return;
  }
  setCustomerState(data.authenticated);
  if (data.authenticated) loadCustomerReservations();
}

$('#customerLoginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = formToJson(e.target);
  $('#customerLoginMessage').textContent = 'A gerar codigo...';
  try {
    const data = await api('/api/customer/login/request', { method: 'POST', body: JSON.stringify({ email: f.email }) });
    pendingCustomerEmail = f.email;
    pendingCustomerChallenge = data.challenge;
    $('#customerLoginForm').hidden = true;
    $('#customerCodeForm').hidden = false;
    $('#customerCodeMessage').textContent = `Codigo (demo, sem email real): ${data.demoCode}`;
  } catch (err) {
    $('#customerLoginMessage').textContent = err.message;
  }
});

$('#customerCodeForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = formToJson(e.target);
  $('#customerCodeMessage').textContent = 'A validar...';
  try {
    await api('/api/customer/login/verify', { method: 'POST', body: JSON.stringify({ email: pendingCustomerEmail, code: f.code, challenge: pendingCustomerChallenge }) });
    setCustomerState(true);
    loadCustomerReservations();
  } catch (err) {
    $('#customerCodeMessage').textContent = err.message;
  }
});

$('#customerLogout').onclick = async () => {
  await api('/api/customer/logout', { method: 'POST', body: '{}' });
  pendingCustomerEmail = '';
  pendingCustomerChallenge = '';
  setCustomerState(false);
  $('#customerLoginMessage').textContent = 'Entre com o seu email para ver as suas reservas.';
};

refreshCustomerArea();

window.approveReservation = async function(reservationId) {
  if (!confirm('Confirmar esta reserva no operador?')) return;
  try {
    const data = await api('/api/admin/reservations/approve', { method: 'POST', body: JSON.stringify({ reservationId }) });
    alert(`Reserva confirmada. Localizador: ${data.reservation.operatorLocator}`);
    refreshAdmin();
  } catch (err) {
    alert(err.message);
  }
};

async function refreshAdmin() {
  let data;
  try {
    data = await api('/api/admin/dashboard');
  } catch (err) {
    setAdminState(false);
    $('#adminLoginMessage').textContent = err.message.includes('Autent') ? 'Entre para ver reservas, leads, margens e logs.' : err.message;
    return;
  }
  setAdminState(true);
  $('#rnavt').textContent = data.company.rnavt || 'INSERIR_RNAVT';
  $('#kpis').innerHTML = [
    ['Leads', data.stats.leads],
    ['Clientes', data.stats.customers],
    ['Reservas confirmadas', data.stats.confirmed],
    ['Margem total', money(data.stats.margin)]
  ].map(([k, v]) => `<div class="kpi"><span>${k}</span><strong>${v}</strong></div>`).join('');
  reservationStatuses = data.statuses;
  if (!$('#reservationsStatusFilter').dataset.filled) {
    $('#reservationsStatusFilter').innerHTML = '<option value="">Todos os estados</option>' + reservationStatuses.map(s => `<option value="${s.value}">${s.label}</option>`).join('');
    $('#reservationsStatusFilter').dataset.filled = '1';
  }
  loadAdminReservations();
  loadCustomers();
  loadLeadsPipeline();
  $('#adminMargins').innerHTML = data.margins.map(m => `<div class="mini-item"><b>${m.name}</b><br>${m.percent}% - minimo ${money(m.min)} - match: ${m.match}</div>`).join('');
  $('#adminEmails').innerHTML = data.latest.emails.map(e => `<div class="mini-item"><b>${e.subject}</b><br>Para: ${e.to}<br>${e.status}</div>`).join('') || '<div class="mini-item">Sem emails.</div>';
  $('#operatorLog').textContent = JSON.stringify({ operadores: data.operators, chamadas: data.latest.logs, auditoria: data.latest.audit }, null, 2);
}

let allReservations = [];
let reservationStatuses = [];

function reservationMatchesFilter(r, query, status) {
  if (status && r.status !== status) return false;
  if (!query) return true;
  const haystack = `${r.id} ${r.customer?.name || ''} ${r.customer?.email || ''} ${r.offer?.hotel || ''} ${r.offer?.destination || ''}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function renderReservationsTable() {
  const query = $('#reservationsSearch').value.trim();
  const status = $('#reservationsStatusFilter').value;
  const filtered = allReservations.filter(r => reservationMatchesFilter(r, query, status));
  $('#reservationsTable').innerHTML = filtered.map(r => `
    <div class="reservation-row">
      <div class="reservation-main">
        <b>${r.id}</b> - ${r.customer?.name || ''} (${r.customer?.email || ''})<br>
        ${r.offer?.hotel || ''} - ${r.offer?.destination || ''} - ${money(r.offer?.finalPrice)}
        <div class="muted">Criado em ${new Date(r.createdAt).toLocaleString('pt-PT')}</div>
        ${r.missingDocuments?.length ? `<div class="pill pill-warning">Falta: ${r.missingDocuments.join(', ')}</div>` : '<div class="pill pill-ok">Documentos completos</div>'}
      </div>
      <div class="reservation-actions">
        <span class="pill">${statusLabel(r.status)}</span>
        <select class="reservation-status-select" data-reservation="${r.id}">
          ${reservationStatuses.map(s => `<option value="${s.value}" ${s.value === r.status ? 'selected' : ''}>${s.label}</option>`).join('')}
        </select>
        <button class="ghost mini-action reservation-save" data-reservation="${r.id}">Guardar</button>
        ${r.status !== 'CANCELLED' ? `<button class="ghost mini-action reservation-cancel" data-reservation="${r.id}">Cancelar</button>` : ''}
        ${['IN_VALIDATION', 'HUMAN_REVIEW'].includes(r.status) ? `<button class="ghost mini-action" onclick="approveReservation('${r.id}')">Aprovar no operador</button>` : ''}
        <button class="ghost mini-action reservation-docs-toggle" data-reservation="${r.id}">Documentos</button>
      </div>
      <div class="reservation-documents" data-reservation="${r.id}" hidden></div>
    </div>`).join('') || '<div class="mini-item">Sem reservas.</div>';

  $('#reservationsTable').querySelectorAll('.reservation-save').forEach(btn => {
    btn.onclick = () => updateReservationStatus(btn.dataset.reservation);
  });
  $('#reservationsTable').querySelectorAll('.reservation-cancel').forEach(btn => {
    btn.onclick = () => { if (confirm('Cancelar esta reserva?')) updateReservationStatus(btn.dataset.reservation, 'CANCELLED'); };
  });
  $('#reservationsTable').querySelectorAll('.reservation-docs-toggle').forEach(btn => {
    btn.onclick = () => toggleReservationDocuments(btn.dataset.reservation);
  });
}

async function toggleReservationDocuments(reservationId) {
  const panel = document.querySelector(`.reservation-documents[data-reservation="${reservationId}"]`);
  if (!panel) return;
  if (!panel.hidden) { panel.hidden = true; return; }
  document.querySelectorAll('.reservation-documents').forEach(el => { el.hidden = true; });
  panel.hidden = false;
  await loadReservationDocuments(reservationId, panel);
}

async function loadReservationDocuments(reservationId, panel) {
  panel.innerHTML = 'A carregar...';
  try {
    const data = await api(`/api/admin/documents?reservationId=${encodeURIComponent(reservationId)}`);
    renderReservationDocuments(reservationId, panel, data.documents);
  } catch (err) {
    panel.innerHTML = `<p class="error">${err.message}</p>`;
  }
}

async function refreshReservationsKeepingDocsOpen(reservationId) {
  await loadAdminReservations();
  const panel = document.querySelector(`.reservation-documents[data-reservation="${reservationId}"]`);
  if (!panel) return;
  panel.hidden = false;
  await loadReservationDocuments(reservationId, panel);
}

function renderReservationDocuments(reservationId, panel, documents) {
  panel.innerHTML = `
    <div class="doc-list">
      ${documents.map(d => `
        <div class="doc-item">
          <span class="doc-type">${d.type === 'PASSPORT' ? 'Passaporte/CC' : d.type === 'INSURANCE' ? 'Seguro' : 'Outro'}</span>
          ${d.passengerName ? `<span class="muted">${d.passengerName}</span>` : ''}
          <span class="muted">${d.fileName}</span>
          <a href="${d.signedUrl}" target="_blank" rel="noopener">Ver</a>
          <button class="ghost mini-action doc-delete" data-doc="${d.id}">Remover</button>
        </div>`).join('') || '<div class="muted">Sem documentos anexados.</div>'}
    </div>
    <form class="doc-upload-form">
      <select class="doc-type-select">
        <option value="PASSPORT">Passaporte/Cartao de cidadao</option>
        <option value="INSURANCE">Seguro de viagem</option>
        <option value="OTHER">Outro</option>
      </select>
      <input type="text" class="doc-passenger-name" placeholder="Nome do passageiro">
      <input type="file" class="doc-file-input" required>
      <button type="submit" class="ghost mini-action">Anexar</button>
    </form>`;

  panel.querySelectorAll('.doc-delete').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Remover este documento?')) return;
      try {
        await api('/api/admin/documents/delete', { method: 'POST', body: JSON.stringify({ documentId: btn.dataset.doc }) });
        await refreshReservationsKeepingDocsOpen(reservationId);
      } catch (err) { alert(err.message); }
    };
  });

  const typeSelect = panel.querySelector('.doc-type-select');
  const passengerInput = panel.querySelector('.doc-passenger-name');
  const toggleitem = () => { passengerInput.hidden = typeSelect.value !== 'PASSPORT'; };
  typeSelect.onchange = toggleitem;
  toggleitem();

  panel.querySelector('.doc-upload-form').onsubmit = async ev => {
    ev.preventDefault();
    const fileInput = panel.querySelector('.doc-file-input');
    const file = fileInput.files[0];
    if (!file) return;
    const fileBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    try {
      await api('/api/admin/documents/upload', {
        method: 'POST',
        body: JSON.stringify({
          reservationId,
          type: typeSelect.value,
          passengerName: typeSelect.value === 'PASSPORT' ? passengerInput.value : undefined,
          fileName: file.name,
          mimeType: file.type,
          fileBase64
        })
      });
      await refreshReservationsKeepingDocsOpen(reservationId);
    } catch (err) { alert(err.message); }
  };
}

async function updateReservationStatus(reservationId, forceStatus) {
  const select = document.querySelector(`.reservation-status-select[data-reservation="${reservationId}"]`);
  const status = forceStatus || select.value;
  try {
    await api('/api/admin/reservations/update', { method: 'POST', body: JSON.stringify({ reservationId, status }) });
    await loadAdminReservations();
  } catch (err) {
    alert(err.message);
  }
}

async function loadAdminReservations() {
  try {
    const data = await api('/api/admin/reservations');
    allReservations = data.reservations;
    renderReservationsTable();
  } catch (err) {
    $('#reservationsTable').innerHTML = `<p class="error">${err.message}</p>`;
  }
}

$('#reservationsSearch').addEventListener('input', renderReservationsTable);
$('#reservationsStatusFilter').addEventListener('change', renderReservationsTable);

let allCustomers = [];
let allLeads = [];
let leadStages = [];

function leadStageLabel(stage) {
  const found = leadStages.find(s => s.value === stage);
  return found ? found.label : 'Nova';
}

function renderCustomersList() {
  const query = $('#customersSearch').value.trim().toLowerCase();
  const filtered = allCustomers.filter(c => !query || `${c.name} ${c.email}`.toLowerCase().includes(query));
  $('#customersList').innerHTML = filtered.map(c => `
    <div class="mini-item customer-item">
      <div class="customer-summary" data-email="${c.email}">
        <b>${c.name}</b> - ${c.email}<br>
        ${c.phone || ''} - ${c.leadsCount} leads - ${c.reservationsCount} reservas
      </div>
      <div class="customer-detail" data-email="${c.email}" hidden></div>
    </div>`).join('') || '<div class="mini-item">Sem clientes.</div>';

  $('#customersList').querySelectorAll('.customer-summary').forEach(el => {
    el.onclick = () => toggleCustomerDetail(el.dataset.email);
  });
}

async function toggleCustomerDetail(email) {
  const detailEl = document.querySelector(`.customer-detail[data-email="${email}"]`);
  if (!detailEl) return;
  if (!detailEl.hidden) { detailEl.hidden = true; return; }
  document.querySelectorAll('.customer-detail').forEach(el => { el.hidden = true; });
  detailEl.hidden = false;
  detailEl.innerHTML = 'A carregar...';
  try {
    const data = await api(`/api/admin/customers/detail?email=${encodeURIComponent(email)}`);
    detailEl.innerHTML = `
      <label>Notas internas
        <textarea class="customer-notes" rows="3">${data.customer.notes || ''}</textarea>
      </label>
      <button class="ghost mini-action customer-save-notes">Guardar notas</button>
      <div class="muted" style="margin-top:8px"><b>Leads:</b> ${data.leads.map(l => `${l.search?.destination || ''} (${leadStageLabel(l.status)})`).join(', ') || 'nenhum'}</div>
      <div class="muted"><b>Reservas:</b> ${data.reservations.map(r => `${r.id} (${statusLabel(r.status)})`).join(', ') || 'nenhuma'}</div>`;
    detailEl.querySelector('.customer-save-notes').onclick = async () => {
      const notes = detailEl.querySelector('.customer-notes').value;
      try {
        await api('/api/admin/customers/notes', { method: 'POST', body: JSON.stringify({ email, notes }) });
      } catch (err) { alert(err.message); }
    };
  } catch (err) {
    detailEl.innerHTML = `<p class="error">${err.message}</p>`;
  }
}

async function loadCustomers() {
  try {
    const data = await api('/api/admin/customers');
    allCustomers = data.customers;
    renderCustomersList();
  } catch (err) {
    $('#customersList').innerHTML = `<p class="error">${err.message}</p>`;
  }
}

$('#customersSearch').addEventListener('input', renderCustomersList);

function renderLeadsPipeline() {
  const columns = leadStages.length ? leadStages : [{ value: 'NOVA', label: 'Nova' }, { value: 'EM_CONSULTA', label: 'Em consulta' }, { value: 'FECHADA', label: 'Fechada' }, { value: 'PERDIDA', label: 'Perdida' }];
  $('#leadsPipeline').innerHTML = columns.map(col => {
    const items = allLeads.filter(l => l.stage === col.value);
    return `
      <div class="pipeline-column">
        <h4>${col.label} <span class="badge">${items.length}</span></h4>
        ${items.map(l => `
          <div class="pipeline-card">
            <b>${l.search?.destination || ''}</b><br>
            ${l.search?.name || l.search?.email || ''}<br>
            <span class="muted">orcamento ${money(l.search?.budget)}</span>
            <select class="lead-stage-select" data-lead="${l.id}">
              ${columns.map(c => `<option value="${c.value}" ${c.value === col.value ? 'selected' : ''}>${c.label}</option>`).join('')}
            </select>
          </div>`).join('') || '<p class="muted">Sem leads.</p>'}
      </div>`;
  }).join('');

  $('#leadsPipeline').querySelectorAll('.lead-stage-select').forEach(sel => {
    sel.onchange = () => updateLeadStage(sel.dataset.lead, sel.value);
  });
}

async function updateLeadStage(leadId, status) {
  try {
    await api('/api/admin/leads/update', { method: 'POST', body: JSON.stringify({ leadId, status }) });
    await loadLeadsPipeline();
  } catch (err) {
    alert(err.message);
  }
}

async function loadLeadsPipeline() {
  try {
    const data = await api('/api/admin/leads');
    allLeads = data.leads;
    leadStages = data.leadStages;
    renderLeadsPipeline();
  } catch (err) {
    $('#leadsPipeline').innerHTML = `<p class="error">${err.message}</p>`;
  }
}

$('#adminLogin').addEventListener('submit', async e => {
  e.preventDefault();
  $('#adminLoginMessage').textContent = 'A validar credenciais...';
  try {
    await api('/api/admin/login', { method: 'POST', body: JSON.stringify(formToJson(e.target)) });
    $('#adminLoginMessage').textContent = '';
    refreshAdmin();
  } catch (err) {
    $('#adminLoginMessage').textContent = err.message;
  }
});

$('#refreshAdmin').onclick = async () => {
  if (!adminAuthenticated) return refreshAdmin();
  await api('/api/admin/logout', { method: 'POST', body: '{}' });
  setAdminState(false);
};

$('#testOperator').onclick = async () => {
  $('#operatorLog').textContent = 'A testar login + disponibilidade TourDiez...';
  try {
    const data = await api('/api/admin/operator/tourdiez/test', { method: 'POST', body: JSON.stringify({ destination: 'Punta Cana', nights: 7, adults: 2 }) });
    $('#operatorLog').textContent = JSON.stringify(data, null, 2);
    refreshAdmin();
  } catch (e) {
    $('#operatorLog').textContent = e.message;
  }
};

$('#chatForm').addEventListener('submit', async e => {
  e.preventDefault();
  const msg = e.target.message.value.trim();
  if (!msg) return;
  $('#chatMessages').innerHTML += `<p><b>Cliente:</b> ${msg}</p>`;
  e.target.reset();
  const data = await api('/api/chat', { method: 'POST', body: JSON.stringify({ message: msg }) });
  $('#chatMessages').innerHTML += `<p><b>Boom:</b> ${data.answer}${data.handoff ? '<br><small>Sugerido passar para humano.</small>' : ''}</p>`;
  $('#chatMessages').scrollTop = $('#chatMessages').scrollHeight;
});

api('/api/config').then(c => {
  $('#modeBadge').textContent = c.tourdiezConfigured ? 'TourDiez real configurado' : 'modo demo / mock';
  $('#rnavt').textContent = c.company.rnavt || 'INSERIR_RNAVT';
});

api('/api/admin/session').then(s => {
  setAdminState(s.authenticated);
  if (s.authenticated) refreshAdmin();
});

loadDeals();
