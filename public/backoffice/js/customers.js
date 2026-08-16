// Vista "Clientes": lista em tabela (nome, email, telefone, NIF,
// localidade, interesses, reservas) + criacao rapida (mesmo padrao de
// ./team.js e ./agencias.js - formulario escondido ate clicar em "+ Novo
// Cliente"); clicar numa linha (ou no icone ✎) abre a ficha completa como
// pagina inteira dentro da mesma vista (nao uma caixa modal - com viagens,
// passageiros, documentos, preferencias, comunicacoes e reclamacoes nao
// cabia bem numa caixa), com um botao "← Clientes" para voltar a lista -
// ver ./customers/customerDetail.js.

import { $, esc, api } from './utils.js';
import { openCustomerDetail } from './customers/customerDetail.js';

let allCustomers = [];

export async function renderClientes() {
  const el = $('#view-clientes');
  el.innerHTML = `
    <div class="panel">
      <div class="toolbar">
        <input id="customersSearch" type="search" placeholder="Pesquisar por nome, email, telefone ou NIF..." />
        <button type="button" class="btn mini-action" id="newCustomerBtn">+ Novo cliente</button>
      </div>
      <form id="newCustomerForm" class="customer-profile-grid" hidden style="margin-bottom:14px">
        <label>Nome <input name="name" required /></label>
        <label>Email <input name="email" type="email" required /></label>
        <label>Telefone <input name="phone" /></label>
        <button class="btn mini-action" type="submit">Criar</button>
        <p class="customer-form-message"></p>
      </form>
      <div id="customersList"><p class="muted">A carregar...</p></div>
    </div>`;

  $('#customersSearch').addEventListener('input', renderList);
  $('#newCustomerBtn').onclick = () => { $('#newCustomerForm').hidden = !$('#newCustomerForm').hidden; };
  $('#newCustomerForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button[type=submit]');
    const msg = f.querySelector('.customer-form-message');
    btn.disabled = true;
    try {
      const customer = await api('/api/admin/customers/update', {
        method: 'POST',
        body: JSON.stringify({ email: f.email.value, name: f.name.value, phone: f.phone.value })
      });
      await openCustomerPage(customer.customer.email);
    } catch (err) {
      msg.textContent = err.message;
      btn.disabled = false;
    }
  });

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
            <th>Interesses</th><th>Reservas</th><th></th>
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
              <td class="service-line-actions"><button type="button" class="icon-action customer-row-edit" title="Ver/editar">✎</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  document.querySelectorAll('#customersList tbody tr').forEach(row => {
    row.onclick = () => openCustomerPage(row.dataset.email);
    row.querySelector('.customer-row-edit').onclick = ev => { ev.stopPropagation(); openCustomerPage(row.dataset.email); };
  });
}

export async function openCustomerPage(email) {
  const el = $('#view-clientes');
  el.innerHTML = `
    <button type="button" class="back-link">← Clientes</button>
    <div class="panel process-page"></div>`;
  el.querySelector('.back-link').onclick = () => renderClientes();
  await openCustomerDetail(el.querySelector('.process-page'), email);
}
