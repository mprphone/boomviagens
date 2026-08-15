// Separador "Tarefas": checklist da oportunidade (preparar proposta,
// ligar ao cliente...) - botao "+ Adicionar" abre uma gaveta lateral,
// mesmo padrao usado no resto da ficha.

import { esc, api } from '../../utils.js';
import { openDrawer, closeDrawer } from '../../drawer.js';

const STATUS_LABEL = { TODO: 'Por fazer', IN_PROGRESS: 'Em curso', AWAITING_CUSTOMER: 'A aguardar cliente', AWAITING_SUPPLIER: 'A aguardar fornecedor', DONE: 'Concluída', CANCELLED: 'Cancelada' };
const STATUSES = Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }));
const PRIORITY_LABEL = { LOW: 'Baixa', NORMAL: 'Normal', HIGH: 'Alta', URGENT: 'Urgente' };
const PRIORITIES = Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }));

export function renderTarefasTab(panel, data, opportunityId, reload) {
  const tasks = data.tasks || [];
  const staffById = new Map((data.staff || []).map(s => [s.id, s]));
  const today = new Date().toISOString().slice(0, 10);

  panel.innerHTML = `
    <div class="tab-toolbar">
      <button type="button" class="btn mini-action task-add">+ Adicionar tarefa</button>
    </div>
    <div class="complaint-list">
      ${tasks.map(t => {
        const overdue = t.dueDate && t.dueDate < today && t.status !== 'DONE' && t.status !== 'CANCELLED';
        const assignee = staffById.get(t.assigneeStaffId)?.name || t.assignee;
        return `
        <div class="complaint-item" data-task="${esc(t.id)}">
          <div class="complaint-head">
            <b>${esc(t.description)}</b>
            <span class="pill ${t.status === 'DONE' ? 'pill-ok' : overdue ? 'pill-warning' : ''}">${esc(STATUS_LABEL[t.status] || t.status)}</span>
            ${overdue ? '<span class="pill pill-warning">Atrasada</span>' : ''}
          </div>
          <p class="muted small">${assignee ? `${esc(assignee)} · ` : ''}${t.dueDate ? `prazo ${esc(t.dueDate)} · ` : ''}${esc(PRIORITY_LABEL[t.priority] || t.priority)}</p>
        </div>`;
      }).join('') || '<p class="empty-note">Ainda sem tarefas.</p>'}
    </div>`;

  panel.querySelector('.task-add').onclick = () => openTaskDrawer(null);
  panel.querySelectorAll('.complaint-item').forEach(item => {
    item.onclick = () => openTaskDrawer(tasks.find(t => t.id === item.dataset.task));
  });

  function openTaskDrawer(task) {
    const body = openDrawer(task ? 'Editar tarefa' : 'Nova tarefa');
    body.innerHTML = `
      <form class="task-form">
        <label>Descrição <input name="description" required value="${esc(task?.description || '')}" /></label>
        <div class="drawer-form-fields">
          <label>Responsável
            <select name="assigneeStaffId">
              <option value="">Por atribuir</option>
              ${(data.staff || []).map(s => `<option value="${esc(s.id)}" ${task?.assigneeStaffId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
            </select>
          </label>
          <label>Prazo <input type="date" name="dueDate" value="${esc(task?.dueDate || '')}" /></label>
          <label>Prioridade <select name="priority">${PRIORITIES.map(p => `<option value="${p.value}" ${(task?.priority || 'NORMAL') === p.value ? 'selected' : ''}>${p.label}</option>`).join('')}</select></label>
          <label>Estado <select name="status">${STATUSES.map(s => `<option value="${s.value}" ${(task?.status || 'TODO') === s.value ? 'selected' : ''}>${s.label}</option>`).join('')}</select></label>
        </div>
        <label class="service-line-notes">Notas <textarea name="notes" rows="2">${esc(task?.notes || '')}</textarea></label>
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
            id: task?.id, opportunityId, description: f.description.value, assigneeStaffId: f.assigneeStaffId.value || undefined,
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
}
