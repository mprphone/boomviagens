// Separador "Documentos": a pasta documental completa do processo,
// agrupada por categoria (cliente, reserva, financeiro, viagem,
// ocorrências) - mesma logica que ja existia, agora dentro da Ficha de
// Reserva por separadores. Cada documento pode ainda ficar ligado a uma
// linha de servico especifica (ex.: o voucher do hotel, o bilhete de
// aviao) - ver ./serviceLinesTab.js.

import { esc, api } from '../utils.js';

const DOC_TYPES = [
  { value: 'PASSPORT', label: 'Passaporte', group: 'Cliente' },
  { value: 'IDENTITY_CARD', label: 'Cartão de Cidadão', group: 'Cliente' },
  { value: 'VISA', label: 'Visto', group: 'Cliente' },
  { value: 'INSURANCE', label: 'Seguro de viagem', group: 'Reserva' },
  { value: 'VOUCHER', label: 'Voucher', group: 'Reserva' },
  { value: 'TICKET', label: 'Bilhete', group: 'Reserva' },
  { value: 'INVOICE_PURCHASE', label: 'Fatura de compra', group: 'Financeiro' },
  { value: 'INVOICE_SALE', label: 'Fatura de venda', group: 'Financeiro' },
  { value: 'RECEIPT', label: 'Recibo/comprovativo', group: 'Financeiro' },
  { value: 'ITINERARY', label: 'Itinerário/programa', group: 'Viagem' },
  { value: 'OCCURRENCE_PHOTO', label: 'Foto de ocorrência', group: 'Ocorrências' },
  { value: 'OTHER', label: 'Outro', group: 'Viagem' }
];
const DOC_TYPE_LABEL = Object.fromEntries(DOC_TYPES.map(t => [t.value, t.label]));

export function renderDocumentsTab(panel, reservation, reload, detail = {}) {
  const serviceLines = detail.serviceLines || [];
  const documents = detail.documents || [];
  const serviceLineLabel = lineId => serviceLines.find(l => l.id === lineId)?.description || '';

  panel.innerHTML = `
    <div class="doc-list">
      ${documents.map(d => `
        <div class="doc-item">
          <span class="doc-type">${esc(DOC_TYPE_LABEL[d.type] || d.type)}</span>
          ${d.passengerName ? `<span class="muted">${esc(d.passengerName)}</span>` : ''}
          ${d.serviceLineId ? `<span class="pill">${esc(serviceLineLabel(d.serviceLineId))}</span>` : ''}
          <span class="muted">${esc(d.fileName)}</span>
          <a href="${esc(d.signedUrl)}" target="_blank" rel="noopener">Ver</a>
          <button class="ghost mini-action doc-delete" data-doc="${d.id}">Remover</button>
        </div>`).join('') || '<div class="muted">Sem documentos anexados a este processo.</div>'}
    </div>
    <form class="doc-upload-form">
      <select class="doc-type-select">
        ${['Cliente', 'Reserva', 'Financeiro', 'Viagem', 'Ocorrências'].map(group => `
          <optgroup label="${group}">
            ${DOC_TYPES.filter(t => t.group === group).map(t => `<option value="${t.value}">${t.label}</option>`).join('')}
          </optgroup>`).join('')}
      </select>
      <input type="text" class="doc-passenger-name" placeholder="Nome do passageiro">
      ${serviceLines.length ? `
        <select class="doc-service-line-select">
          <option value="">Sem associação a serviço específico</option>
          ${serviceLines.map(l => `<option value="${esc(l.id)}">${esc(l.description)}</option>`).join('')}
        </select>` : ''}
      <input type="file" class="doc-file-input" required>
      <button type="submit" class="ghost mini-action">Anexar</button>
    </form>`;

  panel.querySelectorAll('.doc-delete').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Remover este documento?')) return;
      try {
        await api('/api/admin/documents/delete', { method: 'POST', body: JSON.stringify({ documentId: btn.dataset.doc }) });
        await reload();
      } catch (err) { alert(err.message); }
    };
  });

  const typeSelect = panel.querySelector('.doc-type-select');
  const passengerInput = panel.querySelector('.doc-passenger-name');
  const toggleField = () => { passengerInput.hidden = typeSelect.value !== 'PASSPORT'; };
  typeSelect.onchange = toggleField;
  toggleField();

  panel.querySelector('.doc-upload-form').onsubmit = async ev => {
    ev.preventDefault();
    const fileInput = panel.querySelector('.doc-file-input');
    const file = fileInput.files[0];
    if (!file) return;
    const submitBtn = ev.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'A anexar...';
    try {
      const fileBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const serviceLineSelect = panel.querySelector('.doc-service-line-select');
      await api('/api/admin/documents/upload', {
        method: 'POST',
        body: JSON.stringify({
          reservationId: reservation.id,
          type: typeSelect.value,
          passengerName: typeSelect.value === 'PASSPORT' ? passengerInput.value : undefined,
          serviceLineId: serviceLineSelect ? (serviceLineSelect.value || undefined) : undefined,
          fileName: file.name,
          mimeType: file.type,
          fileBase64
        })
      });
      await reload();
    } catch (err) {
      alert(err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Anexar';
    }
  };
}
