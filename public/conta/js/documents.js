// Cofre documental por pessoa. Passaporte e Cartão de Cidadão são tipos
// diferentes, com número, validade e país emissor validados no servidor.

import { $, esc, api, notify } from './utils.js';

const CATEGORY_ORDER = ['IDENTIFICACAO', 'SEGURO', 'VOUCHERS', 'BILHETES', 'PROGRAMA', 'OUTROS'];
const CATEGORY_LABEL = { IDENTIFICACAO: 'Identificação', SEGURO: 'Seguro', VOUCHERS: 'Vouchers', BILHETES: 'Bilhetes', PROGRAMA: 'Programa', OUTROS: 'Outros' };
const TYPE_CATEGORY = { PASSPORT: 'IDENTIFICACAO', IDENTITY_CARD: 'IDENTIFICACAO', VISA: 'IDENTIFICACAO', INSURANCE: 'SEGURO', VOUCHER: 'VOUCHERS', TICKET: 'BILHETES', ITINERARY: 'PROGRAMA', OTHER: 'OUTROS' };
export const TYPE_LABEL = { PASSPORT: 'Passaporte', IDENTITY_CARD: 'Cartão de Cidadão', VISA: 'Visto', INSURANCE: 'Seguro', VOUCHER: 'Voucher', TICKET: 'Bilhete', ITINERARY: 'Itinerário/programa', OTHER: 'Outro' };
const IDENTITY_TYPES = new Set(['PASSPORT', 'IDENTITY_CARD']);

export async function renderDocumentos() {
  const el = $('#view-documentos');
  el.innerHTML = '<p class="muted">A carregar documentos…</p>';
  let reservationsData;
  try { reservationsData = await api('/api/customer/reservations'); }
  catch (err) { el.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
  const reservations = reservationsData.reservations.filter(reservation => reservation.status !== 'CANCELLED');

  el.innerHTML = `
    <div class="document-intro"><div><p class="eyebrow">Cofre documental</p><h2>Documentos associados a cada passageiro</h2><p>Guarde uma vez o Passaporte ou Cartão de Cidadão. Em reservas futuras reutilizamos o documento válido da pessoa certa.</p></div><div class="document-security-note">PDF, JPG ou PNG · máximo 7 MB<br>Dados protegidos e acesso autenticado</div></div>
    <div class="doc-reservation doc-family" data-document-block>
      <div class="doc-reservation-head"><div><b>Documentos da família</b><span>Reutilizáveis em qualquer reserva futura</span></div><span class="doc-scope-badge">Cofre da conta</span></div>
      <div data-document-content><p class="muted">A carregar…</p></div>
    </div>
    ${reservations.length ? reservations.map(reservationBlockHtml).join('') : '<p class="empty-note">Ainda não tem reservas para gerir documentos específicos.</p>'}`;

  await Promise.all([
    loadDocumentBlock(el.querySelector('.doc-family'), null),
    ...reservations.map(reservation => loadDocumentBlock(el.querySelector(`[data-reservation="${CSS.escape(reservation.id)}"]`), reservation.id))
  ]);
}

// Reutiliza exatamente o mesmo bloco documental dentro do detalhe de uma
// viagem. Mantem carregamento, passageiros, upload e acoes num unico modulo,
// evitando imports de helpers privados que impediam toda a area de arrancar.
export async function renderReservationDocuments(container, reservationId) {
  container.innerHTML = `
    <div class="panel doc-reservation" data-document-block data-reservation="${esc(reservationId)}">
      <div class="panel-head"><h2>Documentos desta viagem</h2></div>
      <div data-document-content><p class="muted">A carregar…</p></div>
    </div>`;
  await loadDocumentBlock(container.querySelector('[data-document-block]'), reservationId);
}

function reservationBlockHtml(reservation) {
  return `
    <div class="doc-reservation" data-document-block data-reservation="${esc(reservation.id)}">
      <div class="doc-reservation-head"><div><b>${esc(reservation.offer?.hotel || reservation.id)}</b><span>${esc(reservation.offer?.destination || '')}</span></div><span class="doc-scope-badge">${esc(reservation.offer?.checkout || 'Reserva')}</span></div>
      ${reservation.missingDocuments?.length ? `<div class="doc-missing-note"><b>Por concluir</b><span>${esc(reservation.missingDocuments.join(' · '))}</span></div>` : '<div class="doc-complete-note">✓ Documentação necessária completa</div>'}
      <div data-document-content><p class="muted">A carregar…</p></div>
    </div>`;
}

async function loadDocumentBlock(block, reservationId) {
  if (!block) return;
  const content = block.querySelector('[data-document-content]');
  try {
    const query = reservationId ? `?reservationId=${encodeURIComponent(reservationId)}` : '';
    const data = await api(`/api/customer/documents${query}`);
    content.innerHTML = `${documentsListHtml(data.documents, data.passengers)}${uploadFormHtml(data.passengers, reservationId)}`;
    wireDocumentActions(block, data, reservationId);
  } catch (err) {
    content.innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

function documentsListHtml(documents, passengers) {
  const byCategory = {};
  documents.forEach(document => {
    const category = TYPE_CATEGORY[document.type] || 'OUTROS';
    (byCategory[category] ||= []).push(document);
  });
  const categories = CATEGORY_ORDER.filter(category => byCategory[category]?.length);
  if (!categories.length) return '<div class="doc-empty"><b>Ainda não existem documentos neste bloco.</b><span>Anexe o primeiro documento abaixo.</span></div>';
  return `<div class="doc-list">
    ${documents.length > 1 ? '<button type="button" class="ghost mini-action doc-download-all">Descarregar tudo</button>' : ''}
    ${categories.map(category => `<div class="doc-category"><p class="doc-category-label">${CATEGORY_LABEL[category]}</p>${byCategory[category].map(document => docItemHtml(document, passengers)).join('')}</div>`).join('')}
  </div>`;
}

function docItemHtml(document, passengers) {
  const identity = IDENTITY_TYPES.has(document.type);
  const complete = !identity || Boolean(document.passengerId && document.documentNumber && document.expiryDate && document.issuingCountry);
  return `<article class="doc-item ${complete ? '' : 'is-incomplete'}" data-document="${esc(document.id)}">
    <div class="doc-item-icon">${document.type === 'PASSPORT' ? 'P' : document.type === 'IDENTITY_CARD' ? 'CC' : 'DOC'}</div>
    <div class="doc-item-main"><div><b>${esc(TYPE_LABEL[document.type] || document.type)}</b>${document.reusable ? '<span class="pill info">Reutilizado do cofre</span>' : ''}${complete ? '' : '<span class="pill warn">Completar dados</span>'}</div><span>${esc(document.passengerName || 'Documento da reserva')} · ${esc(document.fileName)}</span>${identity ? `<small>${document.documentNumber ? `N.º ${esc(document.documentNumber)}` : 'Número em falta'} · ${document.expiryDate ? `válido até ${esc(document.expiryDate)}` : 'validade em falta'} · ${esc(document.issuingCountry || 'país emissor em falta')}</small>` : ''}</div>
    <div class="doc-item-actions"><a class="ghost mini-action" href="${esc(document.signedUrl)}" target="_blank" rel="noopener">Ver</a>${identity ? `<button type="button" class="ghost mini-action doc-edit-toggle" data-doc="${esc(document.id)}">${complete ? 'Editar dados' : 'Completar dados'}</button>` : ''}${document.reusable ? '' : `<button class="ghost mini-action doc-delete" data-doc="${esc(document.id)}">Remover</button>`}</div>
    ${identity ? metadataEditFormHtml(document, passengers) : ''}
  </article>`;
}

function passengerOptions(passengers, selectedId = '') {
  return `<option value="">Escolha o passageiro</option>${passengers.map(passenger => `<option value="${esc(passenger.id)}" ${passenger.id === selectedId ? 'selected' : ''}>${esc(passenger.name)}</option>`).join('')}`;
}

function metadataEditFormHtml(document, passengers) {
  return `<form class="doc-metadata-form" data-doc="${esc(document.id)}" hidden>
    <label>Tipo<select name="type"><option value="IDENTITY_CARD" ${document.type === 'IDENTITY_CARD' ? 'selected' : ''}>Cartão de Cidadão</option><option value="PASSPORT" ${document.type === 'PASSPORT' ? 'selected' : ''}>Passaporte</option></select></label>
    <label>Passageiro<select name="passengerId" required>${passengerOptions(passengers, document.passengerId)}</select></label>
    <label>N.º do documento<input name="documentNumber" value="${esc(document.documentNumber || '')}" required maxlength="40" /></label>
    <label>Validade<input name="expiryDate" type="date" value="${esc(document.expiryDate || '')}" required /></label>
    <label>País emissor<input name="issuingCountry" value="${esc(document.issuingCountry || '')}" required maxlength="80" /></label>
    <button type="submit" class="btn mini-action">Guardar dados</button>
  </form>`;
}

function uploadFormHtml(passengers, reservationId) {
  const typeOptions = reservationId
    ? '<option value="IDENTITY_CARD">Cartão de Cidadão</option><option value="PASSPORT">Passaporte</option><option value="INSURANCE">Seguro de viagem</option><option value="OTHER">Outro documento</option>'
    : '<option value="IDENTITY_CARD">Cartão de Cidadão</option><option value="PASSPORT">Passaporte</option><option value="OTHER">Outro documento</option>';
  return `<details class="doc-upload-panel"><summary>+ Anexar documento</summary><form class="doc-upload-form">
    <div class="doc-upload-grid">
      <label>Tipo de documento<select name="type" class="doc-type-select">${typeOptions}</select></label>
      <label class="doc-passenger-field">Passageiro<select name="passengerId" required>${passengerOptions(passengers)}</select></label>
      <label class="doc-number-field">N.º do documento<input name="documentNumber" maxlength="40" required /></label>
      <label class="doc-expiry-field">Validade<input name="expiryDate" type="date" required /></label>
      <label class="doc-country-field">País emissor<input name="issuingCountry" value="Portugal" maxlength="80" required /></label>
      <label class="doc-file-field">Ficheiro<input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" required /><small>PDF, JPG ou PNG · máximo 7 MB</small></label>
    </div>
    <p class="doc-form-message"></p><button type="submit" class="btn mini-action">Validar e anexar</button>
  </form></details>`;
}

function wireDocumentActions(block, data, reservationId) {
  const upload = block.querySelector('.doc-upload-form');
  const typeSelect = upload?.querySelector('[name="type"]');
  const passengerSelect = upload?.querySelector('[name="passengerId"]');
  const toggleIdentityFields = () => {
    const identity = IDENTITY_TYPES.has(typeSelect.value);
    upload.querySelectorAll('.doc-passenger-field,.doc-number-field,.doc-expiry-field,.doc-country-field').forEach(field => { field.hidden = !identity; field.querySelector('input,select').required = identity; });
  };
  typeSelect?.addEventListener('change', toggleIdentityFields);
  passengerSelect?.addEventListener('change', () => {
    const passenger = data.passengers.find(item => item.id === passengerSelect.value);
    if (!passenger) return;
    if (passenger.documentType === 'PASSPORT') typeSelect.value = 'PASSPORT';
    else if (passenger.documentType) typeSelect.value = 'IDENTITY_CARD';
    upload.elements.documentNumber.value ||= passenger.documentNumber || '';
    upload.elements.expiryDate.value ||= passenger.documentExpiry || '';
    upload.elements.issuingCountry.value = passenger.documentCountry || upload.elements.issuingCountry.value;
    toggleIdentityFields();
  });
  toggleIdentityFields();

  upload.onsubmit = async event => {
    event.preventDefault();
    const file = upload.elements.file.files[0];
    const message = upload.querySelector('.doc-form-message');
    const button = upload.querySelector('button[type="submit"]');
    if (!file) return;
    if (file.size > 7 * 1024 * 1024) { message.textContent = 'O ficheiro ultrapassa o limite de 7 MB.'; return; }
    button.disabled = true; button.textContent = 'A validar e anexar…'; message.textContent = '';
    try {
      const fileBase64 = await readFileBase64(file);
      await api('/api/customer/documents/upload', { method: 'POST', body: JSON.stringify({
        reservationId: reservationId || undefined,
        type: upload.elements.type.value,
        passengerId: upload.elements.passengerId.value,
        documentNumber: upload.elements.documentNumber.value,
        expiryDate: upload.elements.expiryDate.value,
        issuingCountry: upload.elements.issuingCountry.value,
        fileName: file.name,
        mimeType: file.type,
        fileBase64
      }) });
      notify('Documento validado e guardado.', 'success');
      await renderDocumentos();
    } catch (err) {
      message.textContent = err.message;
      button.disabled = false; button.textContent = 'Validar e anexar';
    }
  };

  block.querySelectorAll('.doc-edit-toggle').forEach(button => {
    button.onclick = () => { const form = block.querySelector(`.doc-metadata-form[data-doc="${CSS.escape(button.dataset.doc)}"]`); form.hidden = !form.hidden; };
  });
  block.querySelectorAll('.doc-metadata-form').forEach(form => {
    form.onsubmit = async event => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]'); button.disabled = true;
      try {
        await api('/api/customer/documents/update', { method: 'POST', body: JSON.stringify({ documentId: form.dataset.doc, type: form.elements.type.value, passengerId: form.elements.passengerId.value, documentNumber: form.elements.documentNumber.value, expiryDate: form.elements.expiryDate.value, issuingCountry: form.elements.issuingCountry.value }) });
        notify('Dados do documento atualizados.', 'success');
        await renderDocumentos();
      } catch (err) { notify(err.message); button.disabled = false; }
    };
  });
  block.querySelectorAll('.doc-delete').forEach(button => {
    button.onclick = async () => {
      if (!confirm('Remover este documento?')) return;
      try { await api('/api/customer/documents/delete', { method: 'POST', body: JSON.stringify({ documentId: button.dataset.doc }) }); await renderDocumentos(); }
      catch (err) { notify(err.message); }
    };
  });
  block.querySelector('.doc-download-all')?.addEventListener('click', () => downloadAll(data.documents));
}

function readFileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function downloadAll(documents) {
  for (const item of documents) {
    const link = window.document.createElement('a');
    link.href = item.signedUrl;
    link.download = item.fileName;
    link.target = '_blank';
    link.rel = 'noopener';
    window.document.body.appendChild(link);
    link.click(); link.remove();
    await new Promise(resolve => setTimeout(resolve, 300));
  }
}
