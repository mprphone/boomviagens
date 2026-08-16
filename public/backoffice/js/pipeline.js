// Vista "Pipeline": quadro comercial por arrasto (secao "Pipeline
// Comercial") - ecra principal da area COMERCIAL. Colunas = fases
// (OPPORTUNITY_STAGES), cartoes arrastaveis entre colunas
// (ver ./pipeline/opportunityCard.js); clicar num cartao abre a ficha
// completa como pagina inteira (ver ./pipeline/opportunityDetail.js),
// mesmo padrao de reservations.js/customers.js.

import { $, esc, money, api } from './utils.js';
import { openDrawer, closeDrawer } from './drawer.js';
import { attachDragHandlers, attachDropHandlers } from './kanban.js';
import { renderOpportunityCard } from './pipeline/opportunityCard.js';
import { openOpportunityDetail } from './pipeline/opportunityDetail.js';

// Agrupamento visual das colunas do quadro - as 8 fases reais
// (OPPORTUNITY_STAGES, ver src/domain.js) continuam a existir tal como
// estao gravadas; isto so decide como se distribuem por colunas no ecra.
// "A preparar proposta"/"Proposta enviada" e "Follow-up"/"Negociacao"
// partilham coluna (2 sub-lanes, cada uma com a sua propria zona de
// largar - kanban.js#attachDropHandlers ja suporta varias zonas por
// coluna, nao assume uma-para-uma), para caber 6 colunas no ecra em vez
// de 8 sem perder a distincao entre os 2 estados de cada par.
const COLUMN_GROUPS = [
  { key: 'NOVO_INTERESSE', stages: ['NOVO_INTERESSE'] },
  { key: 'CONTACTADO', stages: ['CONTACTADO'] },
  {
    key: 'PROPOSTA', label: 'Proposta', stages: ['A_PREPARAR_PROPOSTA', 'PROPOSTA_ENVIADA'],
    subLabels: { A_PREPARAR_PROPOSTA: 'A preparar', PROPOSTA_ENVIADA: 'Enviada' }
  },
  {
    key: 'EM_DECISAO', label: 'Em decisão', stages: ['FOLLOW_UP', 'NEGOCIACAO'],
    subLabels: { FOLLOW_UP: 'Follow-up', NEGOCIACAO: 'Negociação' }
  },
  { key: 'GANHO', stages: ['GANHO'] },
  { key: 'PERDIDO', stages: ['PERDIDO'] }
];

let allOpportunities = [];
let meta = {};
let staffList = [];
let staffById = new Map();
let branchList = [];
let summary = {};
const filters = { staffId: '', temperature: '', origin: '', destination: '', branchId: '' };

// Chamado a partir da Visão Geral da equipa antes de navegar para aqui,
// para o quadro abrir ja filtrado por esse colaborador.
export function filterPipelineByStaff(staffId) {
  filters.staffId = staffId;
}

// Mesma ideia, para o filtro de Agência (ver auditoria/multiagência).
export function filterPipelineByBranch(branchId) {
  filters.branchId = branchId;
}

export async function renderPipeline() {
  const el = $('#view-pipeline');
  el.innerHTML = `
    <div id="pipelineSummary" class="pipeline-summary"></div>
    <div class="panel">
      <div class="toolbar">
        <div class="pipeline-filters">
          <select id="filterStaff"><option value="">Todos os responsáveis</option></select>
          <select id="filterTemperature"><option value="">Todas as temperaturas</option></select>
          <select id="filterOrigin"><option value="">Todas as origens</option></select>
          <select id="filterBranch"><option value="">Todas as agências</option></select>
          <input id="filterDestination" type="search" placeholder="Destino..." />
        </div>
        <button type="button" class="btn mini-action" id="newOpportunityBtn">+ Nova oportunidade</button>
      </div>
      <div id="pipelineBoard" class="pipeline-board"><p class="muted">A carregar...</p></div>
    </div>`;

  $('#newOpportunityBtn').onclick = () => openOpportunityForm();
  ['filterStaff', 'filterTemperature', 'filterOrigin', 'filterBranch'].forEach(fieldId => {
    $(`#${fieldId}`).addEventListener('change', e => {
      const key = { filterStaff: 'staffId', filterTemperature: 'temperature', filterOrigin: 'origin', filterBranch: 'branchId' }[fieldId];
      filters[key] = e.target.value;
      renderBoard();
    });
  });
  $('#filterDestination').addEventListener('input', e => { filters.destination = e.target.value.trim().toLowerCase(); renderBoard(); });

  await loadPipeline();
}

async function loadPipeline() {
  try {
    const data = await api('/api/admin/opportunities');
    allOpportunities = data.opportunities;
    meta = {
      stages: data.stages, temperatures: data.temperatures, tags: data.tags,
      origins: data.origins, nextActionTypes: data.nextActionTypes, lossReasons: data.lossReasons
    };
    staffList = data.staff;
    staffById = new Map(staffList.map(s => [s.id, s]));
    branchList = data.branches || [];
    summary = data.summary;

    $('#filterStaff').innerHTML = '<option value="">Todos os responsáveis</option>' + staffList.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
    $('#filterTemperature').innerHTML = '<option value="">Todas as temperaturas</option>' + meta.temperatures.map(t => `<option value="${t.value}">${t.label}</option>`).join('');
    $('#filterOrigin').innerHTML = '<option value="">Todas as origens</option>' + meta.origins.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
    $('#filterBranch').innerHTML = '<option value="">Todas as agências</option>' + branchList.map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('');
    $('#filterStaff').value = filters.staffId;
    $('#filterTemperature').value = filters.temperature;
    $('#filterOrigin').value = filters.origin;
    $('#filterBranch').value = filters.branchId;

    renderSummary();
    renderBoard();
  } catch (err) {
    $('#pipelineBoard').innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

function renderSummary() {
  $('#pipelineSummary').innerHTML = `
    <div class="pipeline-summary-block"><span class="muted">Oportunidades ativas</span><strong>${summary.activeCount ?? 0}</strong></div>
    <div class="pipeline-summary-block"><span class="muted">Valor em pipeline</span><strong>${money(summary.pipelineValue)}</strong></div>
    <div class="pipeline-summary-block"><span class="muted">Leads quentes</span><strong>🔥 ${summary.hotCount ?? 0}</strong></div>
    <div class="pipeline-summary-block"><span class="muted">Ganhas no mês</span><strong>${money(summary.wonThisMonthValue)}</strong></div>
    <div class="pipeline-summary-block"><span class="muted">Taxa de conversão</span><strong>${summary.conversionRate ?? 0}%</strong></div>`;
}

function applyFilters(list) {
  return list.filter(o => {
    if (filters.staffId && o.commercialStaffId !== filters.staffId) return false;
    if (filters.temperature && o.temperature !== filters.temperature) return false;
    if (filters.origin && o.origin !== filters.origin) return false;
    if (filters.branchId && o.branchId !== filters.branchId) return false;
    if (filters.destination && !(o.destination || '').toLowerCase().includes(filters.destination)) return false;
    return true;
  });
}

function renderBoard() {
  const boardEl = $('#pipelineBoard');
  const filtered = applyFilters(allOpportunities);
  const stageMeta = new Map(meta.stages.map(s => [s.value, s]));

  boardEl.innerHTML = COLUMN_GROUPS.map(g => {
    const label = g.label || stageMeta.get(g.stages[0])?.label || g.stages[0];
    const body = g.stages.length > 1
      ? g.stages.map(stageValue => `
          <div class="pipeline-sublane">
            <div class="pipeline-sublane-head">
              <span>${esc(g.subLabels[stageValue])}</span>
              <span data-meta="${stageValue}"></span>
            </div>
            <div class="pipeline-col-body" data-col-value="${stageValue}"></div>
          </div>`).join('')
      : `<div class="pipeline-col-body" data-col-value="${g.stages[0]}"></div>`;
    return `
      <div class="pipeline-col">
        <div class="pipeline-col-head">
          <h3>${esc(label)}</h3>
          <div class="pipeline-col-meta" data-meta="${g.key}"></div>
        </div>
        ${body}
      </div>`;
  }).join('');

  meta.stages.forEach(s => {
    const stageOpportunities = filtered.filter(o => o.stage === s.value);
    const total = stageOpportunities.reduce((sum, o) => sum + (Number(o.estimatedValue) || 0), 0);
    const metaEl = boardEl.querySelector(`[data-meta="${s.value}"]`);
    if (metaEl) metaEl.textContent = `${stageOpportunities.length} · ${money(total)}`;

    const body = boardEl.querySelector(`.pipeline-col-body[data-col-value="${s.value}"]`);
    stageOpportunities.forEach(o => {
      const card = renderOpportunityCard(o, staffById);
      card.addEventListener('click', () => { if (!card.classList.contains('dragging')) openOpportunityPage(o.id); });
      attachDragHandlers(card);
      body.appendChild(card);
    });
  });

  // Contagem agregada no cabecalho de cada coluna (soma das fases do
  // grupo) - para colunas de 1 fase so, e o mesmo valor ja escrito acima.
  COLUMN_GROUPS.forEach(g => {
    const groupOpportunities = filtered.filter(o => g.stages.includes(o.stage));
    const total = groupOpportunities.reduce((sum, o) => sum + (Number(o.estimatedValue) || 0), 0);
    boardEl.querySelector(`.pipeline-col-meta[data-meta="${g.key}"]`).textContent = `${groupOpportunities.length} · ${money(total)}`;
  });

  attachDropHandlers(boardEl, async (opportunityId, newStage) => {
    const opportunity = allOpportunities.find(o => o.id === opportunityId);
    if (!opportunity || opportunity.stage === newStage) return;
    await handleStageChange(opportunity, newStage);
  });
}

async function moveStage(opportunityId, stage, extra = {}) {
  await api('/api/admin/opportunities/stage', { method: 'POST', body: JSON.stringify({ id: opportunityId, stage, ...extra }) });
}

async function handleStageChange(opportunity, newStage) {
  if (newStage === 'PERDIDO') { openLossDrawer(opportunity); return; }
  try {
    await moveStage(opportunity.id, newStage);
    if (newStage === 'GANHO') { await loadPipeline(); openConvertDrawer(opportunity.id); return; }
    await loadPipeline();
  } catch (err) {
    alert(err.message);
    await loadPipeline();
  }
}

function openLossDrawer(opportunity) {
  const body = openDrawer('Motivo da perda');
  body.innerHTML = `
    <form class="loss-form">
      <label>Motivo
        <select name="lossReason" required>
          <option value="">Selecionar...</option>
          ${meta.lossReasons.map(r => `<option value="${r.value}">${r.label}</option>`).join('')}
        </select>
      </label>
      <label>Observações <textarea name="lossNotes" rows="3"></textarea></label>
      <div class="service-line-form-actions">
        <button class="btn mini-action" type="submit">Marcar como perdida</button>
      </div>
      <p class="customer-form-message"></p>
    </form>`;
  body.querySelector('.loss-form').onsubmit = async ev => {
    ev.preventDefault();
    const f = ev.target;
    const btn = f.querySelector('button[type=submit]');
    const msg = body.querySelector('.customer-form-message');
    btn.disabled = true;
    try {
      await moveStage(opportunity.id, 'PERDIDO', { lossReason: f.lossReason.value, lossNotes: f.lossNotes.value });
      closeDrawer();
      await loadPipeline();
    } catch (err) {
      msg.textContent = err.message;
      btn.disabled = false;
    }
  };
}

function openConvertDrawer(opportunityId) {
  const operationalStaff = staffList.filter(s => s.role === 'OPERACIONAL' || s.role === 'ADMIN');
  const body = openDrawer('Oportunidade ganha 🎉');
  body.innerHTML = `
    <p>Criar o processo de viagem agora? Copia automaticamente cliente, destino, datas e valor da oportunidade.</p>
    <form class="convert-form">
      <label>Responsável operacional
        <select name="operationalStaffId">
          <option value="">Por definir</option>
          ${operationalStaff.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}
        </select>
      </label>
      <div class="service-line-form-actions">
        <button class="btn mini-action" type="submit">Criar processo</button>
        <button type="button" class="ghost mini-action convert-skip">Agora não</button>
      </div>
      <p class="customer-form-message"></p>
    </form>`;
  body.querySelector('.convert-skip').onclick = () => closeDrawer();
  body.querySelector('.convert-form').onsubmit = async ev => {
    ev.preventDefault();
    const f = ev.target;
    const btn = f.querySelector('button[type=submit]');
    const msg = body.querySelector('.customer-form-message');
    btn.disabled = true;
    try {
      const result = await api('/api/admin/opportunities/convert', { method: 'POST', body: JSON.stringify({ id: opportunityId, operationalStaffId: f.operationalStaffId.value }) });
      closeDrawer();
      alert(`Processo ${result.reservation.processNumber} criado.`);
      await loadPipeline();
    } catch (err) {
      msg.textContent = err.message;
      btn.disabled = false;
    }
  };
}

function openOpportunityForm() {
  const body = openDrawer('Nova oportunidade');
  body.innerHTML = `
    <form class="opportunity-form">
      <div class="drawer-form-fields">
        <label>Nome do cliente <input name="customerName" required /></label>
        <label>Email <input name="customerEmail" type="email" /></label>
        <label>Telefone <input name="customerPhone" /></label>
        <label>Destino <input name="destination" /></label>
        <label>Data início <input type="date" name="dateStart" /></label>
        <label>Data fim <input type="date" name="dateEnd" /></label>
        <label>Adultos <input type="number" name="paxAdults" min="0" value="2" /></label>
        <label>Crianças <input type="number" name="paxChildren" min="0" value="0" /></label>
        <label>Valor estimado (€) <input type="number" name="estimatedValue" min="0" step="0.01" /></label>
        <label>Origem <select name="origin"><option value="">Selecionar...</option>${meta.origins.map(o => `<option value="${o.value}">${o.label}</option>`).join('')}</select></label>
        <label>Temperatura <select name="temperature">${meta.temperatures.map(t => `<option value="${t.value}" ${t.value === 'MORNO' ? 'selected' : ''}>${t.label}</option>`).join('')}</select></label>
        <label>Responsável comercial <select name="commercialStaffId"><option value="">Por atribuir</option>${staffList.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></label>
        <label>Agência <select name="branchId">${branchList.map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}</select></label>
      </div>
      <label>Notas <textarea name="notes" rows="2"></textarea></label>
      <div class="service-line-form-actions">
        <button class="btn mini-action" type="submit">Criar oportunidade</button>
      </div>
      <p class="customer-form-message"></p>
    </form>`;
  body.querySelector('.opportunity-form').onsubmit = async ev => {
    ev.preventDefault();
    const f = ev.target;
    const btn = f.querySelector('button[type=submit]');
    const msg = body.querySelector('.customer-form-message');
    btn.disabled = true;
    try {
      await api('/api/admin/opportunities', {
        method: 'POST',
        body: JSON.stringify({
          customerName: f.customerName.value, customerEmail: f.customerEmail.value, customerPhone: f.customerPhone.value,
          destination: f.destination.value, dateStart: f.dateStart.value, dateEnd: f.dateEnd.value,
          paxAdults: f.paxAdults.value, paxChildren: f.paxChildren.value, estimatedValue: f.estimatedValue.value || undefined,
          origin: f.origin.value, temperature: f.temperature.value, commercialStaffId: f.commercialStaffId.value || undefined,
          branchId: f.branchId.value || undefined,
          notes: f.notes.value
        })
      });
      closeDrawer();
      await loadPipeline();
    } catch (err) {
      msg.textContent = err.message;
      btn.disabled = false;
    }
  };
}

// Exportado para poder ser chamado a partir de outras vistas (Follow-ups,
// Propostas) - troca a vista ativa para "Pipeline" e so depois abre a
// oportunidade, tal como reservations.js#openReservationPage faz.
export async function openOpportunityPage(opportunityId) {
  document.querySelectorAll('.nav-item[data-view]').forEach(btn => btn.classList.toggle('is-active', btn.dataset.view === 'pipeline'));
  document.querySelectorAll('.view').forEach(sec => { sec.hidden = sec.id !== 'view-pipeline'; });
  const title = $('#pageTitle');
  if (title) title.textContent = 'Pipeline';

  const el = $('#view-pipeline');
  el.innerHTML = `
    <button type="button" class="back-link">← Pipeline</button>
    <div class="panel process-page"></div>`;
  el.querySelector('.back-link').onclick = () => renderPipeline();
  await openOpportunityDetail(el.querySelector('.process-page'), opportunityId);
}
