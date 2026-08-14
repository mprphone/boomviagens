// Vista "Reservas": lista pesquisavel/filtravel com mudanca rapida de
// estado; cada linha abre a Ficha de Reserva completa por separadores
// (Resumo, Passageiros, Documentos, Emissoes) - ver ./reservations/*.js.

import { $, esc, money, api } from './utils.js';
import { openReservationDetail } from './reservations/reservationDetail.js';

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
          <b>${esc(r.id)}</b> - ${esc(r.customer?.name)} (<a href="mailto:${esc(r.customer?.email)}">${esc(r.customer?.email)}</a>${r.customer?.phone ? ` · <a href="tel:${esc(r.customer.phone)}">${esc(r.customer.phone)}</a>` : ''})<br>
          ${esc(r.offer?.hotel)} - ${esc(r.offer?.destination)} - ${money(r.offer?.finalPrice)}
          <div class="muted">Criado em ${new Date(r.createdAt).toLocaleString('pt-PT')}</div>
          ${r.status === 'PENDING_PAYMENT' ? '<div class="pill pill-warning">💬 Pagamento pendente - considerar contactar o cliente</div>' : ''}
          ${r.missingDocuments?.length ? `<div class="pill pill-warning">Falta: ${esc(r.missingDocuments.join(', '))}</div>` : '<div class="pill pill-ok">Documentos completos</div>'}
        </div>
        <div class="reservation-actions">
          <span class="pill">${esc(statusLabel(r.status))}</span>
          <select class="reservation-status-select" data-reservation="${r.id}">
            ${statuses.map(s => `<option value="${s.value}" ${s.value === r.status ? 'selected' : ''}>${s.label}</option>`).join('')}
          </select>
          <button class="ghost mini-action reservation-save" data-reservation="${r.id}">Guardar</button>
          <button class="btn mini-action reservation-open" data-reservation="${r.id}">Abrir ficha</button>
        </div>
      </div>
      <div class="reservation-file" data-reservation="${r.id}" hidden></div>
    </div>`).join('') || '<p class="empty-note">Sem reservas.</p>';

  document.querySelectorAll('.reservation-save').forEach(btn => {
    btn.onclick = () => updateStatus(btn.dataset.reservation);
  });
  document.querySelectorAll('.reservation-open').forEach(btn => {
    btn.onclick = () => toggleFicha(btn.dataset.reservation);
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

async function toggleFicha(reservationId) {
  const panel = document.querySelector(`.reservation-file[data-reservation="${reservationId}"]`);
  if (!panel) return;
  if (!panel.hidden) { panel.hidden = true; return; }
  document.querySelectorAll('.reservation-file').forEach(el => { el.hidden = true; });
  panel.hidden = false;
  await openReservationDetail(panel, reservationId);
}
