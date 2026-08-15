// Ficha do cliente: cabecalho fixo com identidade + indicadores (Cliente
// desde/Nº viagens/Total faturado/Ultima e proxima viagem/Estado) e 7
// separadores - Resumo/Passageiros/Viagens/Documentos/Preferencias/
// Comunicacoes/Reclamacoes - todos alimentados por uma so chamada a
// /api/admin/customers/detail. Cada separador delega o render para o seu
// proprio modulo (ver ./resumoTab.js e vizinhos).

import { $, esc, api } from '../utils.js';
import { renderResumoTab } from './resumoTab.js';
import { renderPassengersTab } from './passengersTab.js';
import { renderTripsTab } from './tripsTab.js';
import { renderDocumentsTab } from './documentsTab.js';
import { renderPreferencesTab } from './preferencesTab.js';
import { renderCommunicationsTab } from './communicationsTab.js';
import { renderComplaintsTab } from './complaintsTab.js';

const TABS = [
  { key: 'resumo', label: 'Resumo', render: renderResumoTab },
  { key: 'passageiros', label: 'Passageiros', render: renderPassengersTab },
  { key: 'viagens', label: 'Viagens', render: renderTripsTab },
  { key: 'documentos', label: 'Documentos', render: renderDocumentsTab },
  { key: 'preferencias', label: 'Preferências', render: renderPreferencesTab },
  { key: 'comunicacoes', label: 'Comunicações', render: renderCommunicationsTab },
  { key: 'reclamacoes', label: 'Reclamações', render: renderComplaintsTab }
];

function renderHeader(data) {
  const c = data.customer;
  const ind = data.indicators;
  const nextTrip = ind.nextTrip ? `${esc(ind.nextTrip.hotel || ind.nextTrip.destination || ind.nextTrip.processNumber)}${ind.nextTrip.checkin ? ` · ${esc(ind.nextTrip.checkin)}` : ''}` : '—';
  const lastTrip = ind.lastTrip ? esc(ind.lastTrip.hotel || ind.lastTrip.destination || ind.lastTrip.processNumber) : '—';

  return `
    <div class="process-header">
      <div class="process-header-title">
        <b>${esc(c.name)}</b> · ${esc(c.email)}${c.phone ? ` · ${esc(c.phone)}` : ''}
      </div>
      <div class="process-header-trip">
        Cliente desde ${ind.customerSinceYear} · ${ind.tripsCount} viagem${ind.tripsCount === 1 ? '' : 'ns'} · ${new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(ind.totalBilled || 0)} faturados
      </div>
      <div class="process-header-status">
        <span class="pill process-status-pill">${esc(ind.estado)}</span>
        ${(c.alerts || []).map(a => `<span class="process-status-part">⚠ ${esc(a)}</span>`).join('')}
      </div>
      <div class="process-header-money">Última: ${lastTrip} · Próxima: ${nextTrip}</div>
    </div>`;
}

export async function openCustomerDetail(container, email, initialTab = 'resumo') {
  container.innerHTML = '<p class="muted">A carregar...</p>';
  let data;
  try {
    data = await api(`/api/admin/customers/detail?email=${encodeURIComponent(email)}`);
  } catch (err) {
    container.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }

  container.innerHTML = `
    ${renderHeader(data)}
    <div class="customer-tabs" role="tablist">
      ${TABS.map(t => `<button type="button" class="customer-tab ${t.key === initialTab ? 'is-active' : ''}" data-tab="${t.key}">${esc(t.label)}</button>`).join('')}
    </div>
    <div class="customer-tab-panel"></div>`;

  const panel = container.querySelector('.customer-tab-panel');
  let activeTab = initialTab;
  // Recarrega mantendo o separador onde o operador estava - sem isto, guardar
  // um contacto ou reclamacao saltava sempre de volta para "Resumo".
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
