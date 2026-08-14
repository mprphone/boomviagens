// Separador "Documentos": documentos anexados especificamente a esta
// reserva (passaporte/CC, seguro, outros) - mesma logica que ja existia,
// agora dentro da Ficha de Reserva por separadores. Cada documento pode
// ainda ficar ligado a uma linha de servico especifica (ex.: o voucher do
// hotel, o bilhete de aviao) - ver ./serviceLinesTab.js.

import { esc, api } from '../utils.js';

export async function renderDocumentsTab(panel, reservation, reload, ctx = {}) {
  const serviceLines = ctx.services?.serviceLines || [];
  const serviceLineLabel = lineId => {
    const line = serviceLines.find(l => l.id === lineId);
    return line ? line.description : '';
  };

  panel.innerHTML = '<p class="muted">A carregar...</p>';
  let documents;
  try {
    const data = await api(`/api/admin/documents?reservationId=${encodeURIComponent(reservation.id)}`);
    documents = data.documents;
  } catch (err) {
    panel.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }

  panel.innerHTML = `
    <div class="doc-list">
      ${documents.map(d => `
        <div class="doc-item">
          <span class="doc-type">${d.type === 'PASSPORT' ? 'Passaporte/CC' : d.type === 'INSURANCE' ? 'Seguro' : 'Outro'}</span>
          ${d.passengerName ? `<span class="muted">${esc(d.passengerName)}</span>` : ''}
          ${d.serviceLineId ? `<span class="pill">${esc(serviceLineLabel(d.serviceLineId))}</span>` : ''}
          <span class="muted">${esc(d.fileName)}</span>
          <a href="${esc(d.signedUrl)}" target="_blank" rel="noopener">Ver</a>
          <button class="ghost mini-action doc-delete" data-doc="${d.id}">Remover</button>
        </div>`).join('') || '<div class="muted">Sem documentos anexados a esta reserva.</div>'}
    </div>
    <form class="doc-upload-form">
      <select class="doc-type-select">
        <option value="PASSPORT">Passaporte/Cartão de cidadão</option>
        <option value="INSURANCE">Seguro de viagem</option>
        <option value="OTHER">Outro</option>
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
