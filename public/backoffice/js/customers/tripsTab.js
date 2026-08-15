// Separador "Viagens": todas as reservas do cliente numa tabela (processo,
// destino, datas, passageiros, valor, estado, margem, ocorrencias) - clicar
// numa linha abre o processo completo (ver reservations.js#openReservationPage).

import { esc, money } from '../utils.js';
import { openReservationPage } from '../reservations.js';

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
  const reservations = data.reservations || [];
  if (!reservations.length) {
    panel.innerHTML = '<p class="empty-note">Ainda sem viagens.</p>';
    return;
  }

  panel.innerHTML = `
    <div class="bo-table-wrap">
      <table class="bo-table">
        <thead>
          <tr>
            <th>Processo</th><th>Destino</th><th>Datas</th><th>Passageiros</th>
            <th>Valor</th><th>Estado</th><th>Margem</th><th>Ocorrências</th>
          </tr>
        </thead>
        <tbody>
          ${reservations.map(r => {
            const offer = r.offer || {};
            const paxCount = (offer.adults || 0) + (offer.children || 0);
            const paxNames = (r.passengers || []).map(p => p.name).filter(Boolean);
            return `
            <tr data-reservation="${esc(r.id)}">
              <td><b>${esc(r.processNumber)}</b></td>
              <td>${esc(offer.destination || '')}<div class="muted small">${esc(offer.hotel || '')}</div></td>
              <td class="muted small">${esc(offer.checkin || '')} → ${esc(offer.checkout || '')}</td>
              <td title="${esc(paxNames.join(', '))}">${paxCount || '—'}</td>
              <td>${money(offer.finalPrice)}</td>
              <td><span class="pill">${esc(statusLabel(r.status))}</span></td>
              <td>${money(r.margin)} <span class="muted small">(${(r.marginPercent || 0).toFixed(1)}%)</span></td>
              <td>${r.occurrencesCount ? `<span class="pill pill-warning">${r.occurrencesCount}</span>` : '—'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

  panel.querySelectorAll('tbody tr').forEach(row => {
    row.onclick = () => openReservationPage(row.dataset.reservation);
  });
}
