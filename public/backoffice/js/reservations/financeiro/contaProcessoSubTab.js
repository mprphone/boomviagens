// Sub-separador "Conta do Processo": a conta-corrente da viagem - o que
// se vendeu, o que se recebeu, o que se comprou, o que se pagou, o
// resultado (margem) e o IVA estimado, mais um extrato simples dos
// movimentos (faturas emitidas, recebimentos, pagamentos a fornecedores).

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

export function renderContaProcessoSubTab(panel, reservation, reload, data = {}) {
  const lines = data.serviceLines || [];
  const payments = data.payments || [];
  const documents = data.documents || [];
  const offer = reservation.offer || {};

  const totals = computeServiceTotals(lines);
  const hasRealValues = lines.length > 0;
  const activeLines = lines.filter(l => l.status !== 'CANCELADO');

  const vendaTotal = offer.finalPrice || 0;
  const faturado = documents.filter(d => d.type === 'INVOICE_SALE').reduce((sum, d) => sum + (Number(d.amount) || 0), 0) || vendaTotal;
  const recebido = payments.filter(p => p.status === 'PAID').reduce((sum, p) => sum + (p.amount || 0), 0);
  const porReceber = Math.max(0, vendaTotal - recebido);

  const compras = hasRealValues ? totals.netTotal : (Number(offer.costPrice) || 0);
  const pago = activeLines.filter(l => l.paid).reduce((sum, l) => sum + (Number(l.netValue) || 0) * (Number(l.quantity) || 1), 0);
  const porPagar = Math.max(0, compras - pago);

  const margin = hasRealValues ? totals.margin : Number(offer.marginValue ?? (vendaTotal - compras));
  const marginPercent = vendaTotal ? (margin / vendaTotal) * 100 : 0;
  const vatRegime = reservation.vatRegime || 'MARGEM';
  const { vatAmount } = marginSchemeVat(margin);

  // Extrato simples: faturas emitidas + recebimentos (+) e servicos pagos
  // a fornecedores (-), ordenado por data.
  const movements = [
    ...documents.filter(d => d.type === 'INVOICE_SALE').map(d => ({ date: d.documentDate || d.createdAt, label: `Fatura ao cliente${d.documentNumber ? ` ${d.documentNumber}` : ''}`, amount: Number(d.amount) || 0 })),
    ...payments.filter(p => p.status === 'PAID').map(p => ({ date: p.paidAt || p.createdAt, label: `Recebimento (${p.method})`, amount: p.amount })),
    ...activeLines.filter(l => l.paid).map(l => ({ date: l.paidAt || l.updatedAt || l.createdAt, label: `Pagamento a ${l.supplierName || l.description}`, amount: -((Number(l.netValue) || 0) * (Number(l.quantity) || 1)) }))
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  panel.innerHTML = `
    <div class="account-columns">
      <div>
        <p class="summary-block-label" style="margin-top:0">Cliente</p>
        <div class="summary-financial-grid">
          <div class="summary-financial-block"><span class="muted small">Venda total</span><strong>${money(vendaTotal)}</strong></div>
          <div class="summary-financial-block"><span class="muted small">Faturado</span><strong>${money(faturado)}</strong></div>
          <div class="summary-financial-block"><span class="muted small">Recebido</span><strong>${money(recebido)}</strong></div>
          <div class="summary-financial-block"><span class="muted small">Por receber</span><strong>${money(porReceber)}</strong></div>
        </div>
      </div>
      <div>
        <p class="summary-block-label" style="margin-top:0">Fornecedores</p>
        <div class="summary-financial-grid">
          <div class="summary-financial-block"><span class="muted small">Compras (custo)</span><strong>${money(compras)}</strong></div>
          <div class="summary-financial-block"><span class="muted small">Pago</span><strong>${money(pago)}</strong></div>
          <div class="summary-financial-block"><span class="muted small">Por pagar</span><strong>${money(porPagar)}</strong></div>
        </div>
      </div>
    </div>

    <p class="summary-block-label">Resultado do processo</p>
    <div class="summary-financial-grid">
      <div class="summary-financial-block"><span class="muted small">Margem</span><strong>${money(margin)}</strong></div>
      <div class="summary-financial-block"><span class="muted small">Margem %</span><strong>${marginPercent.toFixed(2)}%</strong></div>
      <div class="summary-financial-block"><span class="muted small">IVA estimado</span><strong>${vatRegime === 'MARGEM' ? money(vatAmount) : '—'}</strong></div>
    </div>

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
          <p>O IVA incide só sobre a margem, à taxa normal (23%), já incluído no seu valor. Valor indicativo para gestão interna - a fatura oficial é sempre emitida em software certificado pela AT.</p>
        </div>
      </details>` : ''}

    <p class="summary-block-label">Recebimento manual</p>
    <form class="payment-form">
      <div class="customer-profile-grid">
        <label>Valor (€) <input type="number" name="amount" min="0.01" step="0.01" required /></label>
        <label>Método <input name="method" placeholder="ex.: Transferência bancária" /></label>
        <label>Referência <input name="reference" placeholder="ex.: sinal, 2º pagamento..." /></label>
      </div>
      <button class="btn mini-action" type="submit">Registar recebimento</button>
      <p class="customer-form-message"></p>
    </form>

    <p class="summary-block-label">Movimentos da conta</p>
    <div class="account-movements">
      ${movements.map(m => `
        <div class="account-movement-row">
          <span class="muted small">${m.date ? new Date(m.date).toLocaleDateString('pt-PT') : ''}</span>
          <span>${esc(m.label)}</span>
          <b class="${m.amount < 0 ? 'margin-diff-negative' : 'margin-diff-positive'}">${m.amount >= 0 ? '+' : ''}${money(m.amount)}</b>
        </div>`).join('') || '<p class="empty-note">Sem movimentos registados.</p>'}
    </div>`;

  panel.querySelector('.vat-regime-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button[type="submit"]');
    const msg = f.querySelector('.customer-form-message');
    btn.disabled = true;
    btn.textContent = 'A guardar...';
    try {
      await api('/api/admin/reservations/invoice', { method: 'POST', body: JSON.stringify({ reservationId: reservation.id, vatRegime: f.vatRegime.value }) });
      await reload('conta');
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
    const msg = f.querySelector('.customer-form-message');
    btn.disabled = true;
    btn.textContent = 'A registar...';
    try {
      await api('/api/admin/reservations/payments', {
        method: 'POST',
        body: JSON.stringify({ reservationId: reservation.id, amount: f.amount.value, method: f.method.value, reference: f.reference.value })
      });
      await reload('conta');
    } catch (err) {
      msg.textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Registar recebimento';
    }
  });
}
