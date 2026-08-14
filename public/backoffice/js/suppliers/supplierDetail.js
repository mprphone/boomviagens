// Ficha do fornecedor: separadores Geral / Compras / Documentos,
// alimentados por /api/admin/suppliers/detail.

import { $, esc, api } from '../utils.js';
import { renderGeneralTab } from './generalTab.js';
import { renderPurchasesTab } from './purchasesTab.js';
import { renderDocumentsTab } from './documentsTab.js';

const TABS = [
  { key: 'geral', label: 'Geral', render: renderGeneralTab },
  { key: 'compras', label: 'Compras', render: renderPurchasesTab },
  { key: 'documentos', label: 'Documentos', render: renderDocumentsTab }
];

export async function openSupplierDetail(container, supplierId, initialTab = 'geral') {
  container.innerHTML = '<p class="muted">A carregar...</p>';
  let data;
  try {
    data = await api(`/api/admin/suppliers/detail?id=${encodeURIComponent(supplierId)}`);
  } catch (err) {
    container.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }

  container.innerHTML = `
    <div class="customer-tabs" role="tablist">
      ${TABS.map(t => `<button type="button" class="customer-tab ${t.key === initialTab ? 'is-active' : ''}" data-tab="${t.key}">${esc(t.label)}</button>`).join('')}
    </div>
    <div class="customer-tab-panel"></div>`;

  const panel = container.querySelector('.customer-tab-panel');
  let activeTab = initialTab;
  const reload = () => openSupplierDetail(container, supplierId, activeTab);

  function showTab(key) {
    activeTab = key;
    container.querySelectorAll('.customer-tab').forEach(btn => btn.classList.toggle('is-active', btn.dataset.tab === key));
    TABS.find(t => t.key === key).render(panel, data, reload);
  }

  container.querySelectorAll('.customer-tab').forEach(btn => {
    btn.onclick = () => showTab(btn.dataset.tab);
  });

  showTab(initialTab);
}
