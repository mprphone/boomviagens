// Gaveta lateral de uma reserva individual (separador "Reservas") -
// localizador, fornecedor, datas, custo, estado, condicoes de
// cancelamento e os documentos anexados especificamente a esta reserva
// (voucher, bilhete...). Comeca em modo de leitura; "Editar" muda para o
// formulario completo.

import { esc, money, api } from '../utils.js';
import { openDrawer, closeDrawer } from '../drawer.js';
import { lineTotal } from './serviceCalc.js';

export function openLineDrawer(reservation, line, data, reload) {
  const types = data.serviceTypes || [];
  const statuses = data.serviceStatuses || [];
  const typeLabel = value => types.find(t => t.value === value)?.label || value;
  const statusLabel = value => statuses.find(s => s.value === value)?.label || value;
  const body = openDrawer(line ? line.description : 'Nova reserva');
  renderView(body, reservation, line, data, reload, { typeLabel, statusLabel, types, statuses });
}

function renderView(body, reservation, line, data, reload, meta) {
  if (!line) { renderForm(body, reservation, line, data, reload, meta); return; }
  const docs = (data.documents || []).filter(d => d.serviceLineId === line.id);

  body.innerHTML = `
    <div class="drawer-field-grid">
      <div><span class="muted small">Tipo</span><div>${esc(meta.typeLabel(line.type))}</div></div>
      <div><span class="muted small">Estado</span><div><span class="pill ${line.status === 'CANCELADO' ? 'pill-warning' : line.status === 'OK' ? 'pill-ok' : ''}">${esc(meta.statusLabel(line.status))}</span></div></div>
      <div><span class="muted small">Fornecedor</span><div>${esc(line.supplierName || '—')}</div></div>
      <div><span class="muted small">Localizador</span><div>${esc(line.locator || '—')}</div></div>
      <div><span class="muted small">Datas</span><div>${esc(line.dateStart || '—')}${line.dateEnd ? ` → ${esc(line.dateEnd)}` : ''}</div></div>
      <div><span class="muted small">Prazo de opção</span><div>${esc(line.optionDeadline || '—')}</div></div>
      <div><span class="muted small">Custo (NET)</span><div>${money(line.netValue)}</div></div>
      <div><span class="muted small">Venda (PVP)</span><div>${money(line.pvpValue)}</div></div>
      <div><span class="muted small">A faturar</span><div><b>${money(lineTotal(line))}</b></div></div>
      <div><span class="muted small">Pago ao fornecedor</span><div>${line.paid ? `<span class="pill pill-ok">Sim${line.paidAt ? ` · ${new Date(line.paidAt).toLocaleDateString('pt-PT')}` : ''}</span>` : '<span class="pill pill-warning">Não</span>'}</div></div>
    </div>
    ${line.cancellationTerms ? `<p class="summary-detail-line"><b>Condições de cancelamento:</b> ${esc(line.cancellationTerms)}</p>` : ''}
    ${line.status === 'CANCELADO' ? `
      <div class="service-line-cancel-fields">
        <p class="service-line-form-title">Cancelamento</p>
        <p class="summary-detail-line"><b>Motivo:</b> ${esc(line.cancelReason || '—')}</p>
        <p class="summary-detail-line"><b>Reembolsável:</b> ${money(line.refundableAmount)} · <b>Reembolsado:</b> ${money(line.refundedAmount)}</p>
      </div>` : ''}
    ${line.notes ? `<p class="summary-detail-line"><b>Notas:</b> ${esc(line.notes)}</p>` : ''}

    <p class="summary-block-label">Anexos</p>
    <div class="doc-list">
      ${docs.map(d => `
        <div class="doc-item">
          <span class="muted">${esc(d.fileName)}</span>
          <a href="${esc(d.signedUrl)}" target="_blank" rel="noopener">Ver</a>
          <button class="ghost mini-action drawer-doc-delete" data-doc="${d.id}">Remover</button>
        </div>`).join('') || '<p class="empty-note">Sem anexos nesta reserva.</p>'}
    </div>
    <form class="drawer-doc-form">
      <input type="file" class="drawer-doc-input" required>
      <button type="submit" class="ghost mini-action">Anexar</button>
    </form>

    <div class="service-line-form-actions">
      <button type="button" class="btn mini-action drawer-edit">Editar</button>
      <button type="button" class="ghost mini-action drawer-delete">Eliminar</button>
    </div>`;

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
        body: JSON.stringify({ reservationId: reservation.id, serviceLineId: line.id, type: 'OTHER', fileName: file.name, mimeType: file.type, fileBase64 })
      });
      await reload();
      closeDrawer();
    } catch (err) {
      alert(err.message);
      btn.disabled = false;
      btn.textContent = 'Anexar';
    }
  };

  body.querySelector('.drawer-edit').onclick = () => renderForm(body, reservation, line, data, reload, meta);
  body.querySelector('.drawer-delete').onclick = async () => {
    if (!confirm('Eliminar esta reserva?')) return;
    try {
      await api('/api/admin/reservations/services/delete', { method: 'POST', body: JSON.stringify({ reservationId: reservation.id, id: line.id }) });
      await reload();
      closeDrawer();
    } catch (err) { alert(err.message); }
  };
}

function renderForm(body, reservation, line, data, reload, meta) {
  const { types, statuses } = meta;
  body.innerHTML = `
    <form class="service-line-form">
      <div class="drawer-form-fields">
        <label>Tipo <select name="type" required>${types.map(t => `<option value="${t.value}" ${line?.type === t.value ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>
        <label>Descrição <input name="description" required value="${esc(line?.description || '')}" placeholder="ex.: Hotel Bahia Azul Palace 5★" /></label>
        <label>Fornecedor <input name="supplierName" list="service-supplier-list" value="${esc(line?.supplierName || '')}" placeholder="ex.: Solférias Demo" /></label>
        <label>Localizador <input name="locator" value="${esc(line?.locator || '')}" placeholder="ex.: ABC123" /></label>
        <label>Referência interna <input name="reference" value="${esc(line?.reference || '')}" /></label>
        <label>Data início <input type="date" name="dateStart" value="${esc(line?.dateStart || '')}" /></label>
        <label>Data fim <input type="date" name="dateEnd" value="${esc(line?.dateEnd || '')}" /></label>
        <label>Prazo de opção <input type="date" name="optionDeadline" value="${esc(line?.optionDeadline || '')}" /></label>
        <label>Estado <select name="status">${statuses.map(s => `<option value="${s.value}" ${(line?.status || 'PENDENTE') === s.value ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></label>
        <label>Quantidade <input type="number" name="quantity" min="1" step="1" value="${line?.quantity ?? 1}" /></label>
        <label>Custo NET (€) <input type="number" name="netValue" min="0" step="0.01" value="${line?.netValue ?? 0}" /></label>
        <label>Venda PVP (€) <input type="number" name="pvpValue" min="0" step="0.01" value="${line?.pvpValue ?? 0}" /></label>
        <label>Desconto (%) <input type="number" name="discountPercent" min="0" max="100" step="0.1" value="${line?.discountPercent ?? 0}" /></label>
      </div>
      <label class="service-line-notes">Condições de cancelamento <textarea name="cancellationTerms" rows="2">${esc(line?.cancellationTerms || '')}</textarea></label>
      <label class="service-line-checkbox"><input type="checkbox" name="paid" ${line?.paid ? 'checked' : ''} /> Já pago ao fornecedor</label>

      <div class="service-line-cancel-fields" ${(line?.status || 'PENDENTE') !== 'CANCELADO' ? 'hidden' : ''}>
        <p class="service-line-form-title">Cancelamento</p>
        <label>Motivo <input name="cancelReason" value="${esc(line?.cancelReason || '')}" /></label>
        <label>Valor reembolsável (€) <input type="number" name="refundableAmount" min="0" step="0.01" value="${line?.refundableAmount ?? ''}" /></label>
        <label>Valor reembolsado (€) <input type="number" name="refundedAmount" min="0" step="0.01" value="${line?.refundedAmount ?? ''}" /></label>
      </div>

      <label class="service-line-notes">Notas <textarea name="notes" rows="2">${esc(line?.notes || '')}</textarea></label>
      <div class="service-line-form-actions">
        <button class="btn mini-action" type="submit">${line ? 'Guardar alterações' : 'Adicionar reserva'}</button>
        <button class="ghost mini-action drawer-cancel" type="button">Cancelar</button>
      </div>
      <p class="customer-form-message"></p>
    </form>`;

  const datalist = document.createElement('datalist');
  datalist.id = 'service-supplier-list';
  [...new Set((data.serviceLines || []).map(l => l.supplierName).filter(Boolean))].forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    datalist.appendChild(opt);
  });
  body.appendChild(datalist);

  const form = body.querySelector('.service-line-form');
  const cancelFieldsBlock = body.querySelector('.service-line-cancel-fields');
  form.status.onchange = () => { cancelFieldsBlock.hidden = form.status.value !== 'CANCELADO'; };

  body.querySelector('.drawer-cancel').onclick = () => {
    if (line) renderView(body, reservation, line, data, reload, meta);
    else closeDrawer();
  };

  form.onsubmit = async ev => {
    ev.preventDefault();
    const msg = body.querySelector('.customer-form-message');
    const submitBtn = form.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    try {
      await api('/api/admin/reservations/services', {
        method: 'POST',
        body: JSON.stringify({
          reservationId: reservation.id,
          id: line?.id,
          type: form.type.value,
          description: form.description.value,
          supplierName: form.supplierName.value,
          locator: form.locator.value,
          reference: form.reference.value,
          dateStart: form.dateStart.value,
          dateEnd: form.dateEnd.value,
          optionDeadline: form.optionDeadline.value,
          status: form.status.value,
          quantity: form.quantity.value,
          netValue: form.netValue.value,
          pvpValue: form.pvpValue.value,
          discountPercent: form.discountPercent.value,
          cancellationTerms: form.cancellationTerms.value,
          paid: form.paid.checked,
          cancelReason: form.cancelReason.value,
          refundableAmount: form.refundableAmount.value || undefined,
          refundedAmount: form.refundedAmount.value || undefined,
          notes: form.notes.value
        })
      });
      await reload();
      closeDrawer();
    } catch (err) {
      msg.textContent = err.message;
      submitBtn.disabled = false;
    }
  };
}
