// Separador "Passageiros": lista dos passageiros da reserva (dados que ja
// existiam, nunca tinham tido uma vista propria fora do checkout).

import { esc } from '../utils.js';

const DOC_LABELS = { CC: 'Cartão de Cidadão', PASSPORT: 'Passaporte' };

export function renderPassengersTab(panel, reservation) {
  const passengers = reservation.passengers || [];
  if (!passengers.length) {
    panel.innerHTML = '<p class="empty-note">Sem passageiros registados.</p>';
    return;
  }
  panel.innerHTML = `
    <div class="passenger-table">
      ${passengers.map(p => `
        <div class="passenger-table-row">
          <div>
            <b>${esc(p.name || '')} ${esc(p.surname || '')}</b>
            <span class="muted small">${p.type === 'CHD' ? 'Criança' : 'Adulto'}${p.birthdate ? ` · ${esc(p.birthdate)}` : ''}${p.nationality ? ` · ${esc(p.nationality)}` : ''}</span>
          </div>
          <div class="muted small">${p.documentType ? `${DOC_LABELS[p.documentType] || esc(p.documentType)}${p.documentNumber ? ` ${esc(p.documentNumber)}` : ''}` : 'sem documento registado'}</div>
        </div>`).join('')}
    </div>`;
}
