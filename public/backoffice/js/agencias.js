// Vista "Agências": lista + criação/edição rápida, mesmo padrão de
// ./team.js - entidade pequena, não justifica página inteira. Gerida
// pelo próprio utilizador (nada de nomes fixos no código, ver
// auditoria/multiagência) - outras vistas (Pipeline, Reservas, Equipa)
// pedem esta lista via GET /api/admin/branches para os seus dropdowns.

import { $, esc, api } from './utils.js';

let allBranches = [];

export async function renderAgencias() {
  const el = $('#view-agencias');
  el.innerHTML = `
    <div class="panel">
      <div class="toolbar">
        <input id="branchSearch" type="search" placeholder="Pesquisar por nome ou código..." />
        <button type="button" class="btn mini-action" id="newBranchBtn">+ Nova agência</button>
      </div>
      <form id="newBranchForm" class="customer-profile-grid" hidden style="margin-bottom:14px">
        <label>Nome <input name="name" required placeholder="ex.: Fafe" /></label>
        <label>Código <input name="code" placeholder="ex.: FAF" maxlength="20" /></label>
        <button class="btn mini-action" type="submit">Criar</button>
        <p class="customer-form-message"></p>
      </form>
      <div id="branchList" class="customer-list"><p class="muted">A carregar...</p></div>
    </div>`;

  $('#branchSearch').addEventListener('input', renderList);
  $('#newBranchBtn').onclick = () => { $('#newBranchForm').hidden = !$('#newBranchForm').hidden; };

  await loadBranches();

  $('#newBranchForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button[type=submit]');
    const msg = f.querySelector('.customer-form-message');
    btn.disabled = true;
    try {
      await api('/api/admin/branches', { method: 'POST', body: JSON.stringify({ name: f.name.value, code: f.code.value }) });
      f.reset();
      f.hidden = true;
      await loadBranches();
    } catch (err) {
      msg.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
}

async function loadBranches() {
  try {
    const data = await api('/api/admin/branches');
    allBranches = data.branches;
    renderList();
  } catch (err) {
    $('#branchList').innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

function renderList() {
  const query = $('#branchSearch').value.trim().toLowerCase();
  const filtered = allBranches.filter(b => !query || `${b.name} ${b.code || ''}`.toLowerCase().includes(query));

  $('#branchList').innerHTML = filtered.map(b => `
    <div class="customer-row">
      <div class="customer-summary" data-id="${esc(b.id)}">
        <b>${esc(b.name)}</b>${b.code ? ` · ${esc(b.code)}` : ''} ${b.active ? '' : '<span class="pill pill-warning">Inativa</span>'}
      </div>
      <div class="customer-detail" data-id="${esc(b.id)}" hidden></div>
    </div>`).join('') || '<p class="empty-note">Sem agências criadas ainda.</p>';

  document.querySelectorAll('#branchList .customer-summary[data-id]').forEach(el => {
    el.onclick = () => toggleDetail(el.dataset.id);
  });
}

function toggleDetail(branchId) {
  const detailEl = document.querySelector(`#branchList .customer-detail[data-id="${branchId}"]`);
  if (!detailEl) return;
  if (!detailEl.hidden) { detailEl.hidden = true; return; }
  document.querySelectorAll('#branchList .customer-detail').forEach(el => { el.hidden = true; });
  detailEl.hidden = false;
  renderBranchForm(detailEl, allBranches.find(b => b.id === branchId));
}

function renderBranchForm(panel, b) {
  panel.innerHTML = `
    <form class="customer-profile-form">
      <div class="customer-profile-grid">
        <label>Nome <input name="name" value="${esc(b.name)}" required /></label>
        <label>Código <input name="code" value="${esc(b.code || '')}" maxlength="20" /></label>
        <label class="service-line-checkbox"><input type="checkbox" name="active" ${b.active ? 'checked' : ''} /> Ativa</label>
      </div>
      <button class="btn mini-action" type="submit">Guardar</button>
      <p class="customer-form-message"></p>
    </form>`;

  panel.querySelector('.customer-profile-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button[type=submit]');
    const msg = panel.querySelector('.customer-form-message');
    btn.disabled = true;
    btn.textContent = 'A guardar...';
    try {
      await api('/api/admin/branches', { method: 'POST', body: JSON.stringify({ id: b.id, name: f.name.value, code: f.code.value, active: f.active.checked }) });
      btn.textContent = 'Guardado ✓';
      await loadBranches();
    } catch (err) {
      msg.textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Guardar';
    }
  });
}
