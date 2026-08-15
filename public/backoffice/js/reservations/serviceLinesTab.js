// Separador "Serviços": as reservas/compras individuais desta viagem (voo,
// hotel, seguro, transfer...) - cada uma com localizador, prazo de opção,
// condições de cancelamento, custo (NET)/venda (PVP) reais e se ja foi
// paga ao fornecedor. Ao contrario da proposta original guardada em
// reservation.offer (essa e so a estimativa feita na altura da venda), a
// soma destas linhas da os "Valores Reais" do separador Resumo.
//
// Quando uma linha fica com estado CANCELADO, o formulario mostra campos
// extra (motivo, valor reembolsavel/reembolsado) - e assim que o separador
// "Serviços" tambem cobre os cancelamentos, sem precisar de um separador
// proprio.
//
// Formulario de adicionar/editar fica sempre visivel por baixo da tabela
// (sem modal aninhado - o modal.js so suporta uma caixa de cada vez);
// clicar "Editar" numa linha carrega os dados no formulario.

import { esc, money, api } from '../utils.js';
import { lineTotal } from './serviceCalc.js';

export function renderServicesTab(panel, reservation, reload, data = {}) {
  const lines = data.serviceLines || [];
  const types = data.serviceTypes || [];
  const statuses = data.serviceStatuses || [];
  const totals = data.serviceTotals || { netTotal: 0, pvpTotal: 0, margin: 0 };

  const typeLabel = value => types.find(t => t.value === value)?.label || value;
  const statusLabel = value => statuses.find(s => s.value === value)?.label || value;

  panel.innerHTML = `
    <div class="bo-table-wrap">
      <table class="bo-table service-lines-table">
        <thead>
          <tr>
            <th>Tipo</th><th>Descrição</th><th>Fornecedor</th><th>Localizador</th><th>Datas</th>
            <th>Estado</th><th>NET</th><th>PVP</th><th>A Faturar</th><th>Pago forn.</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${lines.map(l => `
            <tr data-line="${esc(l.id)}">
              <td>${esc(typeLabel(l.type))}</td>
              <td>${esc(l.description)}${l.status === 'CANCELADO' && l.cancelReason ? `<div class="muted small">Cancelado: ${esc(l.cancelReason)}</div>` : ''}</td>
              <td class="muted small">${esc(l.supplierName || '')}</td>
              <td class="muted small">${esc(l.locator || l.reference || '')}</td>
              <td class="muted small">${esc(l.dateStart || '')}${l.dateEnd ? ` → ${esc(l.dateEnd)}` : ''}</td>
              <td class="service-line-status"><span class="pill ${l.status === 'CANCELADO' ? 'pill-warning' : l.status === 'OK' ? 'pill-ok' : ''}">${esc(statusLabel(l.status))}</span></td>
              <td>${money(l.netValue)}</td>
              <td>${money(l.pvpValue)}</td>
              <td class="service-line-total"><b>${money(lineTotal(l))}</b></td>
              <td>${l.paid ? '<span class="pill pill-ok">Pago</span>' : '<span class="pill pill-warning">Pendente</span>'}</td>
              <td class="service-line-actions">
                <button type="button" class="ghost mini-action service-line-edit">Editar</button>
                <button type="button" class="ghost mini-action service-line-delete">Eliminar</button>
              </td>
            </tr>`).join('') || `<tr><td colspan="11" class="empty-note">Ainda sem serviços registados nesta reserva.</td></tr>`}
        </tbody>
        ${lines.length ? `
          <tfoot>
            <tr>
              <td colspan="6"></td>
              <td><b>${money(totals.netTotal)}</b></td>
              <td><b>${money(totals.pvpTotal)}</b></td>
              <td><b>${money(totals.pvpTotal - totals.netTotal)}</b></td>
              <td colspan="2"></td>
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
        <label>Localizador <input name="locator" placeholder="ex.: ABC123" /></label>
        <label>Referência interna <input name="reference" placeholder="referência do fornecedor" /></label>
        <label>Data início <input type="date" name="dateStart" /></label>
        <label>Data fim <input type="date" name="dateEnd" /></label>
        <label>Prazo de opção <input type="date" name="optionDeadline" /></label>
        <label>Estado
          <select name="status">${statuses.map(s => `<option value="${s.value}">${esc(s.label)}</option>`).join('')}</select>
        </label>
        <label>Quantidade <input type="number" name="quantity" min="1" step="1" value="1" /></label>
        <label>Custo NET (€) <input type="number" name="netValue" min="0" step="0.01" value="0" /></label>
        <label>Venda PVP (€) <input type="number" name="pvpValue" min="0" step="0.01" value="0" /></label>
        <label>Desconto (%) <input type="number" name="discountPercent" min="0" max="100" step="0.1" value="0" /></label>
      </div>
      <label class="service-line-notes">Condições de cancelamento <textarea name="cancellationTerms" rows="2" placeholder="ex.: cancelamento grátis até 15 dias antes, depois penalização de 30%"></textarea></label>
      <label class="service-line-checkbox"><input type="checkbox" name="paid" /> Já pago ao fornecedor</label>

      <div class="service-line-cancel-fields" hidden>
        <p class="service-line-form-title">Cancelamento</p>
        <div class="customer-profile-grid">
          <label>Motivo <input name="cancelReason" placeholder="ex.: pedido do cliente, indisponibilidade do hotel" /></label>
          <label>Valor reembolsável (€) <input type="number" name="refundableAmount" min="0" step="0.01" /></label>
          <label>Valor reembolsado (€) <input type="number" name="refundedAmount" min="0" step="0.01" /></label>
        </div>
      </div>

      <label class="service-line-notes">Notas <textarea name="notes" rows="2" placeholder="observações gerais..."></textarea></label>
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
  const cancelEditBtn = panel.querySelector('.service-line-cancel');
  const submitBtn = form.querySelector('button[type="submit"]');
  const titleEl = panel.querySelector('.service-line-form-title');
  const cancelFieldsBlock = panel.querySelector('.service-line-cancel-fields');

  const toggleCancelFields = () => { cancelFieldsBlock.hidden = form.status.value !== 'CANCELADO'; };
  form.status.onchange = toggleCancelFields;
  toggleCancelFields();

  function resetForm() {
    form.reset();
    form.id.value = '';
    titleEl.textContent = 'Adicionar serviço';
    submitBtn.textContent = 'Adicionar serviço';
    cancelEditBtn.hidden = true;
    toggleCancelFields();
  }

  cancelEditBtn.onclick = resetForm;

  panel.querySelectorAll('.service-line-edit').forEach(btn => {
    btn.onclick = () => {
      const line = lines.find(l => l.id === btn.closest('tr').dataset.line);
      if (!line) return;
      form.id.value = line.id;
      form.type.value = line.type;
      form.description.value = line.description;
      form.supplierName.value = line.supplierName || '';
      form.locator.value = line.locator || '';
      form.reference.value = line.reference || '';
      form.dateStart.value = line.dateStart || '';
      form.dateEnd.value = line.dateEnd || '';
      form.optionDeadline.value = line.optionDeadline || '';
      form.status.value = line.status;
      form.quantity.value = line.quantity;
      form.netValue.value = line.netValue;
      form.pvpValue.value = line.pvpValue;
      form.discountPercent.value = line.discountPercent;
      form.cancellationTerms.value = line.cancellationTerms || '';
      form.paid.checked = Boolean(line.paid);
      form.cancelReason.value = line.cancelReason || '';
      form.refundableAmount.value = line.refundableAmount ?? '';
      form.refundedAmount.value = line.refundedAmount ?? '';
      form.notes.value = line.notes || '';
      toggleCancelFields();
      titleEl.textContent = `A editar: ${line.description}`;
      submitBtn.textContent = 'Guardar alterações';
      cancelEditBtn.hidden = false;
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
    } catch (err) {
      msg.textContent = err.message;
      submitBtn.disabled = false;
    }
  };
}
