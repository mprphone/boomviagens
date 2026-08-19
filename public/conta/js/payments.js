// Vista "Pagamentos": o pagamento real de cada reserva (uma so por
// reserva, tal como o checkout ja funciona hoje - nao inventa um plano
// de sinal/2 prestacoes/saldo que o sistema nao tem).

import { $, esc, money, api } from './utils.js';
import { resumeReservationById } from './reservations.js';

export async function renderPagamentos() {
  const el = $('#view-pagamentos');
  el.innerHTML = '<p class="muted">A carregar...</p>';
  let data;
  try {
    data = await api('/api/customer/reservations');
  } catch (err) {
    el.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }
  const withPayment = data.reservations.filter(r => r.payment);
  if (!withPayment.length) {
    el.innerHTML = '<p class="empty-note">Ainda não tem pagamentos registados.</p>';
    return;
  }
  el.innerHTML = `
    <div class="panel">
      ${withPayment.map(r => `
        <div class="payment-row">
          <div class="payment-row-main">
            <b>${esc(r.offer?.hotel || r.id)}</b>
            <span>${esc(r.offer?.destination || '')} · ${esc(r.payment.method)} · ref. ${esc(r.payment.reference)}</span>
          </div>
          <div class="payment-row-side">
            <strong>${money(r.payment.amount)}</strong>
            <span class="pill ${r.payment.status === 'PAID' ? 'ok' : 'warn'}">${r.payment.status === 'PAID' ? 'Pago' : 'Pendente'}</span>
            ${r.payment.status !== 'PAID' ? `<button class="ghost mini-action pay-now" data-reservation="${esc(r.id)}">Rever e continuar</button>` : ''}
          </div>
        </div>`).join('')}
    </div>`;

  el.querySelectorAll('.pay-now').forEach(btn => {
    btn.onclick = () => resumeReservationById(btn.dataset.reservation, btn);
  });
}
