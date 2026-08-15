// Separador "Comunicações": cronologia de chamadas/emails/WhatsApp com o
// cliente desta oportunidade - mesmo padrao de customers/communicationsTab.js.
// direction/externalId/deliveryStatus (jah preparados no esquema) ficam
// prontos para uma integracao real de WhatsApp/email/chat interno mais
// tarde - por agora e so um registo manual.

import { esc, api } from '../../utils.js';

const CONTACT_TYPES = [
  { value: 'CALL', label: 'Chamada' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'IN_PERSON', label: 'Presencial' },
  { value: 'OTHER', label: 'Outro' }
];

function typeLabel(type) {
  return CONTACT_TYPES.find(t => t.value === type)?.label || type;
}

export function renderComunicacoesTab(panel, data, opportunityId, reload) {
  const communications = data.communications || [];
  panel.innerHTML = `
    <div class="contact-log-list">
      ${communications.map(c => `
        <div class="contact-log-item">
          <div class="contact-log-head">
            <span class="pill">${esc(typeLabel(c.type))}</span>
            <span class="muted small">${new Date(c.createdAt).toLocaleString('pt-PT')}${c.actor ? ` · ${esc(c.actor)}` : ''}</span>
          </div>
          <p>${esc(c.summary)}</p>
        </div>`).join('') || '<p class="empty-note">Ainda sem comunicações registadas.</p>'}
    </div>
    <form class="contact-log-form">
      <select name="type">${CONTACT_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}</select>
      <textarea name="summary" rows="2" placeholder="O que foi falado/combinado..." required></textarea>
      <button class="btn mini-action" type="submit">Registar comunicação</button>
      <p class="customer-form-message"></p>
    </form>`;

  panel.querySelector('.contact-log-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const msg = panel.querySelector('.customer-form-message');
    btn.disabled = true;
    btn.textContent = 'A guardar...';
    try {
      await api('/api/admin/customers/contact', {
        method: 'POST',
        body: JSON.stringify({ opportunityId, email: data.opportunity.customerEmail, type: e.target.type.value, summary: e.target.summary.value })
      });
      await reload();
    } catch (err) {
      msg.textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Registar comunicação';
    }
  });
}
