// Vista "Dashboard": a proxima viagem confirmada (se existir), chips de
// estado, itinerario (so o que reservamos de verdade - alojamento) e o
// resumo do pagamento dessa reserva. Tudo derivado de dados reais de
// /api/customer/reservations - sem voo/transfer/clima/seguro inventados.

import { $, esc, money, dateRange, daysUntil, statusLabel, api } from './utils.js';

function pickNextTrip(reservations) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return reservations
    .filter(r => r.status === 'CONFIRMED' && r.offer?.checkin && new Date(`${r.offer.checkin}T00:00:00`) >= today)
    .sort((a, b) => new Date(a.offer.checkin) - new Date(b.offer.checkin))[0] || null;
}

function renderNextTrip(trip) {
  if (!trip) {
    return `
      <div class="empty-trip">
        <h3>Ainda não tem viagens confirmadas</h3>
        <p class="muted">Assim que uma reserva sua for confirmada pela nossa equipa, aparece aqui.</p>
        <a class="btn" href="/">Pesquisar viagens</a>
      </div>`;
  }
  const offer = trip.offer;
  const days = daysUntil(offer.checkin);
  const countdown = days == null ? '' : days === 0 ? 'É hoje!' : days === 1 ? 'Falta 1 dia' : `Faltam ${days} dias`;
  return `
    <div class="next-trip">
      <span class="next-trip-badge">Próxima viagem</span>
      <h2>${esc(offer.destination)}${offer.country ? `, ${esc(offer.country)}` : ''}</h2>
      <p class="next-trip-dates">📅 ${dateRange(offer.checkin, offer.checkout)} (${offer.nights} noites)</p>
      <p class="next-trip-countdown">${countdown}</p>
      <div class="next-trip-actions">
        <button type="button" class="btn" data-goto="viagens">Ver detalhes da viagem</button>
      </div>
    </div>`;
}

function renderStatusChips(trip) {
  if (!trip) return '';
  const missing = trip.missingDocuments || [];
  return `
    <div class="status-chip-row">
      <div class="status-chip">
        <div class="status-chip-icon ok">✅</div>
        <div><div class="status-chip-title">Reserva confirmada</div><div class="status-chip-sub">${esc(trip.id)}</div></div>
      </div>
      <div class="status-chip">
        <div class="status-chip-icon ${missing.length ? 'warn' : 'ok'}">${missing.length ? '⚠️' : '📄'}</div>
        <div><div class="status-chip-title">Documentos</div><div class="status-chip-sub">${missing.length ? `${missing.length} em falta` : 'Tudo entregue'}</div></div>
      </div>
      ${trip.payment ? `
      <div class="status-chip">
        <div class="status-chip-icon ${trip.payment.status === 'PAID' ? 'ok' : 'warn'}">💳</div>
        <div><div class="status-chip-title">Pagamento</div><div class="status-chip-sub">${trip.payment.status === 'PAID' ? 'Pago' : 'Pendente'}</div></div>
      </div>` : ''}
    </div>`;
}

function renderItinerary(trip) {
  if (!trip) return '';
  const offer = trip.offer;
  return `
    <div class="panel">
      <div class="panel-head"><h2>Detalhes da viagem</h2></div>
      <div class="itinerary-list">
        <div class="itinerary-item">
          <div class="itinerary-icon">🏨</div>
          <div class="itinerary-body">
            <b>${esc(offer.hotel)}</b>
            <span>${dateRange(offer.checkin, offer.checkout)} · ${esc(offer.board)}</span>
          </div>
          <span class="pill ok">Confirmado</span>
        </div>
      </div>
      <div class="itinerary-note">
        ✈️ Ainda não reservamos voos neste site - só alojamento através dos nossos operadores. Se precisar de voo para esta viagem, contacte a nossa equipa separadamente.
      </div>
    </div>`;
}

function renderPayment(trip) {
  if (!trip?.payment) return '';
  const p = trip.payment;
  return `
    <div class="panel">
      <div class="panel-head"><h2>Pagamento</h2></div>
      <div class="payment-row">
        <div class="payment-row-main"><b>${esc(p.method)}</b><span>Referência ${esc(p.reference)}</span></div>
        <div class="payment-row-side"><strong>${money(p.amount)}</strong><span class="pill ${p.status === 'PAID' ? 'ok' : 'warn'}">${p.status === 'PAID' ? 'Pago' : 'Pendente'}</span></div>
      </div>
    </div>`;
}

export async function renderDashboard() {
  const el = $('#view-dashboard');
  el.innerHTML = '<p class="muted">A carregar...</p>';
  let data;
  try {
    data = await api('/api/customer/reservations');
  } catch (err) {
    el.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }
  const trip = pickNextTrip(data.reservations);
  el.innerHTML = `
    ${renderNextTrip(trip)}
    ${renderStatusChips(trip)}
    ${renderItinerary(trip)}
    ${renderPayment(trip)}`;

  el.querySelectorAll('[data-goto]').forEach(btn => {
    btn.addEventListener('click', () => document.querySelector(`.nav-item[data-view="${btn.dataset.goto}"]`)?.click());
  });
}
