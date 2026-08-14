// Separador "Emissões": registo de que a fatura ja foi emitida (numero,
// data, sistema) e o regime de IVA aplicavel. Nao emite fatura nenhuma -
// isso exige software certificado pela AT (SAF-T PT). Aqui so se guarda a
// referencia depois de emitida la (ex.: no OptiTravel).

import { esc, api } from '../utils.js';

const VAT_REGIMES = [
  { value: 'MARGEM', label: 'Regime da margem (Art. 308º CIVA)' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'ISENTO', label: 'Isento' },
  { value: 'REDUZIDA', label: 'Taxa reduzida' }
];

export function renderInvoiceTab(panel, reservation, reload) {
  panel.innerHTML = `
    <div class="invoice-notice">
      <p><b>⚠️ Nota importante:</b> este programa não emite faturas fiscais. A fatura oficial tem de ser emitida em software certificado pela Autoridade Tributária (ex.: OptiTravel). Aqui apenas se regista a referência depois de emitida, para ficar tudo ligado à reserva.</p>
    </div>
    <form class="invoice-form">
      <div class="customer-profile-grid">
        <label>Regime de IVA
          <select name="vatRegime">
            ${VAT_REGIMES.map(r => `<option value="${r.value}" ${r.value === (reservation.vatRegime || 'MARGEM') ? 'selected' : ''}>${r.label}</option>`).join('')}
          </select>
        </label>
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
        body: JSON.stringify({
          reservationId: reservation.id,
          vatRegime: f.vatRegime.value,
          invoiceSystem: f.invoiceSystem.value,
          invoiceNumber: f.invoiceNumber.value,
          invoiceDate: f.invoiceDate.value
        })
      });
      await reload();
    } catch (err) {
      msg.textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Guardar';
    }
  });
}
