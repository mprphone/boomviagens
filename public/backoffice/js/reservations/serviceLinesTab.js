// Separador "Serviços": as linhas de compra/venda desta reserva (voo,
// hotel, seguro, transfer...) - cada uma com o seu custo (NET) e venda
// (PVP) reais, ao contrario da proposta original guardada em
// reservation.offer (essa e so a estimativa feita na altura da venda). A
// soma destas linhas alimenta os "Valores Reais" do separador Resumo.
//
// Formulario de adicionar/editar fica sempre visivel por baixo da tabela
// (sem modal aninhado - o modal.js so suporta uma caixa de cada vez);
// clicar "Editar" numa linha carrega os dados no formulario.

import { esc, money, api } from '../utils.js';
import { lineTotal } from './serviceCalc.js';

export function renderServicesTab(panel, reservation, reload, ctx = {}) {
  const services = ctx.services || {};
  const lines = services.serviceLines || [];
  const types = services.types || [];
  const statuses = services.statuses || [];
  const totals = services.totals || { netTotal: 0, pvpTotal: 0, margin: 0 };

  const typeLabel = value => types.find(t => t.value === value)?.label || value;
  const statusLabel = value => statuses.find(s => s.value === value)?.label || value;

  panel.innerHTML = `
    <div class="bo-table-wrap">
      <table class="bo-table service-lines-table">
        <thead>
          <tr>
            <th>Tipo</th><th>Descrição</th><th>Fornecedor</th><th>Ref.</th><th>Datas</th>
            <th>Estado</th><th>Qtd</th><th>NET</th><th>PVP</th><th>Desc.</th><th>A Faturar</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${lines.map(l => `
            <tr data-line="${esc(l.id)}">
              <td>${esc(typeLabel(l.type))}</td>
              <td>${esc(l.description)}</td>
              <td class="muted small">${esc(l.supplierName || '')}</td>
              <td class="muted small">${esc(l.reference || '')}</td>
              <td class="muted small">${esc(l.dateStart || '')}${l.dateEnd ? ` → ${esc(l.dateEnd)}` : ''}</td>
              <td class="service-line-status"><span class="pill ${l.status === 'CANCELADO' ? 'pill-warning' : l.status === 'OK' ? 'pill-ok' : ''}">${esc(statusLabel(l.status))}</span></td>
              <td>${l.quantity}</td>
              <td>${money(l.netValue)}</td>
              <td>${money(l.pvpValue)}</td>
              <td class="muted small">${l.discountPercent ? `${l.discountPercent}%` : '—'}</td>
              <td class="service-line-total"><b>${money(lineTotal(l))}</b></td>
              <td class="service-line-actions">
                <button type="button" class="ghost mini-action service-line-edit">Editar</button>
                <button type="button" class="ghost mini-action service-line-delete">Eliminar</button>
              </td>
            </tr>`).join('') || `<tr><td colspan="12" class="empty-note">Ainda sem serviços registados nesta reserva.</td></tr>`}
        </tbody>
        ${lines.length ? `
          <tfoot>
            <tr>
              <td colspan="7"></td>
              <td><b>${money(totals.netTotal)}</b></td>
              <td><b>${money(totals.pvpTotal)}</b></td>
              <td></td>
              <td><b>${money(totals.pvpTotal - totals.netTotal)}</b></td>
              <td></td>
            </tr>
          </tfoot>` : ''}
      </table>
    </div>

    <form class="service-line-form">
      <input type="hidden" name="id" />
      <p class="service-line-form-title">Adicionar serviço</p>
      <div class="customer-profile-grid">
        <label>Tipo
          <select name="type" required>${types.map(t => `<option value="${t.value}">${esc(t.label)}</option>`).join('')}</select>
        </label>
        <label>Descrição <input name="description" required placeholder="ex.: Hotel Bahia Azul Palace 5★" /></label>
        <label>Fornecedor <input name="supplierName" list="service-supplier-list" placeholder="ex.: Solférias Demo" /></label>
        <label>Referência <input name="reference" placeholder="localizador/referência do fornecedor" /></label>
        <label>Data início <input type="date" name="dateStart" /></label>
        <label>Data fim <input type="date" name="dateEnd" /></label>
        <label>Estado
          <select name="status">${statuses.map(s => `<option value="${s.value}">${esc(s.label)}</option>`).join('')}</select>
        </label>
        <label>Quantidade <input type="number" name="quantity" min="1" step="1" value="1" /></label>
        <label>Custo NET (€) <input type="number" name="netValue" min="0" step="0.01" value="0" /></label>
        <label>Venda PVP (€) <input type="number" name="pvpValue" min="0" step="0.01" value="0" /></label>
        <label>Desconto (%) <input type="number" name="discountPercent" min="0" max="100" step="0.1" value="0" /></label>
      </div>
      <label class="service-line-notes">Notas <textarea name="notes" rows="2" placeholder="ex.: atraso na confirmação, pedido especial..."></textarea></label>
      <div class="service-line-form-actions">
        <button class="btn mini-action" type="submit">Adicionar serviço</button>
        <button class="ghost mini-action service-line-cancel" type="button" hidden>Cancelar edição</button>
      </div>
      <p class="customer-form-message"></p>
    </form>`;

  const datalist = document.createElement('datalist');
  datalist.id = 'service-supplier-list';
  [...new Set(lines.map(l => l.supplierName).filter(Boolean))].forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    datalist.appendChild(opt);
  });
  panel.appendChild(datalist);

  const form = panel.querySelector('.service-line-form');
  const cancelBtn = panel.querySelector('.service-line-cancel');
  const submitBtn = form.querySelector('button[type="submit"]');
  const titleEl = panel.querySelector('.service-line-form-title');

  function resetForm() {
    form.reset();
    form.id.value = '';
    titleEl.textContent = 'Adicionar serviço';
    submitBtn.textContent = 'Adicionar serviço';
    cancelBtn.hidden = true;
  }

  cancelBtn.onclick = resetForm;

  panel.querySelectorAll('.service-line-edit').forEach(btn => {
    btn.onclick = () => {
      const line = lines.find(l => l.id === btn.closest('tr').dataset.line);
      if (!line) return;
      form.id.value = line.id;
      form.type.value = line.type;
      form.description.value = line.description;
      form.supplierName.value = line.supplierName || '';
      form.reference.value = line.reference || '';
      form.dateStart.value = line.dateStart || '';
      form.dateEnd.value = line.dateEnd || '';
      form.status.value = line.status;
      form.quantity.value = line.quantity;
      form.netValue.value = line.netValue;
      form.pvpValue.value = line.pvpValue;
      form.discountPercent.value = line.discountPercent;
      form.notes.value = line.notes || '';
      titleEl.textContent = `A editar: ${line.description}`;
      submitBtn.textContent = 'Guardar alterações';
      cancelBtn.hidden = false;
      form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
  });

  panel.querySelectorAll('.service-line-delete').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Eliminar este serviço?')) return;
      try {
        await api('/api/admin/reservations/services/delete', {
          method: 'POST',
          body: JSON.stringify({ reservationId: reservation.id, id: btn.closest('tr').dataset.line })
        });
        await reload();
      } catch (err) { alert(err.message); }
    };
  });

  form.onsubmit = async ev => {
    ev.preventDefault();
    const msg = panel.querySelector('.customer-form-message');
    submitBtn.disabled = true;
    try {
      await api('/api/admin/reservations/services', {
        method: 'POST',
        body: JSON.stringify({
          reservationId: reservation.id,
          id: form.id.value || undefined,
          type: form.type.value,
          description: form.description.value,
          supplierName: form.supplierName.value,
          reference: form.reference.value,
          dateStart: form.dateStart.value,
          dateEnd: form.dateEnd.value,
          status: form.status.value,
          quantity: form.quantity.value,
          netValue: form.netValue.value,
          pvpValue: form.pvpValue.value,
          discountPercent: form.discountPercent.value,
          notes: form.notes.value
        })
      });
      await reload();
    } catch (err) {
      msg.textContent = err.message;
      submitBtn.disabled = false;
    }
  };
}
