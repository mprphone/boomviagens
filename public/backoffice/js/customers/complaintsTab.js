// Separador "Reclamações" da ficha do cliente - mesmo padrao do separador
// "Reclamações" da Ficha de Reserva (botao "+ Abrir reclamação" que abre
// uma gaveta lateral com o problema, a resolucao, o estado e os anexos),
// mas aqui a reclamacao pode (nao tem de) ficar associada a uma das
// reservas do cliente - ver o campo "Reserva associada" na gaveta.

import { esc, money, api } from '../utils.js';
import { openDrawer, closeDrawer } from '../drawer.js';

const DIRECTION_LABEL = { CUSTOMER_TO_AGENCY: 'Cliente → Agência', AGENCY_TO_SUPPLIER: 'Agência → Fornecedor' };
const CLOSED_STATUSES = new Set(['RESOLVED', 'CLOSED']);

export function renderComplaintsTab(panel, data, email, reload) {
  const complaints = data.complaints || [];
  const statuses = data.complaintStatuses || [];
  const directions = data.complaintDirections || ['CUSTOMER_TO_AGENCY', 'AGENCY_TO_SUPPLIER'];
  const suppliers = data.suppliers || [];
  const reservations = data.reservations || [];
  const statusLabel = v => statuses.find(s => s.value === v)?.label || v;
  const supplierName = supplierId => suppliers.find(s => s.id === supplierId)?.name || '';
  const reservationLabel = r => `${r.processNumber} · ${r.offer?.hotel || r.offer?.destination || ''}`;

  panel.innerHTML = `
    <div class="tab-toolbar">
      <button type="button" class="btn mini-action complaint-add">+ Abrir reclamação</button>
    </div>
    <div class="complaint-list">
      ${complaints.map(c => `
        <div class="complaint-item" data-complaint="${esc(c.id)}">
          <div class="complaint-head">
            <b>${esc(c.subject)}</b>
            <span class="pill">${DIRECTION_LABEL[c.direction] || ''}</span>
            <span class="pill ${CLOSED_STATUSES.has(c.status) ? 'pill-ok' : 'pill-warning'}">${esc(statusLabel(c.status))}</span>
          </div>
          <p class="muted small">${new Date(c.createdAt).toLocaleString('pt-PT')}${c.processNumber ? ` · ${esc(c.processNumber)}${c.hotel ? ` (${esc(c.hotel)})` : ''}` : ' · Sem reserva associada'}${c.supplierId ? ` · ${esc(supplierName(c.supplierId))}` : ''}</p>
          ${c.description ? `<p>${esc(c.description)}</p>` : ''}
          <div class="summary-financial-grid complaint-amounts">
            ${c.claimedAmount ? `<div class="summary-financial-block"><span class="muted small">Valor reclamado</span><strong>${money(c.claimedAmount)}</strong></div>` : ''}
            ${c.receivedAmount ? `<div class="summary-financial-block"><span class="muted small">Recebido do fornecedor</span><strong>${money(c.receivedAmount)}</strong></div>` : ''}
            ${c.paidToCustomer ? `<div class="summary-financial-block"><span class="muted small">Entregue ao cliente</span><strong>${money(c.paidToCustomer)}</strong></div>` : ''}
          </div>
          ${c.resolution ? `<p class="muted"><b>Resolução:</b> ${esc(c.resolution)}</p>` : ''}
        </div>`).join('') || '<p class="empty-note">Sem reclamações registadas.</p>'}
    </div>`;

  panel.querySelector('.complaint-add').onclick = () => openComplaintDrawer(null);
  panel.querySelectorAll('.complaint-item').forEach(item => {
    item.onclick = () => openComplaintDrawer(complaints.find(c => c.id === item.dataset.complaint));
  });

  function openComplaintDrawer(complaint) {
    const docs = complaint ? (data.complaintDocuments || []).filter(d => d.complaintId === complaint.id) : [];
    const body = openDrawer(complaint ? 'Editar reclamação' : 'Nova reclamação');

    body.innerHTML = `
      <form class="complaint-form">
        <div class="drawer-form-fields">
          <label>Direção
            <select name="direction" ${complaint ? 'disabled' : ''}>
              ${directions.map(d => `<option value="${d}" ${(complaint?.direction || 'CUSTOMER_TO_AGENCY') === d ? 'selected' : ''}>${DIRECTION_LABEL[d] || d}</option>`).join('')}
            </select>
          </label>
          <label class="complaint-supplier-field" hidden>Fornecedor
            <select name="supplierId" ${complaint ? 'disabled' : ''}>
              <option value="">Selecionar...</option>
              ${suppliers.map(s => `<option value="${esc(s.id)}" ${complaint?.supplierId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
            </select>
          </label>
          <label>Reserva associada
            <select name="reservationId" ${complaint ? 'disabled' : ''}>
              <option value="">Sem reserva associada</option>
              ${reservations.map(r => `<option value="${esc(r.id)}" ${complaint?.reservationId === r.id ? 'selected' : ''}>${esc(reservationLabel(r))}</option>`).join('')}
            </select>
          </label>
          <label>Assunto <input type="text" name="subject" required value="${esc(complaint?.subject || '')}" /></label>
          <label>Valor reclamado (€) <input type="number" name="claimedAmount" min="0" step="0.01" value="${complaint?.claimedAmount ?? ''}" /></label>
        </div>
        <label class="service-line-notes">Descrição do problema <textarea name="description" rows="3">${esc(complaint?.description || '')}</textarea></label>
        ${complaint ? `
          <div class="drawer-form-fields">
            <label>Estado
              <select name="status">${statuses.map(s => `<option value="${s.value}" ${s.value === complaint.status ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
            </label>
            <label>Valor recebido do fornecedor (€) <input type="number" name="receivedAmount" min="0" step="0.01" value="${complaint.receivedAmount ?? ''}" /></label>
            <label>Valor entregue ao cliente (€) <input type="number" name="paidToCustomer" min="0" step="0.01" value="${complaint.paidToCustomer ?? ''}" /></label>
          </div>
          <label class="service-line-notes">Resolução <textarea name="resolution" rows="3">${esc(complaint.resolution || '')}</textarea></label>` : ''}
        <div class="service-line-form-actions">
          <button class="btn mini-action" type="submit">${complaint ? 'Guardar alterações' : 'Abrir reclamação'}</button>
        </div>
        <p class="customer-form-message"></p>
      </form>
      <p class="summary-block-label">Anexos</p>
      ${complaint ? `
        <div class="doc-list">
          ${docs.map(d => `
            <div class="doc-item">
              <span class="muted">${esc(d.fileName)}</span>
              <a href="${esc(d.signedUrl)}" target="_blank" rel="noopener">Ver</a>
              <button class="ghost mini-action drawer-doc-delete" data-doc="${d.id}">Remover</button>
            </div>`).join('') || '<p class="empty-note">Sem anexos nesta reclamação.</p>'}
        </div>
        <form class="drawer-doc-form">
          <input type="file" class="drawer-doc-input" required>
          <button type="submit" class="ghost mini-action">Anexar</button>
        </form>` : '<p class="muted small">Guarde a reclamação primeiro para poder anexar documentos.</p>'}`;

    if (!complaint) {
      const directionSelect = body.querySelector('select[name=direction]');
      const supplierField = body.querySelector('.complaint-supplier-field');
      const toggleSupplierField = () => { supplierField.hidden = directionSelect.value !== 'AGENCY_TO_SUPPLIER'; };
      directionSelect.onchange = toggleSupplierField;
      toggleSupplierField();
    } else if (complaint.direction === 'AGENCY_TO_SUPPLIER') {
      body.querySelector('.complaint-supplier-field').hidden = false;
    }

    body.querySelector('.complaint-form').onsubmit = async ev => {
      ev.preventDefault();
      const f = ev.target;
      const btn = f.querySelector('button[type=submit]');
      const msg = body.querySelector('.customer-form-message');
      btn.disabled = true;
      try {
        if (complaint) {
          await api('/api/admin/customers/complaints/update', {
            method: 'POST',
            body: JSON.stringify({
              id: complaint.id, status: f.status.value, subject: f.subject.value, description: f.description.value,
              claimedAmount: f.claimedAmount.value || undefined, receivedAmount: f.receivedAmount.value || undefined,
              paidToCustomer: f.paidToCustomer.value || undefined, resolution: f.resolution.value
            })
          });
        } else {
          await api('/api/admin/customers/complaints', {
            method: 'POST',
            body: JSON.stringify({
              email, reservationId: f.reservationId.value || undefined, direction: f.direction.value,
              supplierId: f.direction.value === 'AGENCY_TO_SUPPLIER' ? f.supplierId.value : undefined,
              subject: f.subject.value, claimedAmount: f.claimedAmount.value || undefined, description: f.description.value
            })
          });
        }
        await reload();
        closeDrawer();
      } catch (err) {
        msg.textContent = err.message;
        btn.disabled = false;
      }
    };

    if (complaint) {
      body.querySelectorAll('.drawer-doc-delete').forEach(btn => {
        btn.onclick = async () => {
          if (!confirm('Remover este anexo?')) return;
          try {
            await api('/api/admin/documents/delete', { method: 'POST', body: JSON.stringify({ documentId: btn.dataset.doc }) });
            await reload();
            closeDrawer();
          } catch (err) { alert(err.message); }
        };
      });

      body.querySelector('.drawer-doc-form').onsubmit = async ev => {
        ev.preventDefault();
        const fileInput = body.querySelector('.drawer-doc-input');
        const file = fileInput.files[0];
        if (!file) return;
        const btn = ev.target.querySelector('button[type=submit]');
        btn.disabled = true;
        btn.textContent = 'A anexar...';
        try {
          const fileBase64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          await api('/api/admin/documents/upload', {
            method: 'POST',
            body: JSON.stringify({
              reservationId: complaint.reservationId || undefined,
              customerEmail: email,
              complaintId: complaint.id,
              type: 'OTHER', fileName: file.name, mimeType: file.type, fileBase64
            })
          });
          await reload();
          closeDrawer();
        } catch (err) {
          alert(err.message);
          btn.disabled = false;
          btn.textContent = 'Anexar';
        }
      };
    }
  }
}
