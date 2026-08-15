// Sub-separador "Vendas": referencia do documento emitido ao cliente
// (numero, sistema, data) - a fatura oficial e sempre emitida em software
// certificado pela AT (ex.: OptiTravel), nunca aqui. O regime de IVA fica
// no sub-separador "IVA".

import { esc, api } from '../../utils.js';

export function renderVendasSubTab(panel, reservation, reload) {
  panel.innerHTML = `
    <div class="invoice-notice">
      <p><b>⚠️ Nota importante:</b> este programa não emite faturas fiscais. A fatura oficial tem de ser emitida em software certificado pela Autoridade Tributária (ex.: OptiTravel). Aqui apenas se regista a referência depois de emitida.</p>
    </div>
    <form class="invoice-form">
      <div class="customer-profile-grid">
        <label>Sistema onde foi emitida <input name="invoiceSystem" value="${esc(reservation.invoiceSystem || '')}" placeholder="ex.: OptiTravel" /></label>
        <label>Número da fatura <input name="invoiceNumber" value="${esc(reservation.invoiceNumber || '')}" placeholder="ex.: FAD 23200137" /></label>
        <label>Data de emissão <input name="invoiceDate" type="date" value="${esc(reservation.invoiceDate || '')}" /></label>
      </div>
      <button class="btn mini-action" type="submit">Guardar</button>
      <p class="customer-form-message"></p>
    </form>`;

  panel.querySelector('.invoice-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button[type="submit"]');
    const msg = panel.querySelector('.customer-form-message');
    btn.disabled = true;
    btn.textContent = 'A guardar...';
    try {
      await api('/api/admin/reservations/invoice', {
        method: 'POST',
        body: JSON.stringify({ reservationId: reservation.id, invoiceSystem: f.invoiceSystem.value, invoiceNumber: f.invoiceNumber.value, invoiceDate: f.invoiceDate.value })
      });
      await reload();
    } catch (err) {
      msg.textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Guardar';
    }
  });
}
