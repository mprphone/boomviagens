// Vista "Reservas": lista em tabela (processo, cliente, destino, datas,
// pax, estado, documentos, preco); clicar numa linha abre a Ficha de
// Reserva completa como pagina inteira dentro da mesma vista (nao um
// modal - a quantidade de separadores e informacao nao cabia bem numa
// caixa), com um botao "← Reservas" para voltar a lista - ver
// ./reservations/reservationDetail.js.

import { $, esc, money, api } from './utils.js';
import { openReservationDetail } from './reservations/reservationDetail.js';

let allReservations = [];
let statuses = [];

export async function renderReservas() {
  const el = $('#view-reservas');
  el.innerHTML = `
    <div class="panel">
      <div class="toolbar">
        <input id="reservationsSearch" type="search" placeholder="Pesquisar por processo, localizador, NIF, telefone, hotel, destino, cliente..." />
        <select id="reservationsStatusFilter"></select>
      </div>
      <div id="reservationsList"><p class="muted">A carregar...</p></div>
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
  const haystack = `${r.id} ${r.processNumber || ''} ${r.customer?.name || ''} ${r.customer?.email || ''} ${r.customer?.phone || ''} ${r.customer?.nif || ''} ${r.offer?.hotel || ''} ${r.offer?.destination || ''} ${r.operator || ''} ${r.operatorLocator || ''} ${r.invoiceNumber || ''}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function statusLabel(status) {
  return statuses.find(s => s.value === status)?.label || status;
}

function renderTable() {
  const query = $('#reservationsSearch').value.trim();
  const status = $('#reservationsStatusFilter').value;
  const filtered = allReservations.filter(r => matchesFilter(r, query, status));

  if (!filtered.length) {
    $('#reservationsList').innerHTML = '<p class="empty-note">Sem reservas.</p>';
    return;
  }

  $('#reservationsList').innerHTML = `
    <div class="bo-table-wrap">
      <table class="bo-table">
        <thead>
          <tr>
            <th>Processo</th><th>Cliente</th><th>Destino</th><th>Datas</th><th>Pax</th>
            <th>Estado</th><th>Doc</th><th>PVP</th><th>Pago</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(r => `
            <tr data-reservation="${esc(r.id)}">
              <td><b>${esc(r.processNumber || r.id)}</b><div class="muted small">${new Date(r.createdAt).toLocaleDateString('pt-PT')}</div></td>
              <td>${esc(r.customer?.name || '')}<div class="muted small">${esc(r.customer?.email || '')}</div></td>
              <td>${esc(r.offer?.destination || '')}<div class="muted small">${esc(r.offer?.hotel || '')}</div></td>
              <td class="muted small">${esc(r.offer?.checkin || '')} → ${esc(r.offer?.checkout || '')}</td>
              <td>${(r.offer?.adults || 0) + (r.offer?.children || 0)}</td>
              <td><span class="pill">${esc(statusLabel(r.status))}</span></td>
              <td>${r.missingDocuments?.length ? '<span class="pill pill-warning">Falta</span>' : '<span class="pill pill-ok">OK</span>'}</td>
              <td>${money(r.offer?.finalPrice)}</td>
              <td>${r.status === 'PENDING_PAYMENT' ? '<span class="pill pill-warning">Pendente</span>' : '<span class="pill pill-ok">Pago</span>'}</td>
              <td>${r.openComplaintsCount ? '<span class="pill pill-warning">🔴</span>' : ''}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  document.querySelectorAll('#reservationsList tbody tr').forEach(row => {
    row.onclick = () => openReservationPage(row.dataset.reservation);
  });
}

async function openReservationPage(reservationId) {
  const el = $('#view-reservas');
  el.innerHTML = `
    <button type="button" class="back-link">← Reservas</button>
    <div class="panel process-page"></div>`;
  el.querySelector('.back-link').onclick = () => renderReservas();
  await openReservationDetail(el.querySelector('.process-page'), reservationId);
}
