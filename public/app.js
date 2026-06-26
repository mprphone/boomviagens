const $ = sel => document.querySelector(sel);
const money = n => `${Number(n || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
let currentOffer = null;
let lastPayment = null;
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

function openResultsModal() {
  $('#resultsModal').hidden = false;
}

function closeResultsModal() {
  $('#resultsModal').hidden = true;
}

const destinationContent = {
  'Punta Cana': 'Praias de areia branca e mar turquesa nas Caraibas. Tudo incluido pensado para relaxar sem preocupacoes, com voos diretos disponiveis.',
  'Riviera Maya': 'Costa do Mexico entre recifes de coral, cenotes e cultura maia. Ideal para quem quer praia e aventura no mesmo destino.',
  'Sal': 'Ilha de Cabo Verde com vento constante, praias quase desertas e ligacao cultural a Portugal. Otima opcao tudo incluido mais perto de casa.',
  'Maldivas': 'Vilas sobre a agua e snorkeling a porta do quarto. O destino de lua-de-mel e longo curso por excelencia.',
  'Disneyland Paris': 'A magia Disney a poucas horas de aviao, ideal para familias com criancas pequenas e fas de sempre.',
  'Madeira': 'Natureza atlantica, levadas e gastronomia portuguesa sem saida de euros nem de fronteiras.'
};

function recommendationBullets(r) {
  const bullets = [];
  bullets.push(r.freeCancellation ? 'Cancelamento flexivel disponivel' : 'Tarifa com preco mais baixo, sem reembolso');
  bullets.push(r.operatorReliability >= 9 ? 'Operador com historico de fiabilidade muito elevado' : r.operatorReliability >= 7 ? 'Operador com boa fiabilidade' : 'Operador parceiro Boomviagens');
  if (r.rating) bullets.push(`Hospedes avaliam este hotel em ${r.rating}/5`);
  bullets.push(r.label === 'Recomendado Boom' ? 'Escolha da equipa Boom para este pedido' : r.finalPrice <= (r.budget || Infinity) ? 'Dentro do orcamento indicado' : 'Acima do orcamento indicado, mas com excelente relacao qualidade/preco');
  return bullets;
}

function renderResults(data) {
  $('#resultCount').textContent = `${data.results.length} opcoes`;
  $('#parsedBox').innerHTML = `<b>Pedido interpretado:</b> ${data.parsed.destination}, ${data.parsed.nights} noites, ${data.parsed.adults} adultos, ${data.parsed.children} criancas, saida ${data.parsed.origin}, orcamento ${money(data.parsed.budget)}.`;
  $('#results').innerHTML = data.results.map((r, i) => {
    const story = destinationContent[r.destination];
    const videoQuery = encodeURIComponent(`${r.destination} ${r.hotel} video`);
    return `
    <article class="card ${i === 0 ? 'recommended' : ''}">
      <div class="meta"><span class="pill">${r.label}</span><span class="pill">Score ${r.score}/100</span><span class="pill">${r.operator}</span></div>
      <h3>${r.hotel}</h3>
      <div>${r.destination}, ${r.country}</div>
      <div class="price">${money(r.finalPrice)}</div>
      <div class="meta"><span class="pill">${r.board}</span><span class="pill">${r.nights} noites</span><span class="pill">${r.freeCancellation ? 'cancelamento flexivel' : 'tarifa restrita'}</span></div>
      ${story ? `<p class="muted">${story}</p>` : ''}
      <ul class="recommend-list">${recommendationBullets(r).map(b => `<li>${b}</li>`).join('')}</ul>
      <a class="ghost video-link" target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=${videoQuery}">Ver videos deste destino</a>
      <button class="btn" onclick='selectOffer(${JSON.stringify(r).replaceAll("'", "&apos;")})'>Reservar esta opcao</button>
    </article>`;
  }).join('');
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

window.selectOffer = function(offer) {
  currentOffer = offer;
  closeResultsModal();
  $('#checkoutPanel').hidden = false;
  $('#selectedOffer').innerHTML = `<b>${offer.hotel}</b><br>${offer.destination} - ${offer.board} - ${offer.nights} noites<br><b>Preco cliente:</b> ${money(offer.finalPrice)} - <b>Margem:</b> ${money(offer.marginValue)}<br><small>${offer.trace}</small>`;
  location.hash = '#checkoutPanel';
};

$('#closeResultsModal').onclick = closeResultsModal;
$('#resultsModal').addEventListener('click', e => {
  if (e.target.id === 'resultsModal') closeResultsModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#resultsModal').hidden) closeResultsModal();
});

$('#searchForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#results').innerHTML = '<p>A pesquisar operadores, aplicar margens e gerar proposta...</p>';
  openResultsModal();
  try {
    const data = await api('/api/search', { method: 'POST', body: JSON.stringify(formToJson(e.target)) });
    renderResults(data);
    refreshAdmin();
  } catch (err) {
    $('#results').innerHTML = `<p class="error">${err.message}</p>`;
  }
});

$('#checkoutForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!currentOffer) return alert('Escolha uma oferta primeiro.');
  const f = formToJson(e.target);
  $('#paymentBox').innerHTML = 'A criar reserva e pagamento...';
  try {
    const data = await api('/api/checkout', {
      method: 'POST',
      body: JSON.stringify({
        offer: currentOffer,
        customer: { name: f.name, email: f.email, phone: f.phone },
        paymentMethod: f.paymentMethod,
        idempotencyKey: `${currentOffer.id}-${f.email}-${Date.now()}`
      })
    });
    lastPayment = data.payment;
    $('#paymentBox').innerHTML = `
      <h3>Pagamento criado</h3>
      <p><b>Reserva:</b> ${data.reservation.id}<br><b>Referencia:</b> ${data.payment.reference}<br><b>Valor:</b> ${money(data.payment.amount)}<br><b>Metodo:</b> ${data.payment.method}</p>
      <button class="btn" id="confirmPayment">Simular pagamento recebido</button>`;
    $('#confirmPayment').onclick = confirmPayment;
    refreshAdmin();
  } catch (err) {
    $('#paymentBox').innerHTML = `<p class="error">${err.message}</p>`;
  }
});

async function confirmPayment() {
  $('#paymentBox').innerHTML += '<p>A validar preco e disponibilidade antes da aprovacao interna...</p>';
  try {
    const data = await api('/api/payment/confirm', { method: 'POST', body: JSON.stringify({ paymentId: lastPayment.id }) });
    $('#paymentBox').innerHTML = `<h3>Pagamento recebido</h3><p><b>Reserva:</b> ${data.reservation.id}<br><b>Estado:</b> ${statusLabel(data.reservation.status)}<br><b>Validacao:</b> ${data.reservation.operatorValidation}<br><b>Proximo passo:</b> aprovacao no backoffice para confirmar no operador.</p>`;
    refreshAdmin();
  } catch (err) {
    $('#paymentBox').innerHTML += `<p class="error">${err.message}</p>`;
  }
}

let pendingCustomerEmail = '';

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
    await api('/api/customer/login/verify', { method: 'POST', body: JSON.stringify({ email: pendingCustomerEmail, code: f.code }) });
    setCustomerState(true);
    loadCustomerReservations();
  } catch (err) {
    $('#customerCodeMessage').textContent = err.message;
  }
});

$('#customerLogout').onclick = async () => {
  await api('/api/customer/logout', { method: 'POST', body: '{}' });
  pendingCustomerEmail = '';
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
  $('#adminLeads').innerHTML = data.latest.leads.map(l => `<div class="mini-item"><b>${l.search.destination}</b> - ${statusLabel(l.status)}<br>${l.search.adults} adultos - orcamento ${money(l.search.budget)}</div>`).join('') || '<div class="mini-item">Sem leads.</div>';
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
      </div>
      <div class="reservation-actions">
        <span class="pill">${statusLabel(r.status)}</span>
        <select class="reservation-status-select" data-reservation="${r.id}">
          ${reservationStatuses.map(s => `<option value="${s.value}" ${s.value === r.status ? 'selected' : ''}>${s.label}</option>`).join('')}
        </select>
        <button class="ghost mini-action reservation-save" data-reservation="${r.id}">Guardar</button>
        ${r.status !== 'CANCELLED' ? `<button class="ghost mini-action reservation-cancel" data-reservation="${r.id}">Cancelar</button>` : ''}
        ${['IN_VALIDATION', 'HUMAN_REVIEW'].includes(r.status) ? `<button class="ghost mini-action" onclick="approveReservation('${r.id}')">Aprovar no operador</button>` : ''}
      </div>
    </div>`).join('') || '<div class="mini-item">Sem reservas.</div>';

  $('#reservationsTable').querySelectorAll('.reservation-save').forEach(btn => {
    btn.onclick = () => updateReservationStatus(btn.dataset.reservation);
  });
  $('#reservationsTable').querySelectorAll('.reservation-cancel').forEach(btn => {
    btn.onclick = () => { if (confirm('Cancelar esta reserva?')) updateReservationStatus(btn.dataset.reservation, 'CANCELLED'); };
  });
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
