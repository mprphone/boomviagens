// Vistas "As minhas viagens" (reservas ainda ativas) e "Reservas
// anteriores" (canceladas ou com checkin ja passado) - a mesma lista de
// /api/customer/reservations, so filtrada por data/estado real.

import { $, esc, money, dateRange, statusLabel, api } from './utils.js';

function isPast(reservation) {
  if (reservation.status === 'CANCELLED') return true;
  if (reservation.status === 'CONFIRMED' && reservation.offer?.checkout) {
    return new Date(`${reservation.offer.checkout}T00:00:00`) < new Date();
  }
  return false;
}

function tripCard(r) {
  const offer = r.offer || {};
  return `
    <article class="trip-card">
      <div class="trip-card-media" aria-hidden="true">🏨</div>
      <div class="trip-card-body">
        <b>${esc(offer.hotel || 'Reserva')}</b>
        <span>${esc(offer.destination || '')}${offer.country ? `, ${esc(offer.country)}` : ''}</span>
        <span class="trip-dates">${dateRange(offer.checkin, offer.checkout) || 'Datas a confirmar'}</span>
      </div>
      <div class="trip-card-side">
        <span class="pill ${r.status === 'CONFIRMED' ? 'ok' : r.status === 'CANCELLED' ? 'bad' : 'info'}">${esc(statusLabel(r.status))}</span>
        <strong>${money(offer.finalPrice)}</strong>
      </div>
    </article>`;
}

async function renderList(elId, filterFn, emptyMessage) {
  const el = $(elId);
  el.innerHTML = '<p class="muted">A carregar...</p>';
  let data;
  try {
    data = await api('/api/customer/reservations');
  } catch (err) {
    el.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }
  const list = data.reservations.filter(filterFn);
  el.innerHTML = `<div class="trip-list">${list.map(tripCard).join('') || `<p class="empty-note">${emptyMessage}</p>`}</div>`;
}

export function renderViagens() {
  return renderList('#view-viagens', r => !isPast(r), 'Ainda não tem viagens em curso.');
}

export function renderAnteriores() {
  return renderList('#view-anteriores', isPast, 'Ainda não tem reservas anteriores.');
}
