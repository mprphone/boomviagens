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

function renderResults(data) {
  $('#resultCount').textContent = `${data.results.length} opcoes`;
  $('#parsedBox').innerHTML = `<b>Pedido interpretado:</b> ${data.parsed.destination}, ${data.parsed.nights} noites, ${data.parsed.adults} adultos, ${data.parsed.children} criancas, saida ${data.parsed.origin}, orcamento ${money(data.parsed.budget)}.`;
  $('#results').innerHTML = data.results.map((r, i) => `
    <article class="card ${i === 0 ? 'recommended' : ''}">
      <div class="meta"><span class="pill">${r.label}</span><span class="pill">Score ${r.score}/100</span><span class="pill">${r.operator}</span></div>
      <h3>${r.hotel}</h3>
      <div>${r.destination}, ${r.country}</div>
      <div class="price">${money(r.finalPrice)}</div>
      <div class="meta"><span class="pill">${r.board}</span><span class="pill">${r.nights} noites</span><span class="pill">${r.freeCancellation ? 'cancelamento flexivel' : 'tarifa restrita'}</span></div>
      <div class="trace">${r.trace}</div>
      <button class="btn" onclick='selectOffer(${JSON.stringify(r).replaceAll("'", "&apos;")})'>Reservar esta opcao</button>
    </article>`).join('');
}

function dealToPrompt(deal) {
  return `Quero ${deal.nights} noites em ${deal.title}, ${deal.board}, para 2 adultos, ate ${Math.ceil(deal.price * 2.2)} euros, saida de ${deal.origin}.`;
}

async function loadDeals() {
  const target = $('#dealsGrid');
  if (!target) return;
  target.innerHTML = '<p class="muted">A carregar novidades...</p>';
  try {
    const data = await api('/api/deals');
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
  $('#checkoutPanel').hidden = false;
  $('#selectedOffer').innerHTML = `<b>${offer.hotel}</b><br>${offer.destination} - ${offer.board} - ${offer.nights} noites<br><b>Preco cliente:</b> ${money(offer.finalPrice)} - <b>Margem:</b> ${money(offer.marginValue)}<br><small>${offer.trace}</small>`;
  location.hash = '#checkoutPanel';
};

$('#searchForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#results').innerHTML = '<p>A pesquisar operadores, aplicar margens e gerar proposta...</p>';
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
  $('#adminReservations').innerHTML = data.latest.reservations.map(r => `
    <div class="mini-item">
      <b>${r.id}</b> - ${statusLabel(r.status)}<br>
      ${r.offer?.hotel || ''}<br>
      ${money(r.offer?.finalPrice)} - ${r.operator || ''}
      ${['IN_VALIDATION', 'HUMAN_REVIEW'].includes(r.status) ? `<br><button class="ghost mini-action" onclick="approveReservation('${r.id}')">Aprovar no operador</button>` : ''}
    </div>`).join('') || '<div class="mini-item">Sem reservas.</div>';
  $('#adminLeads').innerHTML = data.latest.leads.map(l => `<div class="mini-item"><b>${l.search.destination}</b> - ${statusLabel(l.status)}<br>${l.search.adults} adultos - orcamento ${money(l.search.budget)}</div>`).join('') || '<div class="mini-item">Sem leads.</div>';
  $('#adminMargins').innerHTML = data.margins.map(m => `<div class="mini-item"><b>${m.name}</b><br>${m.percent}% - minimo ${money(m.min)} - match: ${m.match}</div>`).join('');
  $('#adminEmails').innerHTML = data.latest.emails.map(e => `<div class="mini-item"><b>${e.subject}</b><br>Para: ${e.to}<br>${e.status}</div>`).join('') || '<div class="mini-item">Sem emails.</div>';
  $('#operatorLog').textContent = JSON.stringify({ operadores: data.operators, chamadas: data.latest.logs, auditoria: data.latest.audit }, null, 2);
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
