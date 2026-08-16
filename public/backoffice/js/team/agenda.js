// Separador "Agenda" (secao "Agenda"): tarefas + próximas ações de
// oportunidades agrupadas por dia (Atrasadas/Hoje/Próximas), com filtro
// "Minhas"/"Toda a equipa" - mesmo padrao de agrupamento de followups.js.

import { $, esc, api } from '../utils.js';

let staffList = [];
let mineOnly = false;
let myStaffId = null;

export async function renderAgenda() {
  const el = $('#view-agenda');
  el.innerHTML = `
    <div class="panel">
      <div class="toolbar">
        <div class="pipeline-filters">
          <label class="service-line-checkbox"><input type="checkbox" id="agendaMineOnly" /> Só as minhas</label>
        </div>
      </div>
      <div id="agendaList"><p class="muted">A carregar...</p></div>
    </div>`;

  const session = await api('/api/admin/session');
  myStaffId = session.staff?.id || null;

  $('#agendaMineOnly').addEventListener('change', e => { mineOnly = e.target.checked; loadAgenda(); });
  await loadAgenda();
}

async function loadAgenda() {
  try {
    const params = new URLSearchParams();
    if (mineOnly && myStaffId) params.set('staffId', myStaffId);
    const data = await api(`/api/admin/team/agenda?${params.toString()}`);
    staffList = data.staff;
    renderList(data.items);
  } catch (err) {
    $('#agendaList').innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

function staffName(staffId) {
  return staffList.find(s => s.id === staffId)?.name || '';
}

function renderList(items) {
  const today = new Date().toISOString().slice(0, 10);
  const overdue = items.filter(i => i.date < today);
  const dueToday = items.filter(i => i.date === today);
  const upcoming = items.filter(i => i.date > today);

  function group(title, list, pillClass) {
    if (!list.length) return '';
    return `
      <p class="summary-block-label">${esc(title)} (${list.length})</p>
      <div class="customer-trip-list">
        ${list.map(i => `
          <div class="customer-trip-row">
            <div>
              <span class="pill">${i.type === 'TASK' ? 'Tarefa' : 'Follow-up'}</span>
              <b>${esc(i.title)}</b>
              ${i.context ? `<div class="muted small">${esc(i.context)}</div>` : ''}
            </div>
            <div class="customer-trip-side">
              <span class="pill ${pillClass}">${esc(i.date)}</span>
              ${staffName(i.staffId) ? `<span class="muted small">${esc(staffName(i.staffId))}</span>` : ''}
            </div>
          </div>`).join('')}
      </div>`;
  }

  $('#agendaList').innerHTML = `
    ${group('Atrasadas', overdue, 'pill-warning')}
    ${group('Hoje', dueToday, '')}
    ${group('Próximas', upcoming, 'pill-ok')}
    ${!overdue.length && !dueToday.length && !upcoming.length ? '<p class="empty-note">Sem itens na agenda.</p>' : ''}`;
}
