// Separador "Ocorrências": leitura filtrada do historico (ver
// ./historyTab.js) so com os tipos "de ocorrencia" - informacao, alteracao,
// problema, incidente, atraso, servico nao prestado, erro do
// fornecedor/interno, pedido do cliente. Cada ocorrencia tem um estado de
// resolucao proprio, para acompanhar problemas ate ao fecho sem nunca
// editar/apagar o registo original (fica sempre visivel no Histórico).

import { esc, api } from '../utils.js';

const OCCURRENCE_TYPES = [
  { value: 'INFO', label: 'Informação' },
  { value: 'CHANGE', label: 'Alteração' },
  { value: 'PROBLEM', label: 'Problema' },
  { value: 'INCIDENT', label: 'Incidente' },
  { value: 'DELAY', label: 'Atraso' },
  { value: 'SERVICE_NOT_RENDERED', label: 'Serviço não prestado' },
  { value: 'SUPPLIER_ERROR', label: 'Erro do fornecedor' },
  { value: 'INTERNAL_ERROR', label: 'Erro interno' },
  { value: 'CUSTOMER_REQUEST', label: 'Pedido do cliente' },
  { value: 'OTHER', label: 'Outro' }
];
const OCCURRENCE_TYPE_VALUES = new Set(OCCURRENCE_TYPES.map(t => t.value));
const NEEDS_RESOLUTION = new Set(['PROBLEM', 'INCIDENT', 'SERVICE_NOT_RENDERED', 'SUPPLIER_ERROR', 'INTERNAL_ERROR']);

function typeLabel(type) {
  return OCCURRENCE_TYPES.find(t => t.value === type)?.label || type;
}

export function renderOccurrencesTab(panel, reservation, reload, data = {}) {
  const occurrences = (data.events || []).filter(e => OCCURRENCE_TYPE_VALUES.has(e.type));

  panel.innerHTML = `
    <div class="contact-log-list">
      ${occurrences.map(o => `
        <div class="contact-log-item">
          <div class="contact-log-head">
            <span class="pill ${o.type === 'PROBLEM' || o.type === 'INCIDENT' ? 'pill-warning' : ''}">${esc(typeLabel(o.type))}</span>
            <span class="muted small">${new Date(o.createdAt).toLocaleString('pt-PT')}${o.actor ? ` · ${esc(o.actor)}` : ''}</span>
            ${NEEDS_RESOLUTION.has(o.type) ? `<span class="pill ${o.resolved ? 'pill-ok' : 'pill-warning'}">${o.resolved ? 'Resolvido' : 'Por resolver'}</span>` : ''}
          </div>
          <p>${esc(o.description)}</p>
          ${o.resolution ? `<p class="muted"><b>Resolução:</b> ${esc(o.resolution)}</p>` : ''}
          ${NEEDS_RESOLUTION.has(o.type) && !o.resolved ? `
            <div class="complaint-actions">
              <input type="text" class="occurrence-resolution-input" data-event="${esc(o.id)}" placeholder="Nota de resolução (opcional)" />
              <button type="button" class="ghost mini-action occurrence-resolve" data-event="${esc(o.id)}">Marcar resolvido</button>
            </div>` : ''}
        </div>`).join('') || '<p class="empty-note">Sem ocorrências registadas neste processo.</p>'}
    </div>
    <form class="occurrence-form">
      <select name="type">
        ${OCCURRENCE_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}
      </select>
      <textarea name="description" rows="2" placeholder="O que aconteceu..." required></textarea>
      <button class="btn mini-action" type="submit">Registar ocorrência</button>
      <p class="customer-form-message"></p>
    </form>`;

  panel.querySelectorAll('.occurrence-resolve').forEach(btn => {
    btn.onclick = async () => {
      const input = panel.querySelector(`.occurrence-resolution-input[data-event="${btn.dataset.event}"]`);
      btn.disabled = true;
      try {
        await api('/api/admin/reservations/events/resolve', { method: 'POST', body: JSON.stringify({ id: btn.dataset.event, resolved: true, resolution: input.value }) });
        await reload();
      } catch (err) { alert(err.message); btn.disabled = false; }
    };
  });

  panel.querySelector('.occurrence-form').addEventListener('submit', async e => {
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
      btn.textContent = 'Registar ocorrência';
    }
  });
}
