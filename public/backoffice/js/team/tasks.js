// Separador "Tarefas" da equipa (secao "Tarefas" / "Gestão do atraso"):
// todas as tarefas de todos os processos e oportunidades, filtráveis por
// responsável e atraso.

import { $, esc, api } from '../utils.js';
import { openReservationPage } from '../reservations.js';
import { openOpportunityPage } from '../pipeline.js';

let allTasks = [];
let staffList = [];
const filters = { staffId: '', overdueOnly: false };

export async function renderTarefasEquipa() {
  const el = $('#view-tarefas-equipa');
  el.innerHTML = `
    <div class="panel">
      <div class="toolbar">
        <div class="pipeline-filters">
          <select id="taskFilterStaff"><option value="">Todos os responsáveis</option></select>
          <label class="service-line-checkbox"><input type="checkbox" id="taskFilterOverdue" /> Só atrasadas</label>
        </div>
      </div>
      <div id="teamTasksList"><p class="muted">A carregar...</p></div>
    </div>`;

  $('#taskFilterStaff').addEventListener('change', e => { filters.staffId = e.target.value; loadTasks(); });
  $('#taskFilterOverdue').addEventListener('change', e => { filters.overdueOnly = e.target.checked; loadTasks(); });

  await loadTasks();
}

async function loadTasks() {
  try {
    const params = new URLSearchParams();
    if (filters.staffId) params.set('staffId', filters.staffId);
    if (filters.overdueOnly) params.set('overdue', 'true');
    const data = await api(`/api/admin/team/tasks?${params.toString()}`);
    allTasks = data.tasks;
    staffList = data.staff;
    $('#taskFilterStaff').innerHTML = '<option value="">Todos os responsáveis</option>' + staffList.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
    $('#taskFilterStaff').value = filters.staffId;
    renderList();
  } catch (err) {
    $('#teamTasksList').innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

function renderList() {
  if (!allTasks.length) {
    $('#teamTasksList').innerHTML = '<p class="empty-note">Sem tarefas.</p>';
    return;
  }
  $('#teamTasksList').innerHTML = `
    <div class="bo-table-wrap">
      <table class="bo-table">
        <thead><tr><th>Tarefa</th><th>Contexto</th><th>Prazo</th><th>Prioridade</th><th>Estado</th></tr></thead>
        <tbody>
          ${allTasks.map(t => `
            <tr data-reservation="${esc(t.contextReservationId || '')}" data-opportunity="${esc(t.contextOpportunityId || '')}">
              <td>${esc(t.description)}</td>
              <td>${esc(t.contextLabel)}</td>
              <td>${t.overdue ? `<span class="pill pill-warning">${esc(t.dueDate)} · atrasada</span>` : esc(t.dueDate || '—')}</td>
              <td>${esc(t.priority)}</td>
              <td><span class="pill ${t.status === 'DONE' ? 'pill-ok' : ''}">${esc(t.status)}</span></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  document.querySelectorAll('#teamTasksList tbody tr').forEach(row => {
    row.onclick = () => {
      if (row.dataset.reservation) openReservationPage(row.dataset.reservation);
      else if (row.dataset.opportunity) openOpportunityPage(row.dataset.opportunity);
    };
  });
}
