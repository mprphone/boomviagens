// Separador "Reclamações": duas direcoes possiveis - o cliente reclama a
// agencia (direction=CUSTOMER_TO_AGENCY), ou a agencia reclama a um
// fornecedor/operador (direction=AGENCY_TO_SUPPLIER, com valor reclamado/
// recebido do fornecedor/entregue ao cliente). Cada reclamacao funciona
// como um pequeno processo dentro do processo da viagem, com o seu proprio
// estado ate ao encerramento.

import { esc, money, api } from '../utils.js';

const DIRECTION_LABEL = { CUSTOMER_TO_AGENCY: 'Cliente → Agência', AGENCY_TO_SUPPLIER: 'Agência → Fornecedor' };
const CLOSED_STATUSES = new Set(['RESOLVED', 'CLOSED']);

export function renderComplaintsTab(panel, reservation, reload, data = {}) {
  const complaints = data.complaints || [];
  const statuses = data.complaintStatuses || [];
  const directions = data.complaintDirections || ['CUSTOMER_TO_AGENCY', 'AGENCY_TO_SUPPLIER'];
  const suppliers = data.suppliers || [];
  const statusLabel = v => statuses.find(s => s.value === v)?.label || v;
  const supplierName = supplierId => suppliers.find(s => s.id === supplierId)?.name || '';

  panel.innerHTML = `
    <div class="complaint-list">
      ${complaints.map(c => `
        <div class="complaint-item">
          <div class="complaint-head">
            <b>${esc(c.subject)}</b>
            <span class="pill">${DIRECTION_LABEL[c.direction] || ''}</span>
            <span class="pill ${CLOSED_STATUSES.has(c.status) ? 'pill-ok' : 'pill-warning'}">${esc(statusLabel(c.status))}</span>
          </div>
          <p class="muted small">${new Date(c.createdAt).toLocaleString('pt-PT')}${c.supplierId ? ` · ${esc(supplierName(c.supplierId))}` : ''}</p>
          ${c.description ? `<p>${esc(c.description)}</p>` : ''}
          <div class="summary-financial-grid complaint-amounts">
            ${c.claimedAmount ? `<div class="summary-financial-block"><span class="muted small">Valor reclamado</span><strong>${money(c.claimedAmount)}</strong></div>` : ''}
            ${c.receivedAmount ? `<div class="summary-financial-block"><span class="muted small">Recebido do fornecedor</span><strong>${money(c.receivedAmount)}</strong></div>` : ''}
            ${c.paidToCustomer ? `<div class="summary-financial-block"><span class="muted small">Entregue ao cliente</span><strong>${money(c.paidToCustomer)}</strong></div>` : ''}
          </div>
          ${c.resolution ? `<p class="muted"><b>Resolução:</b> ${esc(c.resolution)}</p>` : ''}
          ${!CLOSED_STATUSES.has(c.status) ? `
            <div class="complaint-actions">
              <select class="complaint-status-select" data-id="${c.id}">
                ${statuses.map(s => `<option value="${s.value}" ${s.value === c.status ? 'selected' : ''}>${s.label}</option>`).join('')}
              </select>
              <input type="text" class="complaint-received-input" data-id="${c.id}" placeholder="Valor recebido do fornecedor (€)" />
              <input type="text" class="complaint-paid-input" data-id="${c.id}" placeholder="Valor entregue ao cliente (€)" />
              <input type="text" class="complaint-resolution-input" data-id="${c.id}" placeholder="Nota de resolução (opcional)" />
              <button class="ghost mini-action complaint-save" data-id="${c.id}">Guardar</button>
            </div>` : ''}
        </div>`).join('') || '<p class="empty-note">Sem reclamações registadas neste processo.</p>'}
    </div>
    <form class="complaint-form">
      <p class="service-line-form-title">Abrir reclamação</p>
      <div class="customer-profile-grid">
        <label>Direção
          <select name="direction">
            ${directions.map(d => `<option value="${d}">${DIRECTION_LABEL[d] || d}</option>`).join('')}
          </select>
        </label>
        <label class="complaint-supplier-field" hidden>Fornecedor
          <select name="supplierId">
            <option value="">Selecionar...</option>
            ${suppliers.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}
          </select>
        </label>
        <label>Assunto <input type="text" name="subject" required /></label>
        <label>Valor reclamado (€) <input type="number" name="claimedAmount" min="0" step="0.01" /></label>
      </div>
      <textarea name="description" rows="2" placeholder="Descrição do problema..."></textarea>
      <button class="btn mini-action" type="submit">Abrir reclamação</button>
      <p class="customer-form-message"></p>
    </form>`;

  const directionSelect = panel.querySelector('select[name=direction]');
  const supplierField = panel.querySelector('.complaint-supplier-field');
  const toggleSupplierField = () => { supplierField.hidden = directionSelect.value !== 'AGENCY_TO_SUPPLIER'; };
  directionSelect.onchange = toggleSupplierField;
  toggleSupplierField();

  panel.querySelectorAll('.complaint-save').forEach(btn => {
    btn.onclick = async () => {
      const row = btn.closest('.complaint-item');
      const status = row.querySelector('.complaint-status-select').value;
      const resolution = row.querySelector('.complaint-resolution-input').value;
      const receivedAmount = row.querySelector('.complaint-received-input').value;
      const paidToCustomer = row.querySelector('.complaint-paid-input').value;
      btn.disabled = true;
      btn.textContent = 'A guardar...';
      try {
        await api('/api/admin/customers/complaints/update', {
          method: 'POST',
          body: JSON.stringify({ id: btn.dataset.id, status, resolution, receivedAmount: receivedAmount || undefined, paidToCustomer: paidToCustomer || undefined })
        });
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
    const f = e.target;
    const btn = f.querySelector('button[type="submit"]');
    const msg = panel.querySelector('.customer-form-message');
    btn.disabled = true;
    btn.textContent = 'A abrir...';
    try {
      await api('/api/admin/customers/complaints', {
        method: 'POST',
        body: JSON.stringify({
          email: reservation.customer?.email,
          reservationId: reservation.id,
          direction: f.direction.value,
          supplierId: f.direction.value === 'AGENCY_TO_SUPPLIER' ? f.supplierId.value : undefined,
          subject: f.subject.value,
          claimedAmount: f.claimedAmount.value || undefined,
          description: f.description.value
        })
      });
      await reload();
    } catch (err) {
      msg.textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Abrir reclamação';
    }
  });
}
