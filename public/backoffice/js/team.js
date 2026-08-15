// Vista "Equipa": lista pesquisavel de colaboradores + criacao rapida;
// clicar num colaborador expande a ficha para editar (mesmo padrao de
// ./suppliers.js - entidade pequena, nao justifica pagina inteira).
// Cada colaborador tem login proprio (username/password) e um perfil
// (COMERCIAL/OPERACIONAL/FINANCEIRO/SUPERVISOR/ADMIN) que decide o que
// pode fazer - ver server.js (verificacao de "roles" por rota).

import { $, esc, api } from './utils.js';

let allStaff = [];
let roles = [];

function roleLabel(role) {
  return roles.find(r => r.value === role)?.label || role;
}

export async function renderEquipa() {
  const el = $('#view-equipa');
  el.innerHTML = `
    <div class="panel">
      <div class="toolbar">
        <input id="staffSearch" type="search" placeholder="Pesquisar por nome ou utilizador..." />
        <button type="button" class="btn mini-action" id="newStaffBtn">+ Novo colaborador</button>
      </div>
      <form id="newStaffForm" class="customer-profile-grid" hidden style="margin-bottom:14px">
        <label>Nome <input name="name" required /></label>
        <label>Utilizador <input name="username" required placeholder="ex.: ana.costa" /></label>
        <label>Password <input name="password" type="password" required minlength="8" /></label>
        <label>Email <input name="email" type="email" /></label>
        <label>Perfil <select name="role"></select></label>
        <label>Cor <input name="color" type="color" value="#4f46e5" /></label>
        <button class="btn mini-action" type="submit">Criar</button>
        <p class="customer-form-message"></p>
      </form>
      <div id="staffList" class="customer-list"><p class="muted">A carregar...</p></div>
    </div>`;

  $('#staffSearch').addEventListener('input', renderList);
  $('#newStaffBtn').onclick = () => { $('#newStaffForm').hidden = !$('#newStaffForm').hidden; };

  await loadStaff();

  $('#newStaffForm select[name=role]').innerHTML = roles.map(r => `<option value="${r.value}">${esc(r.label)}</option>`).join('');
  $('#newStaffForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button[type=submit]');
    const msg = f.querySelector('.customer-form-message');
    btn.disabled = true;
    try {
      await api('/api/admin/staff', {
        method: 'POST',
        body: JSON.stringify({ name: f.name.value, username: f.username.value, password: f.password.value, email: f.email.value, role: f.role.value, color: f.color.value })
      });
      f.reset();
      f.hidden = true;
      await loadStaff();
    } catch (err) {
      msg.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
}

async function loadStaff() {
  try {
    const data = await api('/api/admin/staff');
    allStaff = data.staff;
    roles = data.roles;
    renderList();
  } catch (err) {
    $('#staffList').innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

function renderList() {
  const query = $('#staffSearch').value.trim().toLowerCase();
  const filtered = allStaff.filter(s => !query || `${s.name} ${s.username}`.toLowerCase().includes(query));

  $('#staffList').innerHTML = filtered.map(s => `
    <div class="customer-row">
      <div class="customer-summary" data-id="${esc(s.id)}">
        <span class="staff-color-dot" style="background:${esc(s.color || '#94a3b8')}"></span>
        <b>${esc(s.name)}</b> · ${esc(roleLabel(s.role))} ${s.active ? '' : '<span class="pill pill-warning">Inativo</span>'}<br>
        <span class="muted">@${esc(s.username)}${s.email ? ` · ${esc(s.email)}` : ''}</span>
      </div>
      <div class="customer-detail" data-id="${esc(s.id)}" hidden></div>
    </div>`).join('') || '<p class="empty-note">Sem colaboradores.</p>';

  document.querySelectorAll('.customer-summary[data-id]').forEach(el => {
    el.onclick = () => toggleDetail(el.dataset.id);
  });
}

function toggleDetail(staffId) {
  const detailEl = document.querySelector(`.customer-detail[data-id="${staffId}"]`);
  if (!detailEl) return;
  if (!detailEl.hidden) { detailEl.hidden = true; return; }
  document.querySelectorAll('.customer-detail').forEach(el => { el.hidden = true; });
  detailEl.hidden = false;
  renderStaffForm(detailEl, allStaff.find(s => s.id === staffId));
}

function renderStaffForm(panel, s) {
  panel.innerHTML = `
    <form class="customer-profile-form">
      <div class="customer-profile-grid">
        <label>Nome <input name="name" value="${esc(s.name)}" required /></label>
        <label>Utilizador <input name="username" value="${esc(s.username)}" required /></label>
        <label>Nova password <input name="password" type="password" minlength="8" placeholder="deixar vazio para manter" /></label>
        <label>Email <input name="email" type="email" value="${esc(s.email || '')}" /></label>
        <label>Perfil <select name="role">${roles.map(r => `<option value="${r.value}" ${r.value === s.role ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select></label>
        <label>Cor <input name="color" type="color" value="${esc(s.color || '#4f46e5')}" /></label>
        <label class="service-line-checkbox"><input type="checkbox" name="active" ${s.active ? 'checked' : ''} /> Ativo</label>
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
      await api('/api/admin/staff', {
        method: 'POST',
        body: JSON.stringify({
          id: s.id, name: f.name.value, username: f.username.value, password: f.password.value,
          email: f.email.value, role: f.role.value, color: f.color.value, active: f.active.checked
        })
      });
      btn.textContent = 'Guardado ✓';
      await loadStaff();
    } catch (err) {
      msg.textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Guardar';
    }
  });
}
