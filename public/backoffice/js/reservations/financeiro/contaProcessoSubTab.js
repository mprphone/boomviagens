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

// So a linha regime MARGEM tem calculo de IVA implementado (extracao dos
// 23% sobre a margem da propria linha) - ISENTO conta 0, NORMAL/REDUZIDA
// ainda nao tem calculo real (mesma limitacao que ja existia a nivel do
// processo inteiro, so passa a ser aplicada por linha).
function lineVatAmount(line, reservationVatRegime) {
  const effectiveRegime = line.vatRegime || (line.type === 'SEGURO' ? 'ISENTO' : reservationVatRegime);
  if (effectiveRegime !== 'MARGEM') return 0;
  const net = (Number(line.netValue) || 0) * (Number(line.quantity) || 1);
  const gross = (Number(line.pvpValue) || 0) * (Number(line.quantity) || 1);
  const discount = gross * (Number(line.discountPercent) || 0) / 100;
  return marginSchemeVat((gross - discount) - net).vatAmount;
}

// Diferenca de uma fase da margem (confirmada/final) face a prevista -
// so mostra algo quando as duas existem, para nao sugerir um desvio de 0
// quando na verdade a fase ainda nao foi registada.
function marginDiff(value, base) {
  if (value === undefined || value === null || base === undefined || base === null) return '';
  const diff = Number((value - base).toFixed(2));
  if (!diff) return '<div class="muted small">= prevista</div>';
  return `<div class="muted small ${diff > 0 ? 'margin-diff-positive' : 'margin-diff-negative'}">${diff > 0 ? '+' : ''}${money(diff)} vs. prevista</div>`;
}

export function renderContaProcessoSubTab(panel, reservation, reload, data = {}) {
  const lines = data.serviceLines || [];
  const payments = data.payments || [];
  const documents = data.documents || [];
  const refunds = data.refunds || [];
  const offer = reservation.offer || {};

  const totals = computeServiceTotals(lines);
  const hasRealValues = lines.length > 0;
  const activeLines = lines.filter(l => l.status !== 'CANCELADO');

  const vendaTotal = offer.finalPrice || 0;
  const faturado = documents.filter(d => d.type === 'INVOICE_SALE').reduce((sum, d) => sum + (Number(d.amount) || 0), 0) || vendaTotal;
  const recebido = payments.filter(p => p.status === 'PAID').reduce((sum, p) => sum + (p.amount || 0), 0);
  const porReceber = Math.max(0, vendaTotal - recebido);

  const compras = hasRealValues ? totals.netTotal : (Number(offer.costPrice) || 0);
  // Pagamentos em tranches: "pago" e a soma de tudo o que ja foi
  // liquidado a cada fornecedor, mesmo quando uma linha ainda nao esta
  // 100% paga - ver domain.js#enrichServiceLinesWithPayments.
  const pago = activeLines.reduce((sum, l) => sum + (Number(l.paidAmount) || 0), 0);
  const porPagar = Math.max(0, compras - pago);

  const margin = hasRealValues ? totals.margin : Number(offer.marginValue ?? (vendaTotal - compras));
  const marginPercent = vendaTotal ? (margin / vendaTotal) * 100 : 0;
  const vatRegime = reservation.vatRegime || 'MARGEM';
  const vatAmount = Number(activeLines.reduce((sum, l) => sum + lineVatAmount(l, vatRegime), 0).toFixed(2));

  const marginPrevista = offer.marginValue;
  const marginConfirmada = reservation.marginConfirmed;
  const marginFinal = reservation.marginFinal;

  // Extrato simples: faturas emitidas + recebimentos (+), pagamentos a
  // fornecedores (-, um por cada tranche registada) e reembolsos/notas de
  // credito (nota de credito do fornecedor = +, reembolso ao cliente = -),
  // ordenado por data.
  const movements = [
    ...documents.filter(d => d.type === 'INVOICE_SALE').map(d => ({ date: d.documentDate || d.createdAt, label: `Fatura ao cliente${d.documentNumber ? ` ${d.documentNumber}` : ''}`, amount: Number(d.amount) || 0 })),
    ...payments.filter(p => p.status === 'PAID').map(p => ({ date: p.paidAt || p.createdAt, label: `Recebimento (${p.method})`, amount: p.amount })),
    ...activeLines.flatMap(l => (l.payments || []).map(p => ({ date: p.paidAt, label: `Pagamento a ${l.supplierName || l.description}${p.method ? ` (${p.method})` : ''}`, amount: -(Number(p.amount) || 0) }))),
    ...refunds.map(r => ({ date: r.createdAt, label: `${r.direction === 'CUSTOMER_REFUND' ? 'Reembolso ao cliente' : 'Nota de crédito do fornecedor'}${r.reason ? ` (${r.reason})` : ''}`, amount: r.direction === 'CUSTOMER_REFUND' ? -Math.abs(r.amount) : Math.abs(r.amount) }))
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
      <div class="summary-financial-block"><span class="muted small">Margem (linhas de hoje)</span><strong>${money(margin)}</strong></div>
      <div class="summary-financial-block"><span class="muted small">Margem %</span><strong>${marginPercent.toFixed(2)}%</strong></div>
      <div class="summary-financial-block"><span class="muted small">IVA estimado</span><strong>${money(vatAmount)}</strong></div>
    </div>

    <p class="summary-block-label">Margem em 3 fases</p>
    <div class="summary-financial-grid">
      <div class="summary-financial-block">
        <span class="muted small">Prevista</span>
        <strong>${marginPrevista !== undefined && marginPrevista !== null ? money(marginPrevista) : '—'}</strong>
        <div class="muted small">Da proposta aceite</div>
      </div>
      <div class="summary-financial-block">
        <span class="muted small">Confirmada${reservation.marginConfirmedAt ? ` · ${new Date(reservation.marginConfirmedAt).toLocaleDateString('pt-PT')}` : ''}</span>
        <strong>${marginConfirmada !== undefined && marginConfirmada !== null ? money(marginConfirmada) : '—'}</strong>
        ${marginDiff(marginConfirmada, marginPrevista)}
      </div>
      <div class="summary-financial-block">
        <span class="muted small">Final${reservation.marginFinalAt ? ` · ${new Date(reservation.marginFinalAt).toLocaleDateString('pt-PT')}` : ''}</span>
        <strong>${marginFinal !== undefined && marginFinal !== null ? money(marginFinal) : '—'}</strong>
        ${marginDiff(marginFinal, marginPrevista)}
      </div>
    </div>
    <div class="service-line-form-actions">
      <button type="button" class="ghost mini-action margin-snapshot-btn" data-stage="confirmed">Confirmar margem de compra</button>
      <button type="button" class="ghost mini-action margin-snapshot-btn" data-stage="final">Fechar margem final</button>
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

  panel.querySelectorAll('.margin-snapshot-btn').forEach(btn => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await api('/api/admin/reservations/margin-snapshot', { method: 'POST', body: JSON.stringify({ reservationId: reservation.id, stage: btn.dataset.stage }) });
        await reload('conta');
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    };
  });
}
