// Ficha da oportunidade: pagina completa (mesmo padrao de
// reservations/reservationDetail.js) com cabecalho fixo compacto e 7
// separadores - Resumo | Cliente | Viagem | Propostas | Comunicações |
// Tarefas | Histórico. Um unico pedido a /api/admin/opportunities/detail
// traz tudo o que os separadores precisam.

import { esc, money, api } from '../utils.js';
import { renderResumoTab } from './tabs/resumoTab.js';
import { renderClienteTab } from './tabs/clienteTab.js';
import { renderViagemTab } from './tabs/viagemTab.js';
import { renderPropostasTab } from './tabs/propostasTab.js';
import { renderComunicacoesTab } from './tabs/comunicacoesTab.js';
import { renderTarefasTab } from './tabs/tarefasTab.js';
import { renderHistoricoTab } from './tabs/historicoTab.js';

const TABS = [
  { key: 'resumo', label: 'Resumo', render: renderResumoTab },
  { key: 'cliente', label: 'Cliente', render: renderClienteTab },
  { key: 'viagem', label: 'Viagem', render: renderViagemTab },
  { key: 'propostas', label: 'Propostas', render: renderPropostasTab },
  { key: 'comunicacoes', label: 'Comunicações', render: renderComunicacoesTab },
  { key: 'tarefas', label: 'Tarefas', render: renderTarefasTab },
  { key: 'historico', label: 'Histórico', render: renderHistoricoTab }
];

const STAGE_PILL_CLASS = { GANHO: 'pill-ok', PERDIDO: 'pill-warning' };

function renderHeader(data) {
  const o = data.opportunity;
  const stageLabel = (data.stages || []).find(s => s.value === o.stage)?.label || o.stage;
  const paxCount = (o.paxAdults || 0) + (o.paxChildren || 0);

  return `
    <div class="process-header">
      <div class="process-header-title">
        <b>${esc(o.opportunityNumber)}</b> · ${esc(o.customerName)}${o.destination ? ` · ${esc(o.destination)}` : ''}
      </div>
      <div class="process-header-trip">${o.dateStart ? `${esc(o.dateStart)} → ${esc(o.dateEnd || '')} · ` : ''}${paxCount} passageiro${paxCount === 1 ? '' : 's'}${o.estimatedValue ? ` · ${money(o.estimatedValue)}` : ''}</div>
      <div class="process-header-status">
        <span class="pill process-status-pill ${STAGE_PILL_CLASS[o.stage] || ''}">${esc(stageLabel)}</span>
        ${o.health?.warnings?.map(w => `<span class="process-status-part">⚠ ${esc(w)}</span>`).join('') || ''}
      </div>
    </div>`;
}

export async function openOpportunityDetail(container, opportunityId, initialTab = 'resumo') {
  container.innerHTML = '<p class="muted">A carregar...</p>';
  let data;
  try {
    data = await api(`/api/admin/opportunities/detail?id=${encodeURIComponent(opportunityId)}`);
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
  const reload = () => openOpportunityDetail(container, opportunityId, activeTab);

  function showTab(key) {
    activeTab = key;
    container.querySelectorAll('.customer-tab').forEach(btn => btn.classList.toggle('is-active', btn.dataset.tab === key));
    TABS.find(t => t.key === key).render(panel, data, opportunityId, reload);
  }

  container.querySelectorAll('.customer-tab').forEach(btn => {
    btn.onclick = () => showTab(btn.dataset.tab);
  });

  showTab(initialTab);
}
