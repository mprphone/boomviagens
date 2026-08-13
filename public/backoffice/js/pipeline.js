// Vista "Interesses": pipeline em colunas por estagio (NOVA -> ... ->
// RESERVADO/PERDIDA). Mudar o estagio de um interesse usa a mesma rota
// /api/admin/leads/update que ja existia no backoffice antigo.

import { $, esc, money, api } from './utils.js';

let leadStagesMeta = [];

export async function renderInteresses() {
  const el = $('#view-interesses');
  el.innerHTML = '<p class="muted">A carregar...</p>';
  let data;
  try {
    data = await api('/api/admin/leads');
  } catch (err) {
    el.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }
  leadStagesMeta = data.leadStages;
  renderBoard(el, data.leads);
}

function renderBoard(el, leads) {
  el.innerHTML = `<div class="pipeline-board">${leadStagesMeta.map(stage => {
    const items = leads.filter(l => l.stage === stage.value);
    return `
      <div class="pipeline-col">
        <div class="pipeline-col-head"><h3>${esc(stage.label)}</h3><span class="pipeline-col-count">${items.length}</span></div>
        ${items.map(l => `
          <div class="pipeline-card">
            <div class="pipeline-card-dest">${esc(l.search?.destination || 'Destino a definir')}</div>
            <div class="pipeline-card-who">${esc(l.search?.name || l.search?.email || 'Sem contacto')}</div>
            <div class="pipeline-card-budget"><strong>${money(l.search?.budget)}</strong><span>orçamento</span></div>
            <select class="lead-stage-select" data-lead="${esc(l.id)}">
              ${leadStagesMeta.map(s => `<option value="${s.value}" ${s.value === stage.value ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
            </select>
          </div>`).join('') || '<p class="empty-note">Sem interesses.</p>'}
      </div>`;
  }).join('')}</div>`;

  el.querySelectorAll('.lead-stage-select').forEach(sel => {
    sel.addEventListener('change', () => updateStage(sel.dataset.lead, sel.value));
  });
}

async function updateStage(leadId, status) {
  try {
    await api('/api/admin/leads/update', { method: 'POST', body: JSON.stringify({ leadId, status }) });
    await renderInteresses();
  } catch (err) {
    alert(err.message);
  }
}
