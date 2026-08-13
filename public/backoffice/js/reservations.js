// Vista "Reservas": lista pesquisavel/filtravel, mudanca de estado e
// gestao de documentos por reserva (a mesma logica que existia no
// backoffice antigo embutido no site, so reestilizada para este shell).

import { $, esc, money, api } from './utils.js';

let allReservations = [];
let statuses = [];

export async function renderReservas() {
  const el = $('#view-reservas');
  el.innerHTML = `
    <div class="panel">
      <div class="toolbar">
        <input id="reservationsSearch" type="search" placeholder="Pesquisar por id, hotel, destino, cliente..." />
        <select id="reservationsStatusFilter"></select>
      </div>
      <div id="reservationsList" class="reservation-list"><p class="muted">A carregar...</p></div>
    </div>`;

  $('#reservationsSearch').addEventListener('input', renderTable);
  $('#reservationsStatusFilter').addEventListener('change', renderTable);

  await loadReservations();
}

async function loadReservations() {
  try {
    const data = await api('/api/admin/reservations');
    allReservations = data.reservations;
    statuses = data.statuses;
    const filterEl = $('#reservationsStatusFilter');
    filterEl.innerHTML = '<option value="">Todos os estados</option>' + statuses.map(s => `<option value="${s.value}">${s.label}</option>`).join('');
    renderTable();
  } catch (err) {
    $('#reservationsList').innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

function matchesFilter(r, query, status) {
  if (status && r.status !== status) return false;
  if (!query) return true;
  const haystack = `${r.id} ${r.customer?.name || ''} ${r.customer?.email || ''} ${r.offer?.hotel || ''} ${r.offer?.destination || ''}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function statusLabel(status) {
  return statuses.find(s => s.value === status)?.label || status;
}

function renderTable() {
  const query = $('#reservationsSearch').value.trim();
  const status = $('#reservationsStatusFilter').value;
  const filtered = allReservations.filter(r => matchesFilter(r, query, status));

  $('#reservationsList').innerHTML = filtered.map(r => `
    <div class="reservation-row">
      <div class="reservation-row-top">
        <div class="reservation-main">
          <b>${esc(r.id)}</b> - ${esc(r.customer?.name)} (${esc(r.customer?.email)})<br>
          ${esc(r.offer?.hotel)} - ${esc(r.offer?.destination)} - ${money(r.offer?.finalPrice)}
          <div class="muted">Criado em ${new Date(r.createdAt).toLocaleString('pt-PT')}</div>
          ${r.missingDocuments?.length ? `<div class="pill pill-warning">Falta: ${esc(r.missingDocuments.join(', '))}</div>` : '<div class="pill pill-ok">Documentos completos</div>'}
        </div>
        <div class="reservation-actions">
          <span class="pill">${esc(statusLabel(r.status))}</span>
          <select class="reservation-status-select" data-reservation="${r.id}">
            ${statuses.map(s => `<option value="${s.value}" ${s.value === r.status ? 'selected' : ''}>${s.label}</option>`).join('')}
          </select>
          <button class="ghost mini-action reservation-save" data-reservation="${r.id}">Guardar</button>
          <button class="ghost mini-action reservation-docs-toggle" data-reservation="${r.id}">Documentos</button>
        </div>
      </div>
      <div class="reservation-documents" data-reservation="${r.id}" hidden></div>
    </div>`).join('') || '<p class="empty-note">Sem reservas.</p>';

  document.querySelectorAll('.reservation-save').forEach(btn => {
    btn.onclick = () => updateStatus(btn.dataset.reservation);
  });
  document.querySelectorAll('.reservation-docs-toggle').forEach(btn => {
    btn.onclick = () => toggleDocuments(btn.dataset.reservation);
  });
}

async function updateStatus(reservationId) {
  const select = document.querySelector(`.reservation-status-select[data-reservation="${reservationId}"]`);
  try {
    await api('/api/admin/reservations/update', { method: 'POST', body: JSON.stringify({ reservationId, status: select.value }) });
    await loadReservations();
  } catch (err) {
    alert(err.message);
  }
}

async function toggleDocuments(reservationId) {
  const panel = document.querySelector(`.reservation-documents[data-reservation="${reservationId}"]`);
  if (!panel) return;
  if (!panel.hidden) { panel.hidden = true; return; }
  document.querySelectorAll('.reservation-documents').forEach(el => { el.hidden = true; });
  panel.hidden = false;
  await loadDocuments(reservationId, panel);
}

async function loadDocuments(reservationId, panel) {
  panel.innerHTML = 'A carregar...';
  try {
    const data = await api(`/api/admin/documents?reservationId=${encodeURIComponent(reservationId)}`);
    renderDocuments(reservationId, panel, data.documents);
  } catch (err) {
    panel.innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

async function refreshKeepingDocsOpen(reservationId) {
  await loadReservations();
  const panel = document.querySelector(`.reservation-documents[data-reservation="${reservationId}"]`);
  if (!panel) return;
  panel.hidden = false;
  await loadDocuments(reservationId, panel);
}

function renderDocuments(reservationId, panel, documents) {
  panel.innerHTML = `
    <div class="doc-list">
      ${documents.map(d => `
        <div class="doc-item">
          <span class="doc-type">${d.type === 'PASSPORT' ? 'Passaporte/CC' : d.type === 'INSURANCE' ? 'Seguro' : 'Outro'}</span>
          ${d.passengerName ? `<span class="muted">${esc(d.passengerName)}</span>` : ''}
          <span class="muted">${esc(d.fileName)}</span>
          <a href="${esc(d.signedUrl)}" target="_blank" rel="noopener">Ver</a>
          <button class="ghost mini-action doc-delete" data-doc="${d.id}">Remover</button>
        </div>`).join('') || '<div class="muted">Sem documentos anexados.</div>'}
    </div>
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

  panel.querySelectorAll('.doc-delete').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Remover este documento?')) return;
      try {
        await api('/api/admin/documents/delete', { method: 'POST', body: JSON.stringify({ documentId: btn.dataset.doc }) });
        await refreshKeepingDocsOpen(reservationId);
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
      await api('/api/admin/documents/upload', {
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
      await refreshKeepingDocsOpen(reservationId);
    } catch (err) {
      alert(err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Anexar';
    }
  };
}
