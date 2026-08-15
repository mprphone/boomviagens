// Sub-separador "IVA": regime aplicavel a esta reserva. A explicacao do
// regime da margem fica escondida por omissao (nao e leitura do dia a dia)
// - so aparece ao clicar no ⓘ.

import { esc, money, api } from '../../utils.js';
import { computeServiceTotals } from '../serviceCalc.js';

const VAT_REGIMES = [
  { value: 'MARGEM', label: 'Regime da margem (Art. 308º CIVA)' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'ISENTO', label: 'Isento' },
  { value: 'REDUZIDA', label: 'Taxa reduzida' }
];

function marginSchemeVat(marginValue, vatRate = 23) {
  const margin = Number(marginValue) || 0;
  const vatAmount = Number((margin - margin / (1 + vatRate / 100)).toFixed(2));
  return { vatAmount, netMargin: Number((margin - vatAmount).toFixed(2)) };
}

export function renderIvaSubTab(panel, reservation, reload, data = {}) {
  const lines = data.serviceLines || [];
  const offer = reservation.offer || {};
  const hasRealValues = lines.length > 0;
  const totals = computeServiceTotals(lines);
  const margin = hasRealValues ? totals.margin : Number(offer.marginValue ?? ((offer.finalPrice || 0) - (offer.costPrice || 0)));
  const vatRegime = reservation.vatRegime || 'MARGEM';
  const { vatAmount, netMargin } = marginSchemeVat(margin);

  panel.innerHTML = `
    <form class="vat-regime-form">
      <label>Regime de IVA aplicável
        <select name="vatRegime">
          ${VAT_REGIMES.map(r => `<option value="${r.value}" ${r.value === vatRegime ? 'selected' : ''}>${r.label}</option>`).join('')}
        </select>
      </label>
      <button class="btn mini-action" type="submit">Guardar</button>
      <p class="customer-form-message"></p>
    </form>

    ${vatRegime === 'MARGEM' ? `
      <details class="vat-explain">
        <summary>ⓘ Como funciona o regime da margem</summary>
        <div class="summary-vat-note">
          <p><b>Estimativa - regime da margem (Art. 308º CIVA):</b> o IVA incide só sobre a margem, à taxa normal (23%), já incluído no seu valor.</p>
          <div class="summary-financial-grid">
            <div class="summary-financial-block"><span class="muted small">IVA sobre a margem (estimado)</span><strong>${money(vatAmount)}</strong></div>
            <div class="summary-financial-block"><span class="muted small">Margem líquida (estimada)</span><strong>${money(netMargin)}</strong></div>
          </div>
          <p class="muted small">Valor indicativo para gestão interna - a fatura oficial é sempre emitida em software certificado pela AT.</p>
        </div>
      </details>` : ''}
  `;

  panel.querySelector('.vat-regime-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button[type="submit"]');
    const msg = panel.querySelector('.customer-form-message');
    btn.disabled = true;
    btn.textContent = 'A guardar...';
    try {
      await api('/api/admin/reservations/invoice', { method: 'POST', body: JSON.stringify({ reservationId: reservation.id, vatRegime: f.vatRegime.value }) });
      await reload();
    } catch (err) {
      msg.textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Guardar';
    }
  });
}
