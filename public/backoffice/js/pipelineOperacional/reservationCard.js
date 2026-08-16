// Cartao de uma reserva no quadro do Pipeline Operacional (secao "Cartao
// do Pipeline Operacional") - processo, cliente, destino, datas,
// passageiros, responsavel operacional, por receber, documentacao e
// alertas, para o colaborador perceber o que falta sem abrir o processo.

import { esc, money } from '../utils.js';

function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(`${dateStr}T00:00:00`) - new Date()) / (1000 * 60 * 60 * 24));
}

export function renderReservationCard(r, staffById) {
  const staff = staffById.get(r.operationalStaffId);
  const offer = r.offer || {};
  const paxCount = (offer.adults || 0) + (offer.children || 0);
  const daysToDeparture = daysUntil(offer.checkin);

  const card = document.createElement('div');
  card.className = 'pipeline-card reservation-card';
  card.draggable = true;
  card.dataset.id = r.id;
  card.innerHTML = `
    <div class="pipeline-card-name">${esc(r.processNumber)}</div>
    <div class="pipeline-card-dest">${esc(r.customer?.name || '')}</div>
    <div class="pipeline-card-dates">${esc(offer.destination || '')}${offer.checkin ? ` · ${esc(offer.checkin)} → ${esc(offer.checkout || '')}` : ''} · ${paxCount} pax</div>
    <div class="pipeline-card-value">
      <strong>${r.dueAmount ? `Por receber ${money(r.dueAmount)}` : 'Pago'}</strong>
    </div>
    <div class="pipeline-card-foot">
      <span class="pipeline-card-staff">${staff ? `<span class="staff-color-dot" style="background:${esc(staff.color || '#94a3b8')}"></span>${esc(staff.name)}` : 'Sem responsável'}</span>
      ${daysToDeparture !== null ? `<span>✈ ${daysToDeparture >= 0 ? `${daysToDeparture}d` : 'já viajou'}</span>` : ''}
    </div>
    <div class="pipeline-card-warnings">
      ${r.missingDocuments?.length ? `<div>📄 Documentação incompleta</div>` : ''}
      ${r.openComplaintsCount ? `<div>⚠ ${r.openComplaintsCount} reclamação(ões)</div>` : ''}
    </div>`;

  return card;
}
