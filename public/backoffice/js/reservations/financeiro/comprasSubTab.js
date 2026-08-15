// Sub-separador "Compras": leitura financeira das reservas (separador
// "Reservas") pelo lado do custo - fornecedor, servico, valor NET, se ja
// foi pago. So consulta; a edicao faz-se na ficha lateral de cada reserva.

import { esc, money } from '../../utils.js';

export function renderComprasSubTab(panel, reservation, reload, data = {}) {
  const lines = data.serviceLines || [];
  const types = data.serviceTypes || [];
  const typeLabel = value => types.find(t => t.value === value)?.label || value;
  const active = lines.filter(l => l.status !== 'CANCELADO');
  const totalNet = active.reduce((sum, l) => sum + (Number(l.netValue) || 0) * (Number(l.quantity) || 1), 0);

  panel.innerHTML = `
    <div class="summary-financial-grid">
      <div class="summary-financial-block"><span class="muted small">Nº de compras</span><strong>${active.length}</strong></div>
      <div class="summary-financial-block"><span class="muted small">Custo total (NET)</span><strong>${money(totalNet)}</strong></div>
    </div>
    <div class="bo-table-wrap">
      <table class="bo-table">
        <thead><tr><th>Fornecedor</th><th>Serviço</th><th>Datas</th><th>NET</th><th>Pago</th></tr></thead>
        <tbody>
          ${lines.map(l => `
            <tr>
              <td>${esc(l.supplierName || '—')}</td>
              <td>${esc(typeLabel(l.type))} · ${esc(l.description)}${l.status === 'CANCELADO' ? ' <span class="pill pill-warning">Cancelado</span>' : ''}</td>
              <td class="muted small">${esc(l.dateStart || '')}${l.dateEnd ? ` → ${esc(l.dateEnd)}` : ''}</td>
              <td>${money((Number(l.netValue) || 0) * (Number(l.quantity) || 1))}</td>
              <td>${l.paid ? '<span class="pill pill-ok">Pago</span>' : '<span class="pill pill-warning">Pendente</span>'}</td>
            </tr>`).join('') || `<tr><td colspan="5" class="empty-note">Sem compras registadas.</td></tr>`}
        </tbody>
      </table>
    </div>`;
}
