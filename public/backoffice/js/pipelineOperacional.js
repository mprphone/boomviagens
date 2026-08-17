// Vista "Pipeline Operacional" (secao "Pipeline Operacional"): quadro por
// arrasto sobre as reservas ja existentes - as colunas sao os estados reais
// de RESERVATION_STATUSES, arrastar um cartao chama a MESMA rota que o
// separador Resumo da ficha de reserva ja usa para mudar de estado
// (/api/admin/reservations/update). Nenhum modelo de dados paralelo.

import { $, esc, money, api } from './utils.js';
import { attachDragHandlers, attachDropHandlers } from './kanban.js';
import { renderReservationCard } from './pipelineOperacional/reservationCard.js';
import { openReservationPage } from './reservations.js';

let allReservations = [];
let statuses = [];
let staffList = [];
let staffById = new Map();
const filters = { staffId: '', search: '' };

// Chamado a partir da Visão Geral da equipa antes de navegar para aqui,
// para o quadro abrir ja filtrado por esse colaborador.
export function filterOperacionalByStaff(staffId) {
  filters.staffId = staffId;
}

function manualConfirmationDetails() {
  const manualLocator = prompt('Localizador real do operador (obrigatório para confirmação manual):')?.trim() || '';
  if (!manualLocator) throw new Error('Confirmação cancelada: falta o localizador real do operador.');
  const manualConfirmationReason = prompt('Como foi confirmada? Ex.: portal do operador, telefone, email:')?.trim() || '';
  if (!manualConfirmationReason) throw new Error('Confirmação cancelada: indique como verificou a reserva.');
  return { manualLocator, manualConfirmationReason };
}

export async function renderPipelineOperacional() {
  const el = $('#view-pipeline-operacional');
  el.innerHTML = `
    <div class="panel">
      <div class="toolbar">
        <div class="pipeline-filters">
          <select id="opFilterStaff"><option value="">Todos os responsáveis</option></select>
          <input id="opFilterSearch" type="search" placeholder="Processo, cliente, destino..." />
        </div>
      </div>
      <div id="opBoard" class="pipeline-board"><p class="muted">A carregar...</p></div>
    </div>`;

  $('#opFilterStaff').addEventListener('change', e => { filters.staffId = e.target.value; renderBoard(); });
  $('#opFilterSearch').addEventListener('input', e => { filters.search = e.target.value.trim().toLowerCase(); renderBoard(); });

  await loadBoard();
}

async function loadBoard() {
  try {
    const [reservationsData, staffData] = await Promise.all([api('/api/admin/reservations'), api('/api/admin/staff')]);
    allReservations = reservationsData.reservations;
    statuses = reservationsData.statuses;
    staffList = staffData.staff;
    staffById = new Map(staffList.map(s => [s.id, s]));

    $('#opFilterStaff').innerHTML = '<option value="">Todos os responsáveis</option>' + staffList.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
    $('#opFilterStaff').value = filters.staffId;

    renderBoard();
  } catch (err) {
    $('#opBoard').innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

function applyFilters(list) {
  return list.filter(r => {
    if (filters.staffId && r.operationalStaffId !== filters.staffId) return false;
    if (filters.search) {
      const haystack = `${r.processNumber} ${r.customer?.name || ''} ${r.offer?.destination || ''}`.toLowerCase();
      if (!haystack.includes(filters.search)) return false;
    }
    return true;
  });
}

function renderBoard() {
  const boardEl = $('#opBoard');
  const filtered = applyFilters(allReservations);

  boardEl.innerHTML = statuses.map(s => `
    <div class="pipeline-col">
      <div class="pipeline-col-head">
        <h3>${esc(s.label)}</h3>
        <div class="pipeline-col-meta" data-meta="${s.value}"></div>
      </div>
      <div class="pipeline-col-body" data-col-value="${s.value}"></div>
    </div>`).join('');

  statuses.forEach(s => {
    const statusReservations = filtered.filter(r => r.status === s.value);
    const total = statusReservations.reduce((sum, r) => sum + (r.offer?.finalPrice || 0), 0);
    boardEl.querySelector(`[data-meta="${s.value}"]`).textContent = `${statusReservations.length} · ${money(total)}`;

    const body = boardEl.querySelector(`.pipeline-col-body[data-col-value="${s.value}"]`);
    statusReservations.forEach(r => {
      const card = renderReservationCard(r, staffById);
      card.addEventListener('click', () => { if (!card.classList.contains('dragging')) openReservationPage(r.id); });
      attachDragHandlers(card);
      body.appendChild(card);
    });
  });

  attachDropHandlers(boardEl, async (reservationId, newStatus) => {
    const reservation = allReservations.find(r => r.id === reservationId);
    if (!reservation || reservation.status === newStatus) return;
    try {
      await api('/api/admin/reservations/update', { method: 'POST', body: JSON.stringify({ reservationId, status: newStatus, ...(newStatus === 'CONFIRMED' ? manualConfirmationDetails() : {}) }) });
      await loadBoard();
    } catch (err) {
      alert(err.message);
      await loadBoard();
    }
  });
}
