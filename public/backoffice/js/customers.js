// Vista "Clientes": lista em tabela (nome, email, telefone, NIF,
// localidade, interesses, reservas); clicar numa linha abre a ficha
// completa (Geral/Viagens/Documentos/Contactos/Reclamacoes) numa caixa
// modal separada - ver ./customers/customerDetail.js e ./modal.js.

import { $, esc, api } from './utils.js';
import { openModal } from './modal.js';
import { openCustomerDetail } from './customers/customerDetail.js';

let allCustomers = [];

export async function renderClientes() {
  const el = $('#view-clientes');
  el.innerHTML = `
    <div class="panel">
      <input id="customersSearch" type="search" placeholder="Pesquisar por nome, email, telefone ou NIF..." style="margin-bottom:14px" />
      <div id="customersList"><p class="muted">A carregar...</p></div>
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
  const filtered = allCustomers.filter(c => !query || `${c.name} ${c.email} ${c.phone || ''} ${c.nif || ''}`.toLowerCase().includes(query));

  if (!filtered.length) {
    $('#customersList').innerHTML = '<p class="empty-note">Sem clientes.</p>';
    return;
  }

  $('#customersList').innerHTML = `
    <div class="bo-table-wrap">
      <table class="bo-table">
        <thead>
          <tr>
            <th>Nome</th><th>Email</th><th>Telefone</th><th>NIF</th><th>Localidade</th>
            <th>Interesses</th><th>Reservas</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(c => `
            <tr data-email="${esc(c.email)}">
              <td><b>${esc(c.name)}</b></td>
              <td><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></td>
              <td>${c.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : '—'}</td>
              <td>${esc(c.nif || '—')}</td>
              <td>${esc(c.city || '—')}</td>
              <td>${c.leadsCount}</td>
              <td>${c.reservationsCount}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  document.querySelectorAll('#customersList tbody tr').forEach(row => {
    row.onclick = () => {
      const panel = openModal(`Cliente - ${row.dataset.email}`);
      openCustomerDetail(panel, row.dataset.email);
    };
  });
}
