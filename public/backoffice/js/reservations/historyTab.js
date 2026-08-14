// Separador "Histórico": timeline da reserva - mudanças de estado, serviços
// adicionados/editados/removidos e documentos anexados ficam registados
// automaticamente pelas rotas correspondentes; atrasos, cancelamentos,
// contactos e notas livres são registados manualmente aqui pelo operador.

import { esc, api } from '../utils.js';

const AUTO_LABELS = {
  STATUS_CHANGE: 'Mudança de estado',
  SERVICE_ADDED: 'Serviço adicionado',
  SERVICE_UPDATED: 'Serviço atualizado',
  SERVICE_REMOVED: 'Serviço removido',
  DOCUMENT_UPLOADED: 'Documento anexado',
  DELAY: 'Atraso',
  CANCELLATION: 'Cancelamento',
  CONTACT: 'Contacto',
  NOTE: 'Nota'
};

const PILL_CLASS = { CANCELLATION: 'pill-warning', DELAY: 'pill-warning', SERVICE_REMOVED: 'pill-warning' };

export function renderHistoryTab(panel, reservation, reload, ctx = {}) {
  const services = ctx.services || {};
  const events = services.events || [];
  const eventTypes = services.eventTypes || [];

  panel.innerHTML = `
    <div class="contact-log-list">
      ${events.map(e => `
        <div class="contact-log-item">
          <div class="contact-log-head">
            <span class="pill ${PILL_CLASS[e.type] || ''}">${esc(AUTO_LABELS[e.type] || e.type)}</span>
            <span class="muted small">${new Date(e.createdAt).toLocaleString('pt-PT')}${e.actor ? ` · ${esc(e.actor)}` : ''}</span>
          </div>
          <p>${esc(e.description || '')}</p>
        </div>`).join('') || '<p class="empty-note">Ainda sem histórico registado nesta reserva.</p>'}
    </div>
    <form class="contact-log-form">
      <select name="type">
        ${eventTypes.map(t => `<option value="${t.value}">${esc(t.label)}</option>`).join('')}
      </select>
      <textarea name="description" rows="2" placeholder="O que aconteceu..." required></textarea>
      <button class="btn mini-action" type="submit">Registar</button>
      <p class="customer-form-message"></p>
    </form>`;

  panel.querySelector('.contact-log-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const msg = panel.querySelector('.customer-form-message');
    btn.disabled = true;
    btn.textContent = 'A guardar...';
    try {
      await api('/api/admin/reservations/events', {
        method: 'POST',
        body: JSON.stringify({ reservationId: reservation.id, type: e.target.type.value, description: e.target.description.value })
      });
      await reload();
    } catch (err) {
      msg.textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Registar';
    }
  });
}
