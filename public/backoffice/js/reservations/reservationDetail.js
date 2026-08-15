// Ficha de Reserva ("Processo de Viagem"): pagina completa (nao modal - a
// quantidade de informacao nao cabia bem numa caixa) com cabecalho fixo
// compacto (sempre visivel, resume o que importa em qualquer separador)
// e os separadores. Um unico pedido a /api/admin/reservations/detail traz
// tudo o que os separadores precisam.

import { esc, money, api } from '../utils.js';
import { renderSummaryTab } from './summaryTab.js';
import { renderPassengersTab } from './passengersTab.js';
import { renderServicesTab } from './serviceLinesTab.js';
import { renderFinanceiroTab } from './financeiroTab.js';
import { renderDocumentsTab } from './documentsTab.js';
import { renderCommunicationsTab } from './communicationsTab.js';
import { renderTasksTab } from './tasksTab.js';
import { renderOccurrencesTab } from './occurrencesTab.js';
import { renderComplaintsTab } from './complaintsReservationTab.js';
import { renderHistoryTab } from './historyTab.js';

const TABS = [
  { key: 'resumo', label: 'Resumo', render: renderSummaryTab },
  { key: 'passageiros', label: 'Passageiros', render: renderPassengersTab },
  { key: 'reservas', label: 'Reservas', render: renderServicesTab },
  { key: 'financeiro', label: 'Financeiro', render: renderFinanceiroTab },
  { key: 'documentos', label: 'Documentos', render: renderDocumentsTab },
  { key: 'comunicacoes', label: 'Comunicações', render: renderCommunicationsTab },
  { key: 'tarefas', label: 'Tarefas', render: renderTasksTab },
  { key: 'ocorrencias', label: 'Ocorrências', render: renderOccurrencesTab },
  { key: 'reclamacoes', label: 'Reclamações', render: renderComplaintsTab },
  { key: 'historico', label: 'Histórico', render: renderHistoryTab }
];

function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(`${dateStr}T00:00:00`) - new Date()) / (1000 * 60 * 60 * 24));
}

function renderHeader(data) {
  const { reservation, alerts, tasks, payments } = data;
  const offer = reservation.offer || {};
  const paxCount = (offer.adults || 0) + (offer.children || 0);
  const statusMeta = data.statuses.find(s => s.value === reservation.status);
  const totalPaid = (payments || []).filter(p => p.status === 'PAID').reduce((sum, p) => sum + (p.amount || 0), 0);
  const dueFromCustomer = Math.max(0, (offer.finalPrice || 0) - totalPaid);
  const pendingTasks = (tasks || []).filter(t => t.status !== 'DONE' && t.status !== 'CANCELLED').length;
  const daysToDeparture = daysUntil(offer.checkin);

  const statusParts = [];
  if (alerts?.length) statusParts.push(`⚠ ${alerts.length} alerta${alerts.length > 1 ? 's' : ''}`);
  if (reservation.missingDocuments?.length) statusParts.push('📄 Documentação incompleta');
  if (pendingTasks) statusParts.push(`📋 ${pendingTasks} tarefa${pendingTasks > 1 ? 's' : ''} pendente${pendingTasks > 1 ? 's' : ''}`);
  if (daysToDeparture !== null) statusParts.push(daysToDeparture >= 0 ? `⏱ Partida em ${daysToDeparture} dias` : '✅ Viagem realizada');

  return `
    <div class="process-header">
      <div class="process-header-title">
        <b>${esc(reservation.processNumber)}</b> · ${esc(reservation.customer?.name || '')}
      </div>
      <div class="process-header-trip">${esc(offer.destination || '')} · ${esc(offer.checkin || '')} → ${esc(offer.checkout || '')} · ${paxCount} passageiro${paxCount === 1 ? '' : 's'}</div>
      <div class="process-header-status">
        <span class="pill process-status-pill">${esc(statusMeta?.label || reservation.status)}</span>
        ${statusParts.map(p => `<span class="process-status-part">${p}</span>`).join('')}
      </div>
      <div class="process-header-money">Venda ${money(offer.finalPrice)} · Recebido ${money(totalPaid)} · Por receber ${money(dueFromCustomer)}</div>
    </div>`;
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

  container.innerHTML = `
    ${renderHeader(data)}
    <div class="customer-tabs" role="tablist">
      ${TABS.map(t => `<button type="button" class="customer-tab ${t.key === initialTab ? 'is-active' : ''}" data-tab="${t.key}">${esc(t.label)}</button>`).join('')}
    </div>
    <div class="customer-tab-panel"></div>`;

  const panel = container.querySelector('.customer-tab-panel');
  let activeTab = initialTab;
  let activeFinanceiroSubTab = 'vendas';
  const reload = () => openReservationDetail(container, reservationId, activeTab);

  function showTab(key) {
    activeTab = key;
    container.querySelectorAll('.customer-tab').forEach(btn => btn.classList.toggle('is-active', btn.dataset.tab === key));
    const tab = TABS.find(t => t.key === key);
    if (key === 'financeiro') {
      const financeiroReload = subKey => { if (subKey) activeFinanceiroSubTab = subKey; reload(); };
      tab.render(panel, reservation, financeiroReload, data, activeFinanceiroSubTab);
    } else {
      tab.render(panel, reservation, reload, data);
    }
  }

  container.querySelectorAll('.customer-tab').forEach(btn => {
    btn.onclick = () => showTab(btn.dataset.tab);
  });

  showTab(initialTab);
}
