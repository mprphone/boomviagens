// Ficha de Reserva: separadores Resumo / Passageiros / Documentos /
// Emissoes. Busca a reserva atual (ja vem na lista, mas ir buscar de novo
// garante dados frescos apos qualquer alteracao feita noutro separador).

import { $, esc, api } from '../utils.js';
import { renderSummaryTab } from './summaryTab.js';
import { renderPassengersTab } from './passengersTab.js';
import { renderDocumentsTab } from './documentsTab.js';
import { renderInvoiceTab } from './invoiceTab.js';

const TABS = [
  { key: 'resumo', label: 'Resumo', render: renderSummaryTab },
  { key: 'passageiros', label: 'Passageiros', render: renderPassengersTab },
  { key: 'documentos', label: 'Documentos', render: renderDocumentsTab },
  { key: 'emissoes', label: 'Emissões', render: renderInvoiceTab }
];

export async function openReservationDetail(container, reservationId, initialTab = 'resumo') {
  container.innerHTML = '<p class="muted">A carregar...</p>';
  let reservation;
  try {
    const data = await api('/api/admin/reservations');
    reservation = data.reservations.find(r => r.id === reservationId);
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

  function showTab(key) {
    activeTab = key;
    container.querySelectorAll('.customer-tab').forEach(btn => btn.classList.toggle('is-active', btn.dataset.tab === key));
    TABS.find(t => t.key === key).render(panel, reservation, reload);
  }

  container.querySelectorAll('.customer-tab').forEach(btn => {
    btn.onclick = () => showTab(btn.dataset.tab);
  });

  showTab(initialTab);
}
