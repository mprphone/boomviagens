// Separador "Tarefas": checklist administrativo/operacional do processo
// (pedir passaportes, confirmar hotel, emitir seguro, cobrar saldo...).
// Cada tarefa aparece como um post-it - estado e nota de resolução
// editam-se ali mesmo, sem abrir nada; só "Adicionar tarefa" e "Editar"
// abrem a gaveta lateral com o formulário completo. Tarefas em atraso
// entram nos alertas do Resumo - ver domain.js#computeAlerts.

import { esc, api } from '../utils.js';
import { openDrawer, closeDrawer } from '../drawer.js';

const PRIORITY_CLASS = { URGENT: 'task-card-urgent', HIGH: 'task-card-high', NORMAL: 'task-card-normal', LOW: 'task-card-low' };

export function renderTasksTab(panel, reservation, reload, data = {}) {
  const allTasks = [...(data.tasks || [])].sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  const statuses = data.taskStatuses || [];
  const priorities = data.taskPriorities || [];
  const statusLabel = v => statuses.find(s => s.value === v)?.label || v;
  const priorityLabel = v => priorities.find(p => p.value === v)?.label || v;
  const today = new Date().toISOString().slice(0, 10);
  let activeFilter = 'PENDING';

  panel.innerHTML = `
    <div class="tab-toolbar task-toolbar">
      <button type="button" class="btn mini-action task-add">+ Adicionar tarefa</button>
      <div class="bo-subtabs task-filter-bar">
        <button type="button" class="bo-subtab is-active" data-filter="PENDING">Pendentes</button>
        <button type="button" class="bo-subtab" data-filter="DONE">Concluídas</button>
        <button type="button" class="bo-subtab" data-filter="ALL">Todas</button>
      </div>
    </div>
    <div class="task-card-grid"></div>`;

  const grid = panel.querySelector('.task-card-grid');

  function matchesFilter(t) {
    if (activeFilter === 'PENDING') return t.status !== 'DONE' && t.status !== 'CANCELLED';
    if (activeFilter === 'DONE') return t.status === 'DONE';
    return true;
  }

  function renderGrid() {
    const filtered = allTasks.filter(matchesFilter);
    grid.innerHTML = filtered.map(t => {
      const overdue = t.dueDate && t.dueDate < today && t.status !== 'DONE' && t.status !== 'CANCELLED';
      return `
        <div class="task-card ${PRIORITY_CLASS[t.priority] || ''}" data-task="${esc(t.id)}">
          <div class="task-card-head">
            <b>${esc(t.description)}</b>
            <button type="button" class="icon-action task-card-edit" title="Editar">✎</button>
            <button type="button" class="icon-action task-card-delete" title="Eliminar">🗑</button>
          </div>
          <div class="task-card-meta">
            ${t.assignee ? `${esc(t.assignee)} · ` : ''}<span class="${overdue ? 'task-overdue' : ''}">${t.dueDate ? esc(t.dueDate) : 'sem prazo'}</span>
            · ${esc(priorityLabel(t.priority))}
          </div>
          <select class="task-card-status">
            ${statuses.map(s => `<option value="${s.value}" ${s.value === t.status ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
          </select>
          <textarea class="task-card-resolution" rows="2" placeholder="O que foi resolvido...">${esc(t.notes || '')}</textarea>
        </div>`;
    }).join('') || '<p class="empty-note">Sem tarefas para este filtro.</p>';
    wireCardEvents();
  }

  async function quickSave(task, changes) {
    const updated = { ...task, ...changes };
    await api('/api/admin/reservations/tasks', {
      method: 'POST',
      body: JSON.stringify({
        reservationId: reservation.id, id: task.id, description: updated.description, assignee: updated.assignee,
        dueDate: updated.dueDate, priority: updated.priority, status: updated.status, notes: updated.notes
      })
    });
    Object.assign(task, changes);
    renderGrid();
  }

  function wireCardEvents() {
    grid.querySelectorAll('.task-card').forEach(card => {
      const task = allTasks.find(t => t.id === card.dataset.task);
      if (!task) return;

      card.querySelector('.task-card-status').onchange = async e => {
        try { await quickSave(task, { status: e.target.value }); }
        catch (err) { alert(err.message); }
      };

      const resolutionField = card.querySelector('.task-card-resolution');
      const initialNotes = task.notes || '';
      resolutionField.onblur = async () => {
        if (resolutionField.value === initialNotes) return;
        try { await quickSave(task, { notes: resolutionField.value }); }
        catch (err) { alert(err.message); }
      };

      card.querySelector('.task-card-edit').onclick = () => openTaskDrawer(task);
      card.querySelector('.task-card-delete').onclick = async () => {
        if (!confirm(`Eliminar "${task.description}"?`)) return;
        try {
          await api('/api/admin/reservations/tasks/delete', { method: 'POST', body: JSON.stringify({ id: task.id }) });
          await reload();
        } catch (err) { alert(err.message); }
      };
    });
  }

  function openTaskDrawer(task) {
    const body = openDrawer(task ? 'Editar tarefa' : 'Nova tarefa');
    body.innerHTML = `
      <form class="task-form">
        <div class="drawer-form-fields">
          <label>Descrição <input name="description" required value="${esc(task?.description || '')}" placeholder="ex.: pedir passaportes ao cliente" /></label>
          <label>Responsável <input name="assignee" value="${esc(task?.assignee || '')}" placeholder="ex.: Ana Costa" /></label>
          <label>Prazo <input type="date" name="dueDate" value="${esc(task?.dueDate || '')}" /></label>
          <label>Prioridade <select name="priority">${priorities.map(p => `<option value="${p.value}" ${(task?.priority || 'NORMAL') === p.value ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>
          <label>Estado <select name="status">${statuses.map(s => `<option value="${s.value}" ${(task?.status || 'TODO') === s.value ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></label>
        </div>
        <label class="service-line-notes">O que foi resolvido <textarea name="notes" rows="3">${esc(task?.notes || '')}</textarea></label>
        <div class="service-line-form-actions">
          <button class="btn mini-action" type="submit">${task ? 'Guardar alterações' : 'Adicionar tarefa'}</button>
        </div>
        <p class="customer-form-message"></p>
      </form>`;

    body.querySelector('.task-form').onsubmit = async ev => {
      ev.preventDefault();
      const f = ev.target;
      const btn = f.querySelector('button[type=submit]');
      const msg = body.querySelector('.customer-form-message');
      btn.disabled = true;
      try {
        await api('/api/admin/reservations/tasks', {
          method: 'POST',
          body: JSON.stringify({
            reservationId: reservation.id, id: task?.id, description: f.description.value, assignee: f.assignee.value,
            dueDate: f.dueDate.value, priority: f.priority.value, status: f.status.value, notes: f.notes.value
          })
        });
        await reload();
        closeDrawer();
      } catch (err) {
        msg.textContent = err.message;
        btn.disabled = false;
      }
    };
  }

  panel.querySelector('.task-add').onclick = () => openTaskDrawer(null);
  panel.querySelectorAll('.task-filter-bar button').forEach(btn => {
    btn.onclick = () => {
      activeFilter = btn.dataset.filter;
      panel.querySelectorAll('.task-filter-bar button').forEach(b => b.classList.toggle('is-active', b === btn));
      renderGrid();
    };
  });

  renderGrid();
}
