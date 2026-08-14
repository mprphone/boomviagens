// Vista "Clientes": lista pesquisavel; cada cliente abre uma ficha
// completa com separadores (Geral, Viagens, Documentos, Contactos,
// Reclamacoes) - ver ./customers/customerDetail.js.

import { $, esc, api } from './utils.js';
import { openCustomerDetail } from './customers/customerDetail.js';

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
  await openCustomerDetail(detailEl, email);
}
