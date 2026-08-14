// Separador "Viagens": historico de reservas do cliente (dados que ja
// existiam, so nunca tinham sido mostrados na ficha - so a contagem).

import { esc, money } from '../utils.js';

function statusLabel(status) {
  return ({
    NEW_LEAD: 'Nova lead',
    PROPOSAL_SENT: 'Proposta enviada',
    PENDING_PAYMENT: 'Em pagamento',
    PAYMENT_RECEIVED: 'Pagamento recebido',
    IN_VALIDATION: 'Em validação',
    CONFIRMED: 'Confirmada',
    CANCELLED: 'Cancelada',
    OPERATOR_ERROR: 'Erro no operador',
    HUMAN_REVIEW: 'Pendente de intervenção humana'
  })[status] || status;
}

export function renderTripsTab(panel, data) {
  if (!data.reservations.length) {
    panel.innerHTML = '<p class="empty-note">Ainda sem reservas.</p>';
    return;
  }
  panel.innerHTML = `
    <div class="customer-trip-list">
      ${data.reservations.map(r => `
        <div class="customer-trip-row">
          <div>
            <b>${esc(r.offer?.hotel || r.id)}</b>
            <span class="muted">${esc(r.offer?.destination || '')}</span>
            <div class="muted small">${esc(r.id)} · criada em ${new Date(r.createdAt).toLocaleDateString('pt-PT')}</div>
          </div>
          <div class="customer-trip-side">
            <span class="pill">${esc(statusLabel(r.status))}</span>
            <strong>${money(r.offer?.finalPrice)}</strong>
            ${r.payment ? `<span class="muted small">${r.payment.status === 'PAID' ? 'Pago' : 'Pagamento pendente'}</span>` : ''}
          </div>
        </div>`).join('')}
    </div>`;
}
