// Separador "Documentos": arquivo de documentos do cliente e do agregado
// familiar, reutilizavel entre reservas - ao contrario dos documentos
// anexados a uma reserva especifica (ver reservations.js), estes nao
// exigem nenhuma reserva para existir.

import { esc, api } from '../utils.js';

export function renderDocumentsTab(panel, data, email, reload) {
  panel.innerHTML = `
    <div class="doc-list">
      ${data.documents.map(d => `
        <div class="doc-item">
          <span class="doc-type">${d.type === 'PASSPORT' ? 'Passaporte/CC' : d.type === 'INSURANCE' ? 'Seguro' : 'Outro'}</span>
          ${d.passengerName ? `<span class="muted">${esc(d.passengerName)}</span>` : ''}
          <span class="muted">${esc(d.fileName)}</span>
          <a href="${esc(d.signedUrl)}" target="_blank" rel="noopener">Ver</a>
          <button class="ghost mini-action doc-delete" data-doc="${d.id}">Remover</button>
        </div>`).join('') || '<div class="muted">Sem documentos guardados para este cliente/agregado.</div>'}
    </div>
    <form class="doc-upload-form">
      <select class="doc-type-select">
        <option value="PASSPORT">Passaporte/Cartão de cidadão</option>
        <option value="INSURANCE">Seguro de viagem</option>
        <option value="OTHER">Outro</option>
      </select>
      <input type="text" class="doc-passenger-name" placeholder="Nome da pessoa (ex.: filho, cônjuge)">
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

  panel.querySelector('.doc-upload-form').onsubmit = async ev => {
    ev.preventDefault();
    const fileInput = panel.querySelector('.doc-file-input');
    const typeSelect = panel.querySelector('.doc-type-select');
    const passengerInput = panel.querySelector('.doc-passenger-name');
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
      await api('/api/admin/documents/upload', {
        method: 'POST',
        body: JSON.stringify({
          customerEmail: email,
          type: typeSelect.value,
          passengerName: passengerInput.value,
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
