// Sub-separador "Pagamentos" (a fornecedores): quais reservas ja foram
// pagas ao fornecedor e quais ainda faltam, com um botao rapido para
// marcar como paga sem ter de abrir a ficha lateral da reserva.

import { esc, money, api } from '../../utils.js';

export function renderPagamentosSubTab(panel, reservation, reload, data = {}) {
  const lines = (data.serviceLines || []).filter(l => l.status !== 'CANCELADO' && (Number(l.netValue) || 0) > 0);
  const pending = lines.filter(l => !l.paid);
  const totalPending = pending.reduce((sum, l) => sum + (Number(l.netValue) || 0) * (Number(l.quantity) || 1), 0);

  panel.innerHTML = `
    <div class="summary-financial-grid">
      <div class="summary-financial-block"><span class="muted small">Por pagar</span><strong>${pending.length}</strong></div>
      <div class="summary-financial-block"><span class="muted small">Valor por pagar</span><strong>${money(totalPending)}</strong></div>
    </div>
    <div class="bo-table-wrap">
      <table class="bo-table">
        <thead><tr><th>Fornecedor</th><th>Serviço</th><th>Valor</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          ${lines.map(l => `
            <tr data-line="${esc(l.id)}">
              <td>${esc(l.supplierName || '—')}</td>
              <td>${esc(l.description)}</td>
              <td>${money((Number(l.netValue) || 0) * (Number(l.quantity) || 1))}</td>
              <td>${l.paid ? `<span class="pill pill-ok">Pago${l.paidAt ? ` · ${new Date(l.paidAt).toLocaleDateString('pt-PT')}` : ''}</span>` : '<span class="pill pill-warning">Pendente</span>'}</td>
              <td>${!l.paid ? '<button type="button" class="ghost mini-action pay-supplier">Marcar pago</button>' : ''}</td>
            </tr>`).join('') || `<tr><td colspan="5" class="empty-note">Sem compras com custo registado.</td></tr>`}
        </tbody>
      </table>
    </div>`;

  panel.querySelectorAll('.pay-supplier').forEach(btn => {
    btn.onclick = async () => {
      const line = lines.find(l => l.id === btn.closest('tr').dataset.line);
      if (!line) return;
      btn.disabled = true;
      try {
        await api('/api/admin/reservations/services', {
          method: 'POST',
          body: JSON.stringify({
            reservationId: reservation.id, id: line.id, type: line.type, description: line.description,
            supplierName: line.supplierName, locator: line.locator, reference: line.reference,
            dateStart: line.dateStart, dateEnd: line.dateEnd, optionDeadline: line.optionDeadline,
            status: line.status, quantity: line.quantity, netValue: line.netValue, pvpValue: line.pvpValue,
            discountPercent: line.discountPercent, cancellationTerms: line.cancellationTerms, notes: line.notes,
            paid: true
          })
        });
        await reload();
      } catch (err) { alert(err.message); btn.disabled = false; }
    };
  });
}
