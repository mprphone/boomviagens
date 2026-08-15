// Separador "Vendas": documentos emitidos ao cliente (regime de IVA,
// referencia da fatura - emitida sempre em software certificado pela AT,
// nunca aqui) e os recebimentos ja efetuados, com o saldo em falta.

import { esc, money, api } from '../utils.js';

const VAT_REGIMES = [
  { value: 'MARGEM', label: 'Regime da margem (Art. 308º CIVA)' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'ISENTO', label: 'Isento' },
  { value: 'REDUZIDA', label: 'Taxa reduzida' }
];

export function renderSalesTab(panel, reservation, reload, data = {}) {
  const payments = data.payments || [];
  const totalPaid = payments.filter(p => p.status === 'PAID').reduce((sum, p) => sum + (p.amount || 0), 0);
  const dueFromCustomer = Math.max(0, (reservation.offer?.finalPrice || 0) - totalPaid);

  panel.innerHTML = `
    <div class="invoice-notice">
      <p><b>⚠️ Nota importante:</b> este programa não emite faturas fiscais. A fatura oficial tem de ser emitida em software certificado pela Autoridade Tributária (ex.: OptiTravel). Aqui apenas se regista a referência depois de emitida, para ficar tudo ligado ao processo.</p>
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
      <p class="customer-form-message invoice-message"></p>
    </form>

    <p class="summary-block-label">Recebimentos</p>
    <div class="summary-financial-grid">
      <div class="summary-financial-block"><span class="muted small">Venda</span><strong>${money(reservation.offer?.finalPrice)}</strong></div>
      <div class="summary-financial-block"><span class="muted small">Recebido</span><strong>${money(totalPaid)}</strong></div>
      <div class="summary-financial-block"><span class="muted small">Por receber</span><strong>${money(dueFromCustomer)}</strong></div>
    </div>
    <div class="bo-table-wrap">
      <table class="bo-table">
        <thead><tr><th>Data</th><th>Método</th><th>Referência</th><th>Estado</th><th>Valor</th></tr></thead>
        <tbody>
          ${payments.map(p => `
            <tr>
              <td class="muted small">${new Date(p.createdAt).toLocaleDateString('pt-PT')}</td>
              <td>${esc(p.method)}</td>
              <td class="muted small">${esc(p.reference || '')}</td>
              <td><span class="pill ${p.status === 'PAID' ? 'pill-ok' : 'pill-warning'}">${p.status === 'PAID' ? 'Recebido' : 'Pendente'}</span></td>
              <td><b>${money(p.amount)}</b></td>
            </tr>`).join('') || `<tr><td colspan="5" class="empty-note">Sem recebimentos registados.</td></tr>`}
        </tbody>
      </table>
    </div>

    <form class="payment-form">
      <p class="service-line-form-title">Registar recebimento manual</p>
      <div class="customer-profile-grid">
        <label>Valor (€) <input type="number" name="amount" min="0.01" step="0.01" required /></label>
        <label>Método <input name="method" placeholder="ex.: Transferência bancária" /></label>
        <label>Referência <input name="reference" placeholder="ex.: sinal, 2º pagamento..." /></label>
      </div>
      <button class="btn mini-action" type="submit">Registar recebimento</button>
      <p class="customer-form-message payment-message"></p>
    </form>`;

  panel.querySelector('.invoice-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button[type="submit"]');
    const msg = panel.querySelector('.invoice-message');
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

  panel.querySelector('.payment-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button[type="submit"]');
    const msg = panel.querySelector('.payment-message');
    btn.disabled = true;
    btn.textContent = 'A registar...';
    try {
      await api('/api/admin/reservations/payments', {
        method: 'POST',
        body: JSON.stringify({ reservationId: reservation.id, amount: f.amount.value, method: f.method.value, reference: f.reference.value })
      });
      await reload();
    } catch (err) {
      msg.textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Registar recebimento';
    }
  });
}
