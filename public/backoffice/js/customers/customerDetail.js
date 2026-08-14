// Ficha do cliente: separadores Geral / Viagens / Documentos / Contactos /
// Reclamacoes, todos alimentados por uma so chamada a
// /api/admin/customers/detail. Cada separador delega o render para o seu
// proprio modulo (ver ./generalTab.js e vizinhos).

import { $, esc, api } from '../utils.js';
import { renderGeneralTab } from './generalTab.js';
import { renderTripsTab } from './tripsTab.js';
import { renderDocumentsTab } from './documentsTab.js';
import { renderContactsTab } from './contactsTab.js';
import { renderComplaintsTab } from './complaintsTab.js';

const TABS = [
  { key: 'geral', label: 'Geral', render: renderGeneralTab },
  { key: 'viagens', label: 'Viagens', render: renderTripsTab },
  { key: 'documentos', label: 'Documentos', render: renderDocumentsTab },
  { key: 'contactos', label: 'Contactos', render: renderContactsTab },
  { key: 'reclamacoes', label: 'Reclamações', render: renderComplaintsTab }
];

export async function openCustomerDetail(container, email, initialTab = 'geral') {
  container.innerHTML = '<p class="muted">A carregar...</p>';
  let data;
  try {
    data = await api(`/api/admin/customers/detail?email=${encodeURIComponent(email)}`);
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
  // Recarrega mantendo o separador onde o operador estava - sem isto, guardar
  // um contacto ou reclamacao saltava sempre de volta para "Geral".
  const reload = () => openCustomerDetail(container, email, activeTab);

  function showTab(key) {
    activeTab = key;
    container.querySelectorAll('.customer-tab').forEach(btn => btn.classList.toggle('is-active', btn.dataset.tab === key));
    TABS.find(t => t.key === key).render(panel, data, email, reload);
  }

  container.querySelectorAll('.customer-tab').forEach(btn => {
    btn.onclick = () => showTab(btn.dataset.tab);
  });

  showTab(initialTab);
}
