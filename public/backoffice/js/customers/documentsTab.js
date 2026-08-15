// Separador "Documentos": documentos pessoais do cliente/agregado familiar
// (passaporte, CC, visto...), organizados por titular/tipo/validade - com
// alerta quando um documento esta perto de expirar - e, abaixo, um resumo
// so de leitura dos documentos financeiros (faturas/recibos) de todas as
// reservas do cliente, cada um ja ligado ao seu processo. "+ Adicionar
// documento" abre uma gaveta lateral em vez de um formulario sempre
// visivel - mesmo padrao usado no resto da ficha.

import { esc, api } from '../utils.js';
import { openDrawer, closeDrawer } from '../drawer.js';

const DOC_TYPE_LABELS = { PASSPORT: 'Passaporte/CC', VISA: 'Visto', INSURANCE: 'Seguro', OTHER: 'Outro' };
const DOC_TYPE_ICON = { PASSPORT: '🛂', VISA: '📄', INSURANCE: '🛡️', OTHER: '📎' };
const FINANCIAL_TYPE_LABELS = { INVOICE_SALE: 'Fatura', RECEIPT: 'Recibo', CREDIT_NOTE: 'Nota de crédito' };
const FINANCIAL_TYPE_ICON = { INVOICE_SALE: '🧾', RECEIPT: '💶', CREDIT_NOTE: '↩️' };

function expiryPill(dateStr) {
  if (!dateStr) return '<span class="muted">—</span>';
  const months = (new Date(dateStr) - new Date()) / (1000 * 60 * 60 * 24 * 30);
  const cls = months < 6 ? 'pill-warning' : 'pill-ok';
  const label = months < 0 ? `expirou em ${esc(dateStr)}` : `válido até ${esc(dateStr)}`;
  return `<span class="pill ${cls}">${label}</span>`;
}

export function renderDocumentsTab(panel, data, email, reload) {
  const documents = data.documents || [];
  const financialDocuments = data.financialDocuments || [];

  panel.innerHTML = `
    <div class="tab-toolbar">
      <p class="summary-block-label" style="margin:0">Documentos pessoais</p>
      <button type="button" class="btn mini-action doc-add">+ Adicionar documento</button>
    </div>
    <div class="bo-table-wrap">
      <table class="bo-table doc-table">
        <thead><tr><th>Titular</th><th>Tipo</th><th>Nº documento</th><th>Validade</th><th>País emissor</th><th>Anexo</th><th></th></tr></thead>
        <tbody>
          ${documents.map(d => `
            <tr>
              <td>${esc(d.passengerName || data.customer.name)}</td>
              <td>${DOC_TYPE_ICON[d.type] || ''} ${DOC_TYPE_LABELS[d.type] || d.type}</td>
              <td>${esc(d.documentNumber || '—')}</td>
              <td>${expiryPill(d.expiryDate)}</td>
              <td>${esc(d.issuingCountry || '—')}</td>
              <td><a class="doc-file-chip" href="${esc(d.signedUrl)}" target="_blank" rel="noopener">📎 ${esc(d.fileName)}</a></td>
              <td><button class="ghost mini-action doc-delete" data-doc="${d.id}">Remover</button></td>
            </tr>`).join('') || '<tr><td colspan="7" class="empty-note">Sem documentos pessoais guardados.</td></tr>'}
        </tbody>
      </table>
    </div>

    <p class="summary-block-label">Documentos financeiros</p>
    <div class="bo-table-wrap">
      <table class="bo-table doc-table">
        <thead><tr><th>Processo</th><th>Tipo</th><th>Nº documento</th><th>Data</th><th>Valor</th><th>Anexo</th></tr></thead>
        <tbody>
          ${financialDocuments.map(d => `
            <tr>
              <td>${esc(d.processNumber || '')}</td>
              <td>${FINANCIAL_TYPE_ICON[d.type] || ''} ${FINANCIAL_TYPE_LABELS[d.type] || d.type}</td>
              <td>${esc(d.documentNumber || '—')}</td>
              <td>${esc(d.documentDate || '—')}</td>
              <td>${d.amount != null ? new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(d.amount) : '—'}</td>
              <td><a class="doc-file-chip" href="${esc(d.signedUrl)}" target="_blank" rel="noopener">📎 ${esc(d.fileName)}</a></td>
            </tr>`).join('') || '<tr><td colspan="6" class="empty-note">Sem documentos financeiros nas reservas deste cliente.</td></tr>'}
        </tbody>
      </table>
    </div>`;

  panel.querySelectorAll('.doc-delete').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Remover este documento?')) return;
      try {
        await api('/api/admin/documents/delete', { method: 'POST', body: JSON.stringify({ documentId: btn.dataset.doc }) });
        await reload();
      } catch (err) { alert(err.message); }
    };
  });

  panel.querySelector('.doc-add').onclick = () => openDocumentDrawer();

  function openDocumentDrawer() {
    const body = openDrawer('Adicionar documento');
    body.innerHTML = `
      <form class="document-upload-form">
        <div class="drawer-form-fields">
          <label>Tipo
            <select name="type">${Object.entries(DOC_TYPE_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
          </label>
          <label>Titular <input type="text" name="passengerName" placeholder="ex.: filho, cônjuge (vazio = o próprio cliente)" /></label>
          <label>Nº documento <input type="text" name="documentNumber" /></label>
          <label>Validade <input type="date" name="expiryDate" /></label>
          <label>País emissor <input type="text" name="issuingCountry" placeholder="ex.: Portugal" /></label>
        </div>
        <label class="service-line-notes">Ficheiro <input type="file" name="file" required /></label>
        <div class="service-line-form-actions">
          <button class="btn mini-action" type="submit">Anexar</button>
        </div>
        <p class="customer-form-message"></p>
      </form>`;

    body.querySelector('.document-upload-form').onsubmit = async ev => {
      ev.preventDefault();
      const f = ev.target;
      const file = f.file.files[0];
      if (!file) return;
      const btn = f.querySelector('button[type=submit]');
      const msg = body.querySelector('.customer-form-message');
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
            customerEmail: email,
            type: f.type.value,
            passengerName: f.passengerName.value,
            documentNumber: f.documentNumber.value,
            expiryDate: f.expiryDate.value,
            issuingCountry: f.issuingCountry.value,
            fileName: file.name,
            mimeType: file.type,
            fileBase64
          })
        });
        await reload();
        closeDrawer();
      } catch (err) {
        msg.textContent = err.message;
        btn.disabled = false;
        btn.textContent = 'Anexar';
      }
    };
  }
}
