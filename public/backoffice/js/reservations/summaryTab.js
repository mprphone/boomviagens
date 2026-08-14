// Separador "Resumo": custo, venda, margem e uma estimativa do IVA sobre a
// margem (regime especial das agencias de viagem, Art. 308-310 CIVA). So
// calculo informativo para a equipa perceber o negocio - a fatura oficial
// e sempre emitida em software certificado pela AT (ver ./invoiceTab.js).

import { esc, money, api } from '../utils.js';

// Mesma formula de src/pricing.js#marginSchemeVat - duplicada aqui de
// proposito (o backoffice nao importa ficheiros do servidor).
function marginSchemeVat(marginValue, vatRate = 23) {
  const margin = Number(marginValue) || 0;
  const vatAmount = Number((margin - margin / (1 + vatRate / 100)).toFixed(2));
  return { vatAmount, netMargin: Number((margin - vatAmount).toFixed(2)) };
}

export function renderSummaryTab(panel, reservation, reload, statuses = []) {
  const offer = reservation.offer || {};
  const costPrice = Number(offer.costPrice) || 0;
  const finalPrice = Number(offer.finalPrice) || 0;
  const margin = Number(offer.marginValue ?? (finalPrice - costPrice));
  const vatRegime = reservation.vatRegime || 'MARGEM';
  const { vatAmount, netMargin } = marginSchemeVat(margin);

  panel.innerHTML = `
    <div class="reservation-status-row">
      <label>Estado da reserva
        <select class="summary-status-select">
          ${statuses.map(s => `<option value="${s.value}" ${s.value === reservation.status ? 'selected' : ''}>${s.label}</option>`).join('')}
        </select>
      </label>
      <button type="button" class="btn mini-action summary-status-save">Guardar estado</button>
      <p class="customer-form-message"></p>
    </div>
    <div class="summary-financial-grid">
      <div class="summary-financial-block">
        <span class="muted small">Custo (NET)</span>
        <strong>${money(costPrice)}</strong>
      </div>
      <div class="summary-financial-block">
        <span class="muted small">Venda (PVP)</span>
        <strong>${money(finalPrice)}</strong>
      </div>
      <div class="summary-financial-block">
        <span class="muted small">Margem</span>
        <strong>${money(margin)}</strong>
      </div>
      <div class="summary-financial-block">
        <span class="muted small">Regime de IVA</span>
        <strong>${vatRegime === 'MARGEM' ? 'Regime da margem' : vatRegime === 'ISENTO' ? 'Isento' : vatRegime === 'REDUZIDA' ? 'Taxa reduzida' : 'Normal'}</strong>
      </div>
    </div>
    ${vatRegime === 'MARGEM' ? `
      <div class="summary-vat-note">
        <p><b>Estimativa - regime da margem (Art. 308º CIVA):</b> o IVA incide só sobre a margem, à taxa normal (23%), já incluído no seu valor.</p>
        <div class="summary-financial-grid">
          <div class="summary-financial-block"><span class="muted small">IVA sobre a margem (estimado)</span><strong>${money(vatAmount)}</strong></div>
          <div class="summary-financial-block"><span class="muted small">Margem líquida (estimada)</span><strong>${money(netMargin)}</strong></div>
        </div>
        <p class="muted small">Valor indicativo para gestão interna - a fatura oficial é sempre emitida em software certificado pela AT.</p>
      </div>` : ''}
    <div class="summary-detail-line"><b>Hotel:</b> ${esc(offer.hotel || '')} · ${esc(offer.destination || '')}${offer.country ? `, ${esc(offer.country)}` : ''}</div>
    <div class="summary-detail-line"><b>Datas:</b> ${esc(offer.checkin || '')} → ${esc(offer.checkout || '')} (${offer.nights || 0} noites)</div>
    <div class="summary-detail-line"><b>Operador:</b> ${esc(reservation.operator || 'não definido')}</div>
    ${reservation.notes ? `<div class="summary-detail-line"><b>Notas:</b> ${esc(reservation.notes)}</div>` : ''}
  `;

  panel.querySelector('.summary-status-save').onclick = async () => {
    const btn = panel.querySelector('.summary-status-save');
    const msg = panel.querySelector('.customer-form-message');
    const status = panel.querySelector('.summary-status-select').value;
    btn.disabled = true;
    btn.textContent = 'A guardar...';
    try {
      await api('/api/admin/reservations/update', { method: 'POST', body: JSON.stringify({ reservationId: reservation.id, status }) });
      await reload();
    } catch (err) {
      msg.textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Guardar estado';
    }
  };
}
