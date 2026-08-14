// Separador "Reclamações": abrir e acompanhar reclamacoes do cliente ate
// resolucao. Sem workflow complicado - so o estado e uma nota de resolucao.

import { esc, api } from '../utils.js';

const STATUSES = [
  { value: 'OPEN', label: 'Aberta', pillClass: 'pill-warning' },
  { value: 'IN_PROGRESS', label: 'Em curso', pillClass: '' },
  { value: 'RESOLVED', label: 'Resolvida', pillClass: 'pill-ok' }
];

function statusMeta(status) {
  return STATUSES.find(s => s.value === status) || STATUSES[0];
}

export function renderComplaintsTab(panel, data, email, reload) {
  panel.innerHTML = `
    <div class="complaint-list">
      ${data.complaints.map(c => {
        const meta = statusMeta(c.status);
        return `
        <div class="complaint-item">
          <div class="complaint-head">
            <b>${esc(c.subject)}</b>
            <span class="pill ${meta.pillClass}">${meta.label}</span>
          </div>
          <p class="muted small">${new Date(c.createdAt).toLocaleString('pt-PT')}${c.reservationId ? ` · ${esc(c.reservationId)}` : ''}</p>
          ${c.description ? `<p>${esc(c.description)}</p>` : ''}
          ${c.resolution ? `<p class="muted"><b>Resolução:</b> ${esc(c.resolution)}</p>` : ''}
          ${c.status !== 'RESOLVED' ? `
            <div class="complaint-actions">
              <select class="complaint-status-select" data-id="${c.id}">
                ${STATUSES.map(s => `<option value="${s.value}" ${s.value === c.status ? 'selected' : ''}>${s.label}</option>`).join('')}
              </select>
              <input type="text" class="complaint-resolution-input" placeholder="Nota de resolução (opcional)" />
              <button class="ghost mini-action complaint-save" data-id="${c.id}">Guardar</button>
            </div>` : ''}
        </div>`;
      }).join('') || '<p class="empty-note">Sem reclamações registadas.</p>'}
    </div>
    <form class="complaint-form">
      <input type="text" name="subject" placeholder="Assunto" required />
      <textarea name="description" rows="2" placeholder="Descrição..."></textarea>
      <button class="btn mini-action" type="submit">Abrir reclamação</button>
      <p class="customer-form-message"></p>
    </form>`;

  panel.querySelectorAll('.complaint-save').forEach(btn => {
    btn.onclick = async () => {
      const row = btn.closest('.complaint-item');
      const status = row.querySelector('.complaint-status-select').value;
      const resolution = row.querySelector('.complaint-resolution-input').value;
      btn.disabled = true;
      btn.textContent = 'A guardar...';
      try {
        await api('/api/admin/customers/complaints/update', { method: 'POST', body: JSON.stringify({ id: btn.dataset.id, status, resolution }) });
        await reload();
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
        btn.textContent = 'Guardar';
      }
    };
  });

  panel.querySelector('.complaint-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const msg = panel.querySelector('.customer-form-message');
    btn.disabled = true;
    btn.textContent = 'A abrir...';
    try {
      await api('/api/admin/customers/complaints', {
        method: 'POST',
        body: JSON.stringify({ email, subject: e.target.subject.value, description: e.target.description.value })
      });
      await reload();
    } catch (err) {
      msg.textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Abrir reclamação';
    }
  });
}
