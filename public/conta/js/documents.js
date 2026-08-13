// Vista "Documentos": uma reserva por bloco, com os documentos ja
// anexados e um formulario para anexar mais (passaporte/cartao de
// cidadao, seguro de viagem, outro). Mesma logica de sempre, agora
// self-service para o proprio cliente (rotas /api/customer/documents/*).

import { $, esc, api } from './utils.js';

export async function renderDocumentos() {
  const el = $('#view-documentos');
  el.innerHTML = '<p class="muted">A carregar...</p>';
  let data;
  try {
    data = await api('/api/customer/reservations');
  } catch (err) {
    el.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }
  const reservations = data.reservations.filter(r => r.status !== 'CANCELLED');
  if (!reservations.length) {
    el.innerHTML = '<p class="empty-note">Ainda não tem reservas para gerir documentos.</p>';
    return;
  }
  el.innerHTML = reservations.map(r => `
    <div class="doc-reservation" data-reservation="${esc(r.id)}">
      <div class="doc-reservation-head">
        <b>${esc(r.offer?.hotel || r.id)}</b>
        <span>${esc(r.offer?.destination || '')}</span>
      </div>
      ${r.missingDocuments?.length ? `<div class="doc-missing-note">Falta: ${esc(r.missingDocuments.join(', '))}</div>` : ''}
      <div class="doc-list" data-list></div>
      <form class="doc-upload-form">
        <select class="doc-type-select">
          <option value="PASSPORT">Passaporte/Cartão de cidadão</option>
          <option value="INSURANCE">Seguro de viagem</option>
          <option value="OTHER">Outro</option>
        </select>
        <input type="text" class="doc-passenger-name" placeholder="Nome do passageiro">
        <input type="file" class="doc-file-input" required>
        <button type="submit" class="ghost mini-action">Anexar</button>
      </form>
    </div>`).join('');

  reservations.forEach(r => loadDocs(r.id));

  document.querySelectorAll('.doc-reservation').forEach(block => {
    const reservationId = block.dataset.reservation;
    const typeSelect = block.querySelector('.doc-type-select');
    const passengerInput = block.querySelector('.doc-passenger-name');
    const toggleField = () => { passengerInput.hidden = typeSelect.value !== 'PASSPORT'; };
    typeSelect.onchange = toggleField;
    toggleField();

    block.querySelector('.doc-upload-form').onsubmit = async ev => {
      ev.preventDefault();
      const fileInput = block.querySelector('.doc-file-input');
      const file = fileInput.files[0];
      if (!file) return;
      const fileBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      try {
        await api('/api/customer/documents/upload', {
          method: 'POST',
          body: JSON.stringify({
            reservationId,
            type: typeSelect.value,
            passengerName: typeSelect.value === 'PASSPORT' ? passengerInput.value : undefined,
            fileName: file.name,
            mimeType: file.type,
            fileBase64
          })
        });
        fileInput.value = '';
        passengerInput.value = '';
        await loadDocs(reservationId);
      } catch (err) { alert(err.message); }
    };
  });
}

async function loadDocs(reservationId) {
  const block = document.querySelector(`.doc-reservation[data-reservation="${reservationId}"] [data-list]`);
  if (!block) return;
  block.innerHTML = 'A carregar...';
  try {
    const data = await api(`/api/customer/documents?reservationId=${encodeURIComponent(reservationId)}`);
    block.innerHTML = data.documents.map(d => `
      <div class="doc-item">
        <span class="doc-type">${d.type === 'PASSPORT' ? 'Passaporte/CC' : d.type === 'INSURANCE' ? 'Seguro' : 'Outro'}</span>
        ${d.passengerName ? `<span class="muted">${esc(d.passengerName)}</span>` : ''}
        <span class="muted">${esc(d.fileName)}</span>
        <a href="${esc(d.signedUrl)}" target="_blank" rel="noopener">Ver</a>
        <button class="ghost mini-action doc-delete" data-doc="${d.id}">Remover</button>
      </div>`).join('') || '<span class="muted">Sem documentos anexados.</span>';

    block.querySelectorAll('.doc-delete').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Remover este documento?')) return;
        try {
          await api('/api/customer/documents/delete', { method: 'POST', body: JSON.stringify({ documentId: btn.dataset.doc }) });
          await loadDocs(reservationId);
        } catch (err) { alert(err.message); }
      };
    });
  } catch (err) {
    block.innerHTML = `<span class="error">${esc(err.message)}</span>`;
  }
}
