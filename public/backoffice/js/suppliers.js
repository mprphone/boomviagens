// Vista "Fornecedores": lista pesquisavel + criacao rapida; cada
// fornecedor abre uma ficha com separadores (Geral, Compras, Documentos)
// - ver ./suppliers/*.js.

import { $, esc, api } from './utils.js';
import { openSupplierDetail } from './suppliers/supplierDetail.js';

const TYPE_LABELS = { OPERADOR: 'Operador', HOTEL: 'Hotel', SEGURADORA: 'Seguradora', TRANSPORTE: 'Transporte', OUTRO: 'Outro' };

let allSuppliers = [];
let types = [];

export async function renderFornecedores() {
  const el = $('#view-fornecedores');
  el.innerHTML = `
    <div class="panel">
      <div class="toolbar">
        <input id="suppliersSearch" type="search" placeholder="Pesquisar por nome..." />
        <button type="button" class="btn mini-action" id="newSupplierBtn">+ Novo fornecedor</button>
      </div>
      <form id="newSupplierForm" class="customer-profile-grid" hidden style="margin-bottom:14px">
        <label>Nome <input name="name" required /></label>
        <label>Tipo
          <select name="type"></select>
        </label>
        <button class="btn mini-action" type="submit">Criar</button>
      </form>
      <div id="suppliersList" class="customer-list"><p class="muted">A carregar...</p></div>
    </div>`;

  $('#suppliersSearch').addEventListener('input', renderList);
  $('#newSupplierBtn').onclick = () => { $('#newSupplierForm').hidden = !$('#newSupplierForm').hidden; };

  await loadSuppliers();

  $('#newSupplierForm select[name=type]').innerHTML = types.map(t => `<option value="${t}">${TYPE_LABELS[t] || t}</option>`).join('');
  $('#newSupplierForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await api('/api/admin/suppliers', { method: 'POST', body: JSON.stringify({ name: e.target.name.value, type: e.target.type.value }) });
      e.target.reset();
      e.target.hidden = true;
      await loadSuppliers();
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
    }
  });
}

async function loadSuppliers() {
  try {
    const data = await api('/api/admin/suppliers');
    allSuppliers = data.suppliers;
    types = data.types;
    renderList();
  } catch (err) {
    $('#suppliersList').innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

function renderList() {
  const query = $('#suppliersSearch').value.trim().toLowerCase();
  const filtered = allSuppliers.filter(s => !query || s.name.toLowerCase().includes(query));

  $('#suppliersList').innerHTML = filtered.map(s => `
    <div class="customer-row">
      <div class="customer-summary" data-id="${esc(s.id)}">
        <b>${esc(s.name)}</b> - ${TYPE_LABELS[s.type] || esc(s.type)}<br>
        <span class="muted">${esc(s.email || 'sem email')} · ${s.purchasesCount} compra${s.purchasesCount === 1 ? '' : 's'} · custo total ${s.totalCost.toFixed(2)} €</span>
      </div>
      <div class="customer-detail" data-id="${esc(s.id)}" hidden></div>
    </div>`).join('') || '<p class="empty-note">Sem fornecedores.</p>';

  document.querySelectorAll('.customer-summary[data-id]').forEach(el => {
    el.onclick = () => toggleDetail(el.dataset.id);
  });
}

async function toggleDetail(supplierId) {
  const detailEl = document.querySelector(`.customer-detail[data-id="${supplierId}"]`);
  if (!detailEl) return;
  if (!detailEl.hidden) { detailEl.hidden = true; return; }
  document.querySelectorAll('.customer-detail').forEach(el => { el.hidden = true; });
  detailEl.hidden = false;
  await openSupplierDetail(detailEl, supplierId);
}
