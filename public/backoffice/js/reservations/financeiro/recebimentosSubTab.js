// Sub-separador "Recebimentos": o que o cliente ja pagou, e o saldo em
// falta. Os pagamentos do checkout entram automaticamente; um pagamento
// feito por fora (ex.: transferencia bancaria) pode ser registado aqui a
// mao.

import { esc, money, api } from '../../utils.js';

export function renderRecebimentosSubTab(panel, reservation, reload, data = {}) {
  const payments = data.payments || [];
  const totalPaid = payments.filter(p => p.status === 'PAID').reduce((sum, p) => sum + (p.amount || 0), 0);
  const dueFromCustomer = Math.max(0, (reservation.offer?.finalPrice || 0) - totalPaid);

  panel.innerHTML = `
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
      <p class="customer-form-message"></p>
    </form>`;

  panel.querySelector('.payment-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button[type="submit"]');
    const msg = panel.querySelector('.customer-form-message');
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
