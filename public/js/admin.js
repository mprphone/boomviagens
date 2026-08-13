// Backoffice: dashboard (kpis, margens, emails, log de operador),
// tabela de reservas com documentos anexos, lista de clientes e o
// pipeline de leads.

import { $, esc, money, api, statusLabel } from './utils.js';

let adminAuthenticated = false;

function setAdminState(authenticated) {
  adminAuthenticated = authenticated;
  $('#adminLogin').hidden = authenticated;
  $('#adminContent').hidden = !authenticated;
  $('#testOperator').hidden = !authenticated;
  $('#refreshAdmin').textContent = authenticated ? 'Terminar sessao' : 'Atualizar painel';
  if (!authenticated) $('#adminLoginMessage').textContent = 'Entre para ver reservas, leads, margens e logs.';
}

export async function refreshAdmin() {
  let data;
  try {
    data = await api('/api/admin/dashboard');
  } catch (err) {
    setAdminState(false);
    $('#adminLoginMessage').textContent = err.message.includes('Autent') ? 'Entre para ver reservas, leads, margens e logs.' : err.message;
    return;
  }
  setAdminState(true);
  $('#rnavt').textContent = data.company.rnavt || 'INSERIR_RNAVT';
  $('#kpis').innerHTML = [
    ['Leads', data.stats.leads],
    ['Clientes', data.stats.customers],
    ['Reservas confirmadas', data.stats.confirmed],
    ['Margem total', money(data.stats.margin)]
  ].map(([k, v]) => `<div class="kpi"><span>${k}</span><strong>${v}</strong></div>`).join('');
  reservationStatuses = data.statuses;
  if (!$('#reservationsStatusFilter').dataset.filled) {
    $('#reservationsStatusFilter').innerHTML = '<option value="">Todos os estados</option>' + reservationStatuses.map(s => `<option value="${s.value}">${s.label}</option>`).join('');
    $('#reservationsStatusFilter').dataset.filled = '1';
  }
  loadAdminReservations();
  loadCustomers();
  loadLeadsPipeline();
  $('#adminMargins').innerHTML = data.margins.map(m => `<div class="mini-item"><b>${esc(m.name)}</b><br>${m.percent}% - minimo ${money(m.min)} - match: ${esc(m.match)}</div>`).join('');
  $('#adminEmails').innerHTML = data.latest.emails.map(e => `<div class="mini-item"><b>${esc(e.subject)}</b><br>Para: ${esc(e.to)}<br>${esc(e.status)}</div>`).join('') || '<div class="mini-item">Sem emails.</div>';
  $('#operatorLog').textContent = JSON.stringify({ operadores: data.operators, chamadas: data.latest.logs, auditoria: data.latest.audit }, null, 2);
}

export async function initAdminSession() {
  const s = await api('/api/admin/session');
  setAdminState(s.authenticated);
  if (s.authenticated) refreshAdmin();
}

let allReservations = [];
let reservationStatuses = [];

function reservationMatchesFilter(r, query, status) {
  if (status && r.status !== status) return false;
  if (!query) return true;
  const haystack = `${r.id} ${r.customer?.name || ''} ${r.customer?.email || ''} ${r.offer?.hotel || ''} ${r.offer?.destination || ''}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function renderReservationsTable() {
  const query = $('#reservationsSearch').value.trim();
  const status = $('#reservationsStatusFilter').value;
  const filtered = allReservations.filter(r => reservationMatchesFilter(r, query, status));
  $('#reservationsTable').innerHTML = filtered.map(r => `
    <div class="reservation-row">
      <div class="reservation-main">
        <b>${esc(r.id)}</b> - ${esc(r.customer?.name)} (${esc(r.customer?.email)})<br>
        ${esc(r.offer?.hotel)} - ${esc(r.offer?.destination)} - ${money(r.offer?.finalPrice)}
        <div class="muted">Criado em ${new Date(r.createdAt).toLocaleString('pt-PT')}</div>
        ${r.missingDocuments?.length ? `<div class="pill pill-warning">Falta: ${esc(r.missingDocuments.join(', '))}</div>` : '<div class="pill pill-ok">Documentos completos</div>'}
      </div>
      <div class="reservation-actions">
        <span class="pill">${statusLabel(r.status)}</span>
        <select class="reservation-status-select" data-reservation="${r.id}">
          ${reservationStatuses.map(s => `<option value="${s.value}" ${s.value === r.status ? 'selected' : ''}>${s.label}</option>`).join('')}
        </select>
        <button class="ghost mini-action reservation-save" data-reservation="${r.id}">Guardar</button>
        ${r.status !== 'CANCELLED' ? `<button class="ghost mini-action reservation-cancel" data-reservation="${r.id}">Cancelar</button>` : ''}
        ${['IN_VALIDATION', 'HUMAN_REVIEW'].includes(r.status) ? `<button class="ghost mini-action" onclick="approveReservation('${r.id}')">Aprovar no operador</button>` : ''}
        <button class="ghost mini-action reservation-docs-toggle" data-reservation="${r.id}">Documentos</button>
      </div>
      <div class="reservation-documents" data-reservation="${r.id}" hidden></div>
    </div>`).join('') || '<div class="mini-item">Sem reservas.</div>';

  $('#reservationsTable').querySelectorAll('.reservation-save').forEach(btn => {
    btn.onclick = () => updateReservationStatus(btn.dataset.reservation);
  });
  $('#reservationsTable').querySelectorAll('.reservation-cancel').forEach(btn => {
    btn.onclick = () => { if (confirm('Cancelar esta reserva?')) updateReservationStatus(btn.dataset.reservation, 'CANCELLED'); };
  });
  $('#reservationsTable').querySelectorAll('.reservation-docs-toggle').forEach(btn => {
    btn.onclick = () => toggleReservationDocuments(btn.dataset.reservation);
  });
}

async function toggleReservationDocuments(reservationId) {
  const panel = document.querySelector(`.reservation-documents[data-reservation="${reservationId}"]`);
  if (!panel) return;
  if (!panel.hidden) { panel.hidden = true; return; }
  document.querySelectorAll('.reservation-documents').forEach(el => { el.hidden = true; });
  panel.hidden = false;
  await loadReservationDocuments(reservationId, panel);
}

async function loadReservationDocuments(reservationId, panel) {
  panel.innerHTML = 'A carregar...';
  try {
    const data = await api(`/api/admin/documents?reservationId=${encodeURIComponent(reservationId)}`);
    renderReservationDocuments(reservationId, panel, data.documents);
  } catch (err) {
    panel.innerHTML = `<p class="error">${err.message}</p>`;
  }
}

async function refreshReservationsKeepingDocsOpen(reservationId) {
  await loadAdminReservations();
  const panel = document.querySelector(`.reservation-documents[data-reservation="${reservationId}"]`);
  if (!panel) return;
  panel.hidden = false;
  await loadReservationDocuments(reservationId, panel);
}

function renderReservationDocuments(reservationId, panel, documents) {
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
        <option value="PASSPORT">Passaporte/Cartao de cidadao</option>
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
        await refreshReservationsKeepingDocsOpen(reservationId);
      } catch (err) { alert(err.message); }
    };
  });

  const typeSelect = panel.querySelector('.doc-type-select');
  const passengerInput = panel.querySelector('.doc-passenger-name');
  const toggleitem = () => { passengerInput.hidden = typeSelect.value !== 'PASSPORT'; };
  typeSelect.onchange = toggleitem;
  toggleitem();

  panel.querySelector('.doc-upload-form').onsubmit = async ev => {
    ev.preventDefault();
    const fileInput = panel.querySelector('.doc-file-input');
    const file = fileInput.files[0];
    if (!file) return;
    const fileBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    try {
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
      await refreshReservationsKeepingDocsOpen(reservationId);
    } catch (err) { alert(err.message); }
  };
}

async function updateReservationStatus(reservationId, forceStatus) {
  const select = document.querySelector(`.reservation-status-select[data-reservation="${reservationId}"]`);
  const status = forceStatus || select.value;
  try {
    await api('/api/admin/reservations/update', { method: 'POST', body: JSON.stringify({ reservationId, status }) });
    await loadAdminReservations();
  } catch (err) {
    alert(err.message);
  }
}

async function loadAdminReservations() {
  try {
    const data = await api('/api/admin/reservations');
    allReservations = data.reservations;
    renderReservationsTable();
  } catch (err) {
    $('#reservationsTable').innerHTML = `<p class="error">${err.message}</p>`;
  }
}

$('#reservationsSearch').addEventListener('input', renderReservationsTable);
$('#reservationsStatusFilter').addEventListener('change', renderReservationsTable);

let allCustomers = [];
let allLeads = [];
let leadStages = [];

function leadStageLabel(stage) {
  const found = leadStages.find(s => s.value === stage);
  return found ? found.label : 'Nova';
}

function renderCustomersList() {
  const query = $('#customersSearch').value.trim().toLowerCase();
  const filtered = allCustomers.filter(c => !query || `${c.name} ${c.email}`.toLowerCase().includes(query));
  $('#customersList').innerHTML = filtered.map(c => `
    <div class="mini-item customer-item">
      <div class="customer-summary" data-email="${esc(c.email)}">
        <b>${esc(c.name)}</b> - ${esc(c.email)}<br>
        ${esc(c.phone)} - ${c.leadsCount} leads - ${c.reservationsCount} reservas
      </div>
      <div class="customer-detail" data-email="${esc(c.email)}" hidden></div>
    </div>`).join('') || '<div class="mini-item">Sem clientes.</div>';

  $('#customersList').querySelectorAll('.customer-summary').forEach(el => {
    el.onclick = () => toggleCustomerDetail(el.dataset.email);
  });
}

async function toggleCustomerDetail(email) {
  const detailEl = document.querySelector(`.customer-detail[data-email="${email}"]`);
  if (!detailEl) return;
  if (!detailEl.hidden) { detailEl.hidden = true; return; }
  document.querySelectorAll('.customer-detail').forEach(el => { el.hidden = true; });
  detailEl.hidden = false;
  detailEl.innerHTML = 'A carregar...';
  try {
    const data = await api(`/api/admin/customers/detail?email=${encodeURIComponent(email)}`);
    detailEl.innerHTML = `
      <label>Notas internas
        <textarea class="customer-notes" rows="3">${esc(data.customer.notes)}</textarea>
      </label>
      <button class="ghost mini-action customer-save-notes">Guardar notas</button>
      <div class="muted" style="margin-top:8px"><b>Leads:</b> ${data.leads.map(l => `${esc(l.search?.destination)} (${esc(leadStageLabel(l.status))})`).join(', ') || 'nenhum'}</div>
      <div class="muted"><b>Reservas:</b> ${data.reservations.map(r => `${esc(r.id)} (${esc(statusLabel(r.status))})`).join(', ') || 'nenhuma'}</div>`;
    detailEl.querySelector('.customer-save-notes').onclick = async () => {
      const notes = detailEl.querySelector('.customer-notes').value;
      try {
        await api('/api/admin/customers/notes', { method: 'POST', body: JSON.stringify({ email, notes }) });
      } catch (err) { alert(err.message); }
    };
  } catch (err) {
    detailEl.innerHTML = `<p class="error">${err.message}</p>`;
  }
}

async function loadCustomers() {
  try {
    const data = await api('/api/admin/customers');
    allCustomers = data.customers;
    renderCustomersList();
  } catch (err) {
    $('#customersList').innerHTML = `<p class="error">${err.message}</p>`;
  }
}

$('#customersSearch').addEventListener('input', renderCustomersList);

function renderLeadsPipeline() {
  const columns = leadStages.length ? leadStages : [{ value: 'NOVA', label: 'Nova' }, { value: 'EM_CONSULTA', label: 'Em consulta' }, { value: 'FECHADA', label: 'Fechada' }, { value: 'PERDIDA', label: 'Perdida' }];
  $('#leadsPipeline').innerHTML = columns.map(col => {
    const items = allLeads.filter(l => l.stage === col.value);
    return `
      <div class="pipeline-column">
        <h4>${col.label} <span class="badge">${items.length}</span></h4>
        ${items.map(l => `
          <div class="pipeline-card">
            <b>${esc(l.search?.destination)}</b><br>
            ${esc(l.search?.name || l.search?.email)}<br>
            <span class="muted">orcamento ${money(l.search?.budget)}</span>
            <select class="lead-stage-select" data-lead="${esc(l.id)}">
              ${columns.map(c => `<option value="${c.value}" ${c.value === col.value ? 'selected' : ''}>${c.label}</option>`).join('')}
            </select>
          </div>`).join('') || '<p class="muted">Sem leads.</p>'}
      </div>`;
  }).join('');

  $('#leadsPipeline').querySelectorAll('.lead-stage-select').forEach(sel => {
    sel.onchange = () => updateLeadStage(sel.dataset.lead, sel.value);
  });
}

async function updateLeadStage(leadId, status) {
  try {
    await api('/api/admin/leads/update', { method: 'POST', body: JSON.stringify({ leadId, status }) });
    await loadLeadsPipeline();
  } catch (err) {
    alert(err.message);
  }
}

async function loadLeadsPipeline() {
  try {
    const data = await api('/api/admin/leads');
    allLeads = data.leads;
    leadStages = data.leadStages;
    renderLeadsPipeline();
  } catch (err) {
    $('#leadsPipeline').innerHTML = `<p class="error">${err.message}</p>`;
  }
}

$('#adminLogin').addEventListener('submit', async e => {
  e.preventDefault();
  $('#adminLoginMessage').textContent = 'A validar credenciais...';
  try {
    await api('/api/admin/login', { method: 'POST', body: JSON.stringify(formToJson(e.target)) });
    $('#adminLoginMessage').textContent = '';
    refreshAdmin();
  } catch (err) {
    $('#adminLoginMessage').textContent = err.message;
  }
});

$('#refreshAdmin').onclick = async () => {
  if (!adminAuthenticated) return refreshAdmin();
  await api('/api/admin/logout', { method: 'POST', body: '{}' });
  setAdminState(false);
};

$('#testOperator').onclick = async () => {
  $('#operatorLog').textContent = 'A testar login + disponibilidade TourDiez...';
  try {
    const data = await api('/api/admin/operator/tourdiez/test', { method: 'POST', body: JSON.stringify({ destination: 'Punta Cana', nights: 7, adults: 2 }) });
    $('#operatorLog').textContent = JSON.stringify(data, null, 2);
    refreshAdmin();
  } catch (e) {
    $('#operatorLog').textContent = e.message;
  }
};

window.approveReservation = async function(reservationId) {
  if (!confirm('Confirmar esta reserva no operador?')) return;
  try {
    const data = await api('/api/admin/reservations/approve', { method: 'POST', body: JSON.stringify({ reservationId }) });
    alert(`Reserva confirmada. Localizador: ${data.reservation.operatorLocator}`);
    refreshAdmin();
  } catch (err) {
    alert(err.message);
  }
};
