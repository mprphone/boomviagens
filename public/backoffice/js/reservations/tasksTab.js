// Separador "Tarefas": checklist administrativo/operacional do processo
// (pedir passaportes, confirmar hotel, emitir seguro, cobrar saldo...).
// Tarefas em atraso (prazo passado, ainda nao concluidas) entram nos
// alertas do Resumo - ver domain.js#computeAlerts.

import { esc, api } from '../utils.js';

const PRIORITY_PILL = { URGENT: 'pill-warning', HIGH: 'pill-warning', LOW: '', NORMAL: '' };

export function renderTasksTab(panel, reservation, reload, data = {}) {
  const tasks = [...(data.tasks || [])].sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  const statuses = data.taskStatuses || [];
  const priorities = data.taskPriorities || [];
  const statusLabel = v => statuses.find(s => s.value === v)?.label || v;
  const priorityLabel = v => priorities.find(p => p.value === v)?.label || v;
  const today = new Date().toISOString().slice(0, 10);

  panel.innerHTML = `
    <div class="bo-table-wrap">
      <table class="bo-table">
        <thead><tr><th>Descrição</th><th>Responsável</th><th>Prazo</th><th>Prioridade</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          ${tasks.map(t => `
            <tr data-task="${esc(t.id)}">
              <td>${esc(t.description)}</td>
              <td class="muted small">${esc(t.assignee || '')}</td>
              <td class="${t.dueDate && t.dueDate < today && t.status !== 'DONE' && t.status !== 'CANCELLED' ? 'task-overdue' : 'muted small'}">${esc(t.dueDate || '')}</td>
              <td><span class="pill ${PRIORITY_PILL[t.priority] || ''}">${esc(priorityLabel(t.priority))}</span></td>
              <td><span class="pill ${t.status === 'DONE' ? 'pill-ok' : ''}">${esc(statusLabel(t.status))}</span></td>
              <td class="service-line-actions">
                ${t.status !== 'DONE' ? '<button type="button" class="ghost mini-action task-complete">Concluir</button>' : ''}
                <button type="button" class="ghost mini-action task-edit">Editar</button>
                <button type="button" class="ghost mini-action task-delete">Eliminar</button>
              </td>
            </tr>`).join('') || `<tr><td colspan="6" class="empty-note">Ainda sem tarefas neste processo.</td></tr>`}
        </tbody>
      </table>
    </div>

    <form class="task-form">
      <input type="hidden" name="id" />
      <p class="service-line-form-title">Adicionar tarefa</p>
      <div class="customer-profile-grid">
        <label>Descrição <input name="description" required placeholder="ex.: pedir passaportes ao cliente" /></label>
        <label>Responsável <input name="assignee" placeholder="ex.: Ana Costa" /></label>
        <label>Prazo <input type="date" name="dueDate" /></label>
        <label>Prioridade <select name="priority">${priorities.map(p => `<option value="${p.value}" ${p.value === 'NORMAL' ? 'selected' : ''}>${p.label}</option>`).join('')}</select></label>
        <label>Estado <select name="status">${statuses.map(s => `<option value="${s.value}">${s.label}</option>`).join('')}</select></label>
      </div>
      <label class="service-line-notes">Notas <textarea name="notes" rows="2"></textarea></label>
      <div class="service-line-form-actions">
        <button class="btn mini-action" type="submit">Adicionar tarefa</button>
        <button class="ghost mini-action task-cancel" type="button" hidden>Cancelar edição</button>
      </div>
      <p class="customer-form-message"></p>
    </form>`;

  const form = panel.querySelector('.task-form');
  const cancelBtn = panel.querySelector('.task-cancel');
  const submitBtn = form.querySelector('button[type="submit"]');
  const titleEl = panel.querySelector('.service-line-form-title');

  function resetForm() {
    form.reset();
    form.id.value = '';
    titleEl.textContent = 'Adicionar tarefa';
    submitBtn.textContent = 'Adicionar tarefa';
    cancelBtn.hidden = true;
  }
  cancelBtn.onclick = resetForm;

  async function saveTask(payload) {
    await api('/api/admin/reservations/tasks', { method: 'POST', body: JSON.stringify({ reservationId: reservation.id, ...payload }) });
    await reload();
  }

  panel.querySelectorAll('.task-edit').forEach(btn => {
    btn.onclick = () => {
      const task = tasks.find(t => t.id === btn.closest('tr').dataset.task);
      if (!task) return;
      form.id.value = task.id;
      form.description.value = task.description;
      form.assignee.value = task.assignee || '';
      form.dueDate.value = task.dueDate || '';
      form.priority.value = task.priority;
      form.status.value = task.status;
      form.notes.value = task.notes || '';
      titleEl.textContent = `A editar: ${task.description}`;
      submitBtn.textContent = 'Guardar alterações';
      cancelBtn.hidden = false;
      form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
  });

  panel.querySelectorAll('.task-complete').forEach(btn => {
    btn.onclick = async () => {
      const task = tasks.find(t => t.id === btn.closest('tr').dataset.task);
      if (!task) return;
      try { await saveTask({ id: task.id, description: task.description, assignee: task.assignee, dueDate: task.dueDate, priority: task.priority, status: 'DONE', notes: task.notes }); }
      catch (err) { alert(err.message); }
    };
  });

  panel.querySelectorAll('.task-delete').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Eliminar esta tarefa?')) return;
      try {
        await api('/api/admin/reservations/tasks/delete', { method: 'POST', body: JSON.stringify({ id: btn.closest('tr').dataset.task }) });
        await reload();
      } catch (err) { alert(err.message); }
    };
  });

  form.onsubmit = async ev => {
    ev.preventDefault();
    const msg = panel.querySelector('.customer-form-message');
    submitBtn.disabled = true;
    try {
      await saveTask({
        id: form.id.value || undefined,
        description: form.description.value,
        assignee: form.assignee.value,
        dueDate: form.dueDate.value,
        priority: form.priority.value,
        status: form.status.value,
        notes: form.notes.value
      });
    } catch (err) {
      msg.textContent = err.message;
      submitBtn.disabled = false;
    }
  };
}
