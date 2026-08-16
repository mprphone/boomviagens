// Vista "Documentos": uma seccao "Documentos da família" (sem reserva
// associada - passaporte de cada membro do agregado, reutilizavel em
// reservas futuras) e depois uma reserva por bloco com os documentos
// especificos dessa reserva. Mesma logica de sempre, self-service para o
// proprio cliente (rotas /api/customer/documents/*, com ou sem
// reservationId consoante o bloco).

import { $, esc, api } from './utils.js';

// Categorias visiveis ao cliente (ver domain.js#CUSTOMER_VISIBLE_DOCUMENT_TYPES
// no servidor - aqui e so o agrupamento visual do que a API ja devolve).
const CATEGORY_ORDER = ['IDENTIFICACAO', 'SEGURO', 'VOUCHERS', 'BILHETES', 'PROGRAMA', 'OUTROS'];
const CATEGORY_LABEL = { IDENTIFICACAO: 'Identificação', SEGURO: 'Seguro', VOUCHERS: 'Vouchers', BILHETES: 'Bilhetes', PROGRAMA: 'Programa', OUTROS: 'Outros' };
const TYPE_CATEGORY = { PASSPORT: 'IDENTIFICACAO', VISA: 'IDENTIFICACAO', INSURANCE: 'SEGURO', VOUCHER: 'VOUCHERS', TICKET: 'BILHETES', ITINERARY: 'PROGRAMA', OTHER: 'OUTROS' };
export const TYPE_LABEL = { PASSPORT: 'Passaporte/CC', VISA: 'Visto', INSURANCE: 'Seguro', VOUCHER: 'Voucher', TICKET: 'Bilhete', ITINERARY: 'Itinerário/programa', OTHER: 'Outro' };

export async function renderDocumentos() {
  const el = $('#view-documentos');
  el.innerHTML = '<p class="muted">A carregar...</p>';
  let reservationsData;
  try {
    reservationsData = await api('/api/customer/reservations');
  } catch (err) {
    el.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }
  const reservations = reservationsData.reservations.filter(r => r.status !== 'CANCELLED');

  el.innerHTML = `
    <div class="doc-reservation doc-family">
      <div class="doc-reservation-head">
        <b>Documentos da família</b>
        <span class="muted">Guardados uma vez, reutilizáveis em qualquer reserva futura</span>
      </div>
      <div class="doc-list" data-family-list></div>
      ${uploadFormHtml()}
    </div>
    ${reservations.length ? reservations.map(reservationBlockHtml).join('') : '<p class="empty-note">Ainda não tem reservas para gerir documentos específicos.</p>'}`;

  wireUploadForm(el.querySelector('.doc-family'), null);
  loadDocs(null, el.querySelector('.doc-family [data-family-list]'));

  reservations.forEach(r => {
    const block = el.querySelector(`.doc-reservation[data-reservation="${r.id}"]`);
    wireUploadForm(block, r.id);
    loadDocs(r.id, block.querySelector('[data-list]'));
  });
}

export function uploadFormHtml() {
  return `
    <form class="doc-upload-form">
      <select class="doc-type-select">
        <option value="PASSPORT">Passaporte/Cartão de cidadão</option>
        <option value="INSURANCE">Seguro de viagem</option>
        <option value="OTHER">Outro</option>
      </select>
      <input type="text" class="doc-passenger-name" placeholder="Nome do passageiro">
      <input type="file" class="doc-file-input" required>
      <button type="submit" class="ghost mini-action">Anexar</button>
    </form>`;
}

function reservationBlockHtml(r) {
  return `
    <div class="doc-reservation" data-reservation="${esc(r.id)}">
      <div class="doc-reservation-head">
        <b>${esc(r.offer?.hotel || r.id)}</b>
        <span>${esc(r.offer?.destination || '')}</span>
      </div>
      ${r.missingDocuments?.length ? `<div class="doc-missing-note">Falta: ${esc(r.missingDocuments.join(', '))}</div>` : ''}
      <div class="doc-list" data-list></div>
      ${uploadFormHtml()}
    </div>`;
}

export function wireUploadForm(block, reservationId) {
  const typeSelect = block.querySelector('.doc-type-select');
  const passengerInput = block.querySelector('.doc-passenger-name');
  passengerInput.placeholder = reservationId ? 'Nome do passageiro' : 'Nome da pessoa (ex.: filho, cônjuge)';
  const toggleField = () => { passengerInput.hidden = reservationId ? typeSelect.value !== 'PASSPORT' : false; };
  typeSelect.onchange = toggleField;
  toggleField();

  block.querySelector('.doc-upload-form').onsubmit = async ev => {
    ev.preventDefault();
    const fileInput = block.querySelector('.doc-file-input');
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
      await api('/api/customer/documents/upload', {
        method: 'POST',
        body: JSON.stringify({
          reservationId: reservationId || undefined,
          type: typeSelect.value,
          passengerName: passengerInput.value,
          fileName: file.name,
          mimeType: file.type,
          fileBase64
        })
      });
      fileInput.value = '';
      passengerInput.value = '';
      await loadDocs(reservationId, block.querySelector('[data-list], [data-family-list]'));
    } catch (err) {
      alert(err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Anexar';
    }
  };
}

function docItemHtml(d) {
  return `
    <div class="doc-item">
      <span class="doc-type">${esc(TYPE_LABEL[d.type] || d.type)}</span>
      ${d.passengerName ? `<span class="muted">${esc(d.passengerName)}</span>` : ''}
      <span class="muted">${esc(d.fileName)}</span>
      <a href="${esc(d.signedUrl)}" target="_blank" rel="noopener">Ver</a>
      <button class="ghost mini-action doc-delete" data-doc="${d.id}">Remover</button>
    </div>`;
}

// Descarrega cada documento como ficheiro separado (sem juntar num
// ZIP/PDF - decisao consciente para nao acrescentar dependencias so por
// causa disto). d.signedUrl aponta para outra origem (Supabase Storage) -
// o atributo "download" so e respeitado pelo browser em links da mesma
// origem, para outra origem e sempre tratado como navegacao normal; sem
// target="_blank" isso substituia a propria Area de Cliente pelo
// ficheiro. Mesmo padrao do link "Ver" ja existente (target="_blank").
async function downloadAll(documents) {
  for (const d of documents) {
    const a = document.createElement('a');
    a.href = d.signedUrl;
    a.download = d.fileName;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    await new Promise(r => setTimeout(r, 350));
  }
}

export async function loadDocs(reservationId, listEl) {
  if (!listEl) return;
  listEl.innerHTML = 'A carregar...';
  try {
    const query = reservationId ? `?reservationId=${encodeURIComponent(reservationId)}` : '';
    const data = await api(`/api/customer/documents${query}`);
    const byCategory = {};
    data.documents.forEach(d => {
      const cat = TYPE_CATEGORY[d.type] || 'OUTROS';
      (byCategory[cat] ||= []).push(d);
    });
    const categoriesWithDocs = CATEGORY_ORDER.filter(cat => byCategory[cat]?.length);

    listEl.innerHTML = categoriesWithDocs.length ? `
      ${data.documents.length > 1 ? '<button type="button" class="ghost mini-action doc-download-all">Descarregar tudo</button>' : ''}
      ${categoriesWithDocs.map(cat => `
        <div class="doc-category">
          <p class="doc-category-label">${CATEGORY_LABEL[cat]}</p>
          ${byCategory[cat].map(docItemHtml).join('')}
        </div>`).join('')}` : '<span class="muted">Sem documentos anexados.</span>';

    listEl.querySelectorAll('.doc-delete').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Remover este documento?')) return;
        try {
          await api('/api/customer/documents/delete', { method: 'POST', body: JSON.stringify({ documentId: btn.dataset.doc }) });
          await loadDocs(reservationId, listEl);
        } catch (err) { alert(err.message); }
      };
    });
    listEl.querySelector('.doc-download-all')?.addEventListener('click', () => downloadAll(data.documents));
  } catch (err) {
    listEl.innerHTML = `<span class="error">${esc(err.message)}</span>`;
  }
}
