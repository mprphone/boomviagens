// Sub-separador "Faturas e Documentos": os documentos financeiros deste
// processo, separados por direção - o que foi emitido ao cliente (fatura,
// recibo, nota de crédito) e o que os fornecedores emitiram (fatura de
// compra, ligada à reserva/serviço a que corresponde). Nunca gera nada -
// só regista a referência do que foi emitido em software certificado,
// com o anexo do documento em si.

import { esc, money, api } from '../../utils.js';

const CUSTOMER_DOC_TYPES = [
  { value: 'INVOICE_SALE', label: 'Fatura' },
  { value: 'RECEIPT', label: 'Recibo' },
  { value: 'CREDIT_NOTE', label: 'Nota de crédito' }
];
const CUSTOMER_DOC_TYPE_VALUES = new Set(CUSTOMER_DOC_TYPES.map(t => t.value));

export function renderFaturasDocumentosSubTab(panel, reservation, reload, data = {}) {
  const documents = data.documents || [];
  const lines = data.serviceLines || [];
  const customerDocs = documents.filter(d => CUSTOMER_DOC_TYPE_VALUES.has(d.type) && !d.serviceLineId);
  const supplierDocs = documents.filter(d => d.type === 'INVOICE_PURCHASE');

  panel.innerHTML = `
    <p class="summary-block-label" style="margin-top:0">Documentos ao cliente</p>
    <div class="bo-table-wrap">
      <table class="bo-table">
        <thead><tr><th>Tipo</th><th>Nº Documento</th><th>Data</th><th>Valor</th><th>Anexo</th><th></th></tr></thead>
        <tbody>
          ${customerDocs.map(d => `
            <tr>
              <td>${esc(CUSTOMER_DOC_TYPES.find(t => t.value === d.type)?.label || d.type)}</td>
              <td class="muted small">${esc(d.documentNumber || '—')}</td>
              <td class="muted small">${esc(d.documentDate || '')}</td>
              <td>${d.amount ? money(d.amount) : '—'}</td>
              <td><a href="${esc(d.signedUrl)}" target="_blank" rel="noopener">📎 ${esc(d.fileName)}</a></td>
              <td><button type="button" class="icon-action fin-doc-delete" data-doc="${d.id}" title="Remover">🗑</button></td>
            </tr>`).join('') || `<tr><td colspan="6" class="empty-note">Sem documentos registados ao cliente.</td></tr>`}
        </tbody>
      </table>
    </div>
    <form class="fin-doc-form" data-direction="customer">
      <p class="service-line-form-title">+ Adicionar documento ao cliente</p>
      <div class="customer-profile-grid">
        <label>Tipo <select name="type">${CUSTOMER_DOC_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}</select></label>
        <label>Nº Documento <input name="documentNumber" placeholder="ex.: FAD 23200137" /></label>
        <label>Data <input type="date" name="documentDate" /></label>
        <label>Valor (€) <input type="number" name="amount" min="0" step="0.01" /></label>
      </div>
      <input type="file" class="fin-doc-file" required>
      <button type="submit" class="ghost mini-action">Anexar</button>
      <p class="customer-form-message"></p>
    </form>

    <p class="summary-block-label">Documentos de fornecedores</p>
    <div class="bo-table-wrap">
      <table class="bo-table">
        <thead><tr><th>Fornecedor</th><th>Serviço</th><th>Valor</th><th>Pago</th><th>Saldo</th><th>Anexos</th><th></th></tr></thead>
        <tbody>
          ${lines.filter(l => l.status !== 'CANCELADO').map(l => {
            const docs = supplierDocs.filter(d => d.serviceLineId === l.id);
            const value = (Number(l.netValue) || 0) * (Number(l.quantity) || 1);
            return `
            <tr data-line="${esc(l.id)}">
              <td>${esc(l.supplierName || '—')}</td>
              <td>${esc(l.description)}</td>
              <td>${money(value)}</td>
              <td>${l.paid ? `<span class="pill pill-ok">${money(value)}</span>` : '<span class="pill pill-warning">0,00 €</span>'}</td>
              <td>${l.paid ? money(0) : money(value)}</td>
              <td>${docs.map(d => `<a href="${esc(d.signedUrl)}" target="_blank" rel="noopener" class="pill">📎 ${esc(d.documentNumber || d.fileName)}</a>`).join(' ') || '<span class="muted small">Sem anexo</span>'}</td>
              <td><button type="button" class="icon-action fin-doc-attach" title="Anexar fatura">+📎</button></td>
            </tr>`;
          }).join('') || `<tr><td colspan="7" class="empty-note">Sem serviços com fornecedor registados.</td></tr>`}
        </tbody>
      </table>
    </div>
    <form class="fin-doc-form fin-doc-supplier-form" data-direction="supplier" hidden>
      <input type="hidden" name="serviceLineId" />
      <p class="service-line-form-title">Anexar fatura de fornecedor</p>
      <div class="customer-profile-grid">
        <label>Nº Documento <input name="documentNumber" placeholder="ex.: INV 45821" /></label>
        <label>Data <input type="date" name="documentDate" /></label>
        <label>Valor (€) <input type="number" name="amount" min="0" step="0.01" /></label>
      </div>
      <input type="file" class="fin-doc-file" required>
      <div class="service-line-form-actions">
        <button type="submit" class="ghost mini-action">Anexar</button>
        <button type="button" class="ghost mini-action fin-doc-supplier-cancel">Cancelar</button>
      </div>
      <p class="customer-form-message"></p>
    </form>`;

  panel.querySelectorAll('.fin-doc-delete').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Remover este documento?')) return;
      try {
        await api('/api/admin/documents/delete', { method: 'POST', body: JSON.stringify({ documentId: btn.dataset.doc }) });
        await reload('faturas');
      } catch (err) { alert(err.message); }
    };
  });

  panel.querySelector('.fin-doc-form[data-direction=customer]').onsubmit = async ev => {
    ev.preventDefault();
    await submitFinDoc(ev.target, {});
  };

  const supplierForm = panel.querySelector('.fin-doc-supplier-form');
  panel.querySelectorAll('.fin-doc-attach').forEach(btn => {
    btn.onclick = () => {
      supplierForm.serviceLineId.value = btn.closest('tr').dataset.line;
      supplierForm.hidden = false;
      supplierForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
  });
  panel.querySelector('.fin-doc-supplier-cancel').onclick = () => { supplierForm.hidden = true; supplierForm.reset(); };
  supplierForm.onsubmit = async ev => {
    ev.preventDefault();
    await submitFinDoc(ev.target, { type: 'INVOICE_PURCHASE', serviceLineId: ev.target.serviceLineId.value });
  };

  async function submitFinDoc(form, extra) {
    const fileInput = form.querySelector('.fin-doc-file');
    const file = fileInput.files[0];
    if (!file) return;
    const btn = form.querySelector('button[type=submit]');
    const msg = form.querySelector('.customer-form-message');
    btn.disabled = true;
    btn.textContent = 'A anexar...';
    try {
      const fileBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await api('/api/admin/documents/upload', {
        method: 'POST',
        body: JSON.stringify({
          reservationId: reservation.id,
          type: extra.type || form.type.value,
          serviceLineId: extra.serviceLineId,
          documentNumber: form.documentNumber.value,
          documentDate: form.documentDate.value,
          amount: form.amount.value || undefined,
          fileName: file.name,
          mimeType: file.type,
          fileBase64
        })
      });
      await reload('faturas');
    } catch (err) {
      msg.textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Anexar';
    }
  }
}
