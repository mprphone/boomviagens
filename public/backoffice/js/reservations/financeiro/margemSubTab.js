// Sub-separador "Margem": compara a margem prevista na proposta original
// (reservation.offer) com a margem real apurada a partir das reservas
// (separador Reservas) - o desvio mostra se alteracoes posteriores
// (descontos, custos extra, cancelamentos) reduziram a rentabilidade.

import { esc, money } from '../../utils.js';
import { computeServiceTotals, serviceStatusPillClass } from '../serviceCalc.js';

export function renderMargemSubTab(panel, reservation, reload, data = {}) {
  const lines = data.serviceLines || [];
  const statuses = data.serviceStatuses || [];
  const statusLabel = value => statuses.find(s => s.value === value)?.label || value;
  const offer = reservation.offer || {};
  const estimatedCost = Number(offer.costPrice) || 0;
  const estimatedSale = Number(offer.finalPrice) || 0;
  const estimatedMargin = Number(offer.marginValue ?? (estimatedSale - estimatedCost));

  const totals = computeServiceTotals(lines);
  const hasRealValues = lines.length > 0;
  const diff = hasRealValues ? Number((totals.margin - estimatedMargin).toFixed(2)) : 0;

  const activeLines = lines.filter(l => l.status !== 'CANCELADO');
  const cancelledLines = lines.filter(l => l.status === 'CANCELADO');
  const lostToCancellations = cancelledLines.reduce((sum, l) => {
    const penalty = (Number(l.refundableAmount) || 0) - (Number(l.refundedAmount) || 0);
    return sum + Math.max(0, penalty);
  }, 0);

  panel.innerHTML = `
    <div class="summary-financial-grid">
      <div class="summary-financial-block"><span class="muted small">Custo previsto</span><strong>${money(estimatedCost)}</strong></div>
      <div class="summary-financial-block"><span class="muted small">Custo real</span><strong>${hasRealValues ? money(totals.netTotal) : '—'}</strong></div>
      <div class="summary-financial-block"><span class="muted small">Margem prevista</span><strong>${money(estimatedMargin)}</strong></div>
      <div class="summary-financial-block"><span class="muted small">Margem real</span><strong>${hasRealValues ? money(totals.margin) : '—'}</strong></div>
    </div>
    ${hasRealValues ? `
      <p class="summary-detail-line"><b>Desvio face à proposta:</b> <span class="${diff < 0 ? 'margin-diff-negative' : 'margin-diff-positive'}">${diff >= 0 ? '+' : ''}${money(diff)}</span></p>
      ${lostToCancellations > 0 ? `<p class="summary-detail-line"><b>Penalizações de cancelamento não reembolsadas:</b> ${money(lostToCancellations)}</p>` : ''}
      <div class="bo-table-wrap">
        <table class="bo-table">
          <thead><tr><th>Reserva</th><th>Estado</th><th>NET</th><th>PVP</th><th>Margem</th></tr></thead>
          <tbody>
            ${lines.map(l => {
              const lineNet = (Number(l.netValue) || 0) * (Number(l.quantity) || 1);
              const lineGross = (Number(l.pvpValue) || 0) * (Number(l.quantity) || 1);
              const lineDiscount = lineGross * (Number(l.discountPercent) || 0) / 100;
              const lineMargin = lineGross - lineDiscount - lineNet;
              return `<tr>
                <td>${esc(l.description)}</td>
                <td><span class="pill ${serviceStatusPillClass(l.status)}">${esc(statusLabel(l.status))}</span></td>
                <td>${money(lineNet)}</td>
                <td>${money(lineGross - lineDiscount)}</td>
                <td><b>${money(lineMargin)}</b></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>` : `<p class="empty-note">Ainda sem reservas registadas (${activeLines.length} ativas) - a margem real fica disponível quando houver custos lançados no separador "Reservas".</p>`}
  `;
}
