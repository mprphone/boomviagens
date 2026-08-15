// Ficha de Reserva ("Processo de Viagem"): cabecalho fixo com o essencial
// do processo, sempre visivel, mais os separadores. Um unico pedido a
// /api/admin/reservations/detail traz tudo o que os separadores precisam
// (servicos, historico, tarefas, reclamacoes, pagamentos, alertas) - ver
// ./serviceCalc.js e os tabs importados abaixo.

import { $, esc, money, api } from '../utils.js';
import { renderSummaryTab } from './summaryTab.js';
import { renderPassengersTab } from './passengersTab.js';
import { renderServicesTab } from './serviceLinesTab.js';
import { renderSalesTab } from './salesTab.js';
import { renderMarginsTab } from './marginsTab.js';
import { renderDocumentsTab } from './documentsTab.js';
import { renderCommunicationsTab } from './communicationsTab.js';
import { renderTasksTab } from './tasksTab.js';
import { renderOccurrencesTab } from './occurrencesTab.js';
import { renderComplaintsTab } from './complaintsReservationTab.js';
import { renderHistoryTab } from './historyTab.js';

const TABS = [
  { key: 'resumo', label: 'Resumo', render: renderSummaryTab },
  { key: 'passageiros', label: 'Passageiros', render: renderPassengersTab },
  { key: 'servicos', label: 'Serviços', render: renderServicesTab },
  { key: 'vendas', label: 'Vendas', render: renderSalesTab },
  { key: 'margens', label: 'Margens', render: renderMarginsTab },
  { key: 'documentos', label: 'Documentos', render: renderDocumentsTab },
  { key: 'comunicacoes', label: 'Comunicações', render: renderCommunicationsTab },
  { key: 'tarefas', label: 'Tarefas', render: renderTasksTab },
  { key: 'ocorrencias', label: 'Ocorrências', render: renderOccurrencesTab },
  { key: 'reclamacoes', label: 'Reclamações', render: renderComplaintsTab },
  { key: 'historico', label: 'Histórico', render: renderHistoryTab }
];

function alertIndicator(alerts) {
  if (!alerts?.length) return '<span class="process-flag process-flag-ok">🟢 Sem problemas</span>';
  const critical = alerts.some(a => a.severity === 'critical');
  return critical
    ? `<span class="process-flag process-flag-critical">🔴 ${alerts.length} alerta(s)</span>`
    : `<span class="process-flag process-flag-warning">🟡 ${alerts.length} alerta(s)</span>`;
}

export async function openReservationDetail(container, reservationId, initialTab = 'resumo') {
  container.innerHTML = '<p class="muted">A carregar...</p>';
  let data;
  try {
    data = await api(`/api/admin/reservations/detail?reservationId=${encodeURIComponent(reservationId)}`);
  } catch (err) {
    container.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }

  const { reservation } = data;
  const offer = reservation.offer || {};
  const paxCount = (offer.adults || 0) + (offer.children || 0);
  const statusMeta = data.statuses.find(s => s.value === reservation.status);

  container.innerHTML = `
    <div class="process-header">
      <div class="process-header-main">
        <b>${esc(reservation.processNumber)}</b>
        <span>${esc(reservation.customer?.name || '')}</span>
        <span>${esc(offer.destination || '')}</span>
        <span>${esc(offer.checkin || '')} → ${esc(offer.checkout || '')}</span>
        <span>${paxCount} pax</span>
        <span class="pill">${esc(statusMeta?.label || reservation.status)}</span>
        <span><b>${money(offer.finalPrice)}</b></span>
        ${alertIndicator(data.alerts)}
      </div>
    </div>
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
    TABS.find(t => t.key === key).render(panel, reservation, reload, data);
  }

  container.querySelectorAll('.customer-tab').forEach(btn => {
    btn.onclick = () => showTab(btn.dataset.tab);
  });

  showTab(initialTab);
}
