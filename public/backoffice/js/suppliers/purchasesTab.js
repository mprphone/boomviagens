// Separador "Compras": reservas associadas a este fornecedor (por
// correspondencia com reservation.operator - ver adminRoutes.js#matchesSupplier),
// com o custo (NET) de cada uma.

import { esc, money } from '../utils.js';

export function renderPurchasesTab(panel, data) {
  if (!data.purchases.length) {
    panel.innerHTML = '<p class="empty-note">Ainda sem compras registadas a este fornecedor.</p>';
    return;
  }
  const totalCost = data.purchases.reduce((sum, r) => sum + (Number(r.offer?.costPrice) || 0), 0);
  panel.innerHTML = `
    <div class="summary-financial-grid">
      <div class="summary-financial-block"><span class="muted small">Total de compras</span><strong>${data.purchases.length}</strong></div>
      <div class="summary-financial-block"><span class="muted small">Custo total (NET)</span><strong>${money(totalCost)}</strong></div>
    </div>
    <div class="customer-trip-list">
      ${data.purchases.map(r => `
        <div class="customer-trip-row">
          <div>
            <b>${esc(r.offer?.hotel || r.id)}</b>
            <span class="muted">${esc(r.offer?.destination || '')}</span>
            <div class="muted small">${esc(r.id)} · ${new Date(r.createdAt).toLocaleDateString('pt-PT')}</div>
          </div>
          <div class="customer-trip-side">
            <span class="pill">${esc(r.status)}</span>
            <strong>${money(r.offer?.costPrice)}</strong>
          </div>
        </div>`).join('')}
    </div>`;
}
