// Separador "Histórico": timeline imutável da oportunidade (criação,
// mudanças de fase, propostas, conversão em processo...) - so consulta,
// mesmo padrao de reservations/historyTab.js.

import { esc } from '../../utils.js';

const EVENT_LABELS = {
  CREATED: 'Oportunidade criada', UPDATED: 'Dados atualizados', STAGE_CHANGE: 'Mudança de fase',
  PROPOSAL_CREATED: 'Proposta criada', PROPOSAL_UPDATED: 'Proposta atualizada', CONVERTED: 'Convertida em processo'
};

export function renderHistoricoTab(panel, data = {}) {
  const events = data.events || [];
  panel.innerHTML = `
    <div class="contact-log-list">
      ${events.map(e => `
        <div class="contact-log-item">
          <div class="contact-log-head">
            <span class="pill">${esc(EVENT_LABELS[e.type] || e.type)}</span>
            <span class="muted small">${new Date(e.createdAt).toLocaleString('pt-PT')}${e.actor ? ` · ${esc(e.actor)}` : ''}</span>
          </div>
          <p>${esc(e.description || '')}</p>
        </div>`).join('') || '<p class="empty-note">Ainda sem histórico registado.</p>'}
    </div>`;
}
