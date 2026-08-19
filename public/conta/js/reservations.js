// Vistas "As minhas viagens" (reservas ainda ativas) e "Reservas
// anteriores" (canceladas ou com checkin ja passado) - a mesma lista de
// /api/customer/reservations, so filtrada por data/estado real.

import { $, esc, money, dateRange, statusLabel, api, notify } from './utils.js';
import { openTripDetail } from './tripDetail.js';

function isPast(reservation) {
  if (reservation.status === 'CANCELLED') return true;
  if (reservation.status === 'CONFIRMED' && reservation.offer?.checkout) {
    return new Date(`${reservation.offer.checkout}T00:00:00`) < new Date();
  }
  return false;
}

function tripCard(r) {
  const offer = r.offer || {};
  const needsPayment = r.payment && r.payment.status !== 'PAID';
  return `
    <article class="trip-card" data-reservation="${esc(r.id)}" data-needs-payment="${needsPayment ? '1' : ''}">
      <div class="trip-card-media" aria-hidden="true">HT</div>
      <div class="trip-card-body">
        <b>${esc(offer.hotel || 'Reserva')}</b>
        <span>${esc(offer.destination || '')}${offer.country ? `, ${esc(offer.country)}` : ''}</span>
        <span class="trip-dates">${dateRange(offer.checkin, offer.checkout) || 'Datas a confirmar'}</span>
      </div>
      <div class="trip-card-side">
        <span class="pill ${r.status === 'CONFIRMED' ? 'ok' : r.status === 'CANCELLED' ? 'bad' : 'info'}">${esc(statusLabel(r.status))}</span>
        <strong>${money(offer.finalPrice)}</strong>
        ${needsPayment ? '<button class="btn mini-action resume-trip">Rever e continuar</button>' : ''}
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

  el.querySelectorAll('.trip-card[data-reservation]').forEach(card => {
    // O cartao abre sempre a reserva guardada. So o botao explicito tenta
    // revalidar a tarifa e retomar o checkout/pagamento.
    card.onclick = () => openTripDetail(card.dataset.reservation);
    card.querySelector('.resume-trip')?.addEventListener('click', event => {
      event.stopPropagation();
      if (event.currentTarget.dataset.searchAgain === '1') location.href = '/';
      else resumeReservation(card);
    });
  });
}

async function resumeReservation(card) {
  if (card.dataset.resuming === '1') return;
  card.dataset.resuming = '1';
  const button = card.querySelector('.resume-trip');
  return resumeReservationById(card.dataset.reservation, button, () => { card.dataset.resuming = '0'; });
}

export async function resumeReservationById(reservationId, button, onFailure = () => {}) {
  if (button) { button.disabled = true; button.textContent = 'A validar preço e disponibilidade…'; }
  try {
    const data = await api('/api/customer/reservations/resume', { method: 'POST', body: JSON.stringify({ reservationId }) });
    sessionStorage.setItem('boom_resume_offer_v1', JSON.stringify({ reservationId, offer: data.offer, resume: data.resume, savedAt: Date.now() }));
    location.href = `/?resumeReservation=${encodeURIComponent(reservationId)}`;
  } catch (err) {
    onFailure();
    if (['DUFFEL_OFFER_EXPIRED', 'HBX_RATE_UNAVAILABLE', 'SUPPLIER_UNAVAILABLE'].includes(err.code) && err.data?.search) {
      if (button) { button.disabled = true; button.textContent = 'A procurar alternativas…'; }
      try {
        const alternatives = await api('/api/search', { method: 'POST', body: JSON.stringify(err.data.search) });
        sessionStorage.setItem('boom_reservation_alternatives_v1', JSON.stringify({ reservationId, data: alternatives, savedAt: Date.now() }));
        location.href = `/?alternativesFor=${encodeURIComponent(reservationId)}`;
        return;
      } catch (searchError) {
        notify(`A oferta anterior terminou e não foi possível procurar alternativas agora: ${searchError.message}`);
      }
    } else notify(err.message);
    if (button) {
      button.disabled = false;
      if (['DUFFEL_OFFER_EXPIRED', 'HBX_RATE_UNAVAILABLE', 'SUPPLIER_UNAVAILABLE'].includes(err.code)) {
        button.dataset.searchAgain = '1';
        button.textContent = 'Pesquisar nova oferta';
      } else button.textContent = 'Rever e continuar';
    }
  }
}

export function renderViagens() {
  return renderList('#view-viagens', r => !isPast(r), 'Ainda não tem viagens em curso.');
}

export function renderAnteriores() {
  return renderList('#view-anteriores', isPast, 'Ainda não tem reservas anteriores.');
}
