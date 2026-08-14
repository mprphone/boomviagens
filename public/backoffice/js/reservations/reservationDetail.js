// Ficha de Reserva: separadores Resumo / Passageiros / Servicos /
// Documentos / Historico / Emissoes. Busca a reserva e os dados de
// servicos/historico atuais de cada vez (ja vem na lista, mas ir buscar de
// novo garante dados frescos apos qualquer alteracao feita noutro
// separador). Os dados de servicos ficam num "ctx" partilhado por todos os
// separadores (ver ./serviceLinesTab.js), em vez de cada um ir busca-los
// outra vez.

import { $, esc, api } from '../utils.js';
import { renderSummaryTab } from './summaryTab.js';
import { renderPassengersTab } from './passengersTab.js';
import { renderServicesTab } from './serviceLinesTab.js';
import { renderDocumentsTab } from './documentsTab.js';
import { renderHistoryTab } from './historyTab.js';
import { renderInvoiceTab } from './invoiceTab.js';

const TABS = [
  { key: 'resumo', label: 'Resumo', render: renderSummaryTab },
  { key: 'passageiros', label: 'Passageiros', render: renderPassengersTab },
  { key: 'servicos', label: 'Serviços', render: renderServicesTab },
  { key: 'documentos', label: 'Documentos', render: renderDocumentsTab },
  { key: 'historico', label: 'Histórico', render: renderHistoryTab },
  { key: 'emissoes', label: 'Emissões', render: renderInvoiceTab }
];

export async function openReservationDetail(container, reservationId, initialTab = 'resumo') {
  container.innerHTML = '<p class="muted">A carregar...</p>';
  let reservation, statuses, services;
  try {
    const [reservationsData, servicesData] = await Promise.all([
      api('/api/admin/reservations'),
      api(`/api/admin/reservations/services?reservationId=${encodeURIComponent(reservationId)}`)
    ]);
    reservation = reservationsData.reservations.find(r => r.id === reservationId);
    statuses = reservationsData.statuses;
    services = servicesData;
  } catch (err) {
    container.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }
  if (!reservation) {
    container.innerHTML = '<p class="error">Reserva não encontrada.</p>';
    return;
  }

  container.innerHTML = `
    <div class="customer-tabs" role="tablist">
      ${TABS.map(t => `<button type="button" class="customer-tab ${t.key === initialTab ? 'is-active' : ''}" data-tab="${t.key}">${esc(t.label)}</button>`).join('')}
    </div>
    <div class="customer-tab-panel"></div>`;

  const panel = container.querySelector('.customer-tab-panel');
  let activeTab = initialTab;
  const reload = () => openReservationDetail(container, reservationId, activeTab);
  const ctx = { statuses, services };

  function showTab(key) {
    activeTab = key;
    container.querySelectorAll('.customer-tab').forEach(btn => btn.classList.toggle('is-active', btn.dataset.tab === key));
    TABS.find(t => t.key === key).render(panel, reservation, reload, ctx);
  }

  container.querySelectorAll('.customer-tab').forEach(btn => {
    btn.onclick = () => showTab(btn.dataset.tab);
  });

  showTab(initialTab);
}
