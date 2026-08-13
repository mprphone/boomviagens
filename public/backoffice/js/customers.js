// Vista "Clientes": lista pesquisavel, cada cliente expande para notas
// internas e um resumo dos seus leads/reservas.

import { $, esc, api } from './utils.js';

// Mesmo mapeamento de src/domain.js#leadStageLabel - duplicado aqui de
// proposito (o backoffice nao importa ficheiros do servidor).
const LEAD_STAGE_LABELS = {
  NOVA: 'Novo interesse',
  EM_CONSULTA: 'Em consulta',
  PROPOSTA_ENVIADA: 'Proposta enviada',
  RESERVADO: 'Reservado',
  PERDIDA: 'Perdido'
};

let allCustomers = [];

export async function renderClientes() {
  const el = $('#view-clientes');
  el.innerHTML = `
    <div class="panel">
      <input id="customersSearch" type="search" placeholder="Pesquisar por nome ou email..." style="margin-bottom:14px" />
      <div id="customersList" class="customer-list"><p class="muted">A carregar...</p></div>
    </div>`;

  $('#customersSearch').addEventListener('input', renderList);
  await loadCustomers();
}

async function loadCustomers() {
  try {
    const data = await api('/api/admin/customers');
    allCustomers = data.customers;
    renderList();
  } catch (err) {
    $('#customersList').innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

function renderList() {
  const query = $('#customersSearch').value.trim().toLowerCase();
  const filtered = allCustomers.filter(c => !query || `${c.name} ${c.email}`.toLowerCase().includes(query));

  $('#customersList').innerHTML = filtered.map(c => `
    <div class="customer-row">
      <div class="customer-summary" data-email="${esc(c.email)}">
        <b>${esc(c.name)}</b> - ${esc(c.email)}<br>
        <span class="muted">${esc(c.phone)} · ${c.leadsCount} interesses · ${c.reservationsCount} reservas</span>
      </div>
      <div class="customer-detail" data-email="${esc(c.email)}" hidden></div>
    </div>`).join('') || '<p class="empty-note">Sem clientes.</p>';

  document.querySelectorAll('.customer-summary').forEach(el => {
    el.onclick = () => toggleDetail(el.dataset.email);
  });
}

async function toggleDetail(email) {
  const detailEl = document.querySelector(`.customer-detail[data-email="${email}"]`);
  if (!detailEl) return;
  if (!detailEl.hidden) { detailEl.hidden = true; return; }
  document.querySelectorAll('.customer-detail').forEach(el => { el.hidden = true; });
  detailEl.hidden = false;
  detailEl.innerHTML = 'A carregar...';
  try {
    const data = await api(`/api/admin/customers/detail?email=${encodeURIComponent(email)}`);
    detailEl.innerHTML = `
      <label>Notas internas
        <textarea class="customer-notes" rows="3">${esc(data.customer.notes)}</textarea>
      </label>
      <button class="ghost mini-action customer-save-notes">Guardar notas</button>
      <div class="customer-detail-line"><b>Interesses:</b> ${data.leads.map(l => `${esc(l.search?.destination)} (${esc(LEAD_STAGE_LABELS[l.status] || 'Novo interesse')})`).join(', ') || 'nenhum'}</div>
      <div class="customer-detail-line"><b>Reservas:</b> ${data.reservations.map(r => esc(r.id)).join(', ') || 'nenhuma'}</div>`;
    detailEl.querySelector('.customer-save-notes').onclick = async ev => {
      const btn = ev.target;
      const notes = detailEl.querySelector('.customer-notes').value;
      btn.disabled = true;
      const originalLabel = btn.textContent;
      btn.textContent = 'A guardar...';
      try {
        await api('/api/admin/customers/notes', { method: 'POST', body: JSON.stringify({ email, notes }) });
        btn.textContent = 'Guardado ✓';
        setTimeout(() => { btn.textContent = originalLabel; btn.disabled = false; }, 1500);
      } catch (err) {
        alert(err.message);
        btn.textContent = originalLabel;
        btn.disabled = false;
      }
    };
  } catch (err) {
    detailEl.innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}
