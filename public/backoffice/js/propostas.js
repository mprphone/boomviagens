// Vista "Propostas": lista global de todas as propostas de todas as
// oportunidades (nao so as de uma) - substitui o antigo placeholder
// "em breve" do menu. Clicar numa linha abre a oportunidade a que pertence.

import { $, esc, money, api } from './utils.js';
import { openOpportunityPage } from './pipeline.js';

const STATUS_META = {
  RASCUNHO: { label: 'Rascunho', pill: '' }, ENVIADA: { label: 'Enviada', pill: '' }, VISTA: { label: 'Vista', pill: '' },
  ACEITE: { label: 'Aceite', pill: 'pill-ok' }, REJEITADA: { label: 'Rejeitada', pill: 'pill-warning' }, EXPIRADA: { label: 'Expirada', pill: 'pill-warning' }
};

let allProposals = [];

export async function renderPropostas() {
  const el = $('#view-propostas');
  el.innerHTML = `
    <div class="panel">
      <div class="toolbar">
        <input id="proposalsSearch" type="search" placeholder="Pesquisar por cliente ou destino..." />
        <select id="proposalsStatusFilter"><option value="">Todos os estados</option>${Object.entries(STATUS_META).map(([v, m]) => `<option value="${v}">${m.label}</option>`).join('')}</select>
      </div>
      <div id="proposalsList"><p class="muted">A carregar...</p></div>
    </div>`;

  $('#proposalsSearch').addEventListener('input', renderList);
  $('#proposalsStatusFilter').addEventListener('change', renderList);
  await loadProposals();
}

async function loadProposals() {
  try {
    const data = await api('/api/admin/proposals');
    allProposals = data.proposals;
    renderList();
  } catch (err) {
    $('#proposalsList').innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

function renderList() {
  const query = $('#proposalsSearch').value.trim().toLowerCase();
  const status = $('#proposalsStatusFilter').value;
  const filtered = allProposals.filter(p => {
    if (status && p.status !== status) return false;
    if (!query) return true;
    return `${p.opportunityCustomerName || ''} ${p.opportunityDestination || ''}`.toLowerCase().includes(query);
  });

  if (!filtered.length) {
    $('#proposalsList').innerHTML = '<p class="empty-note">Sem propostas.</p>';
    return;
  }

  $('#proposalsList').innerHTML = `
    <div class="bo-table-wrap">
      <table class="bo-table">
        <thead><tr><th>Cliente</th><th>Destino</th><th>Versão</th><th>Estado</th><th>Custo</th><th>Venda</th><th>Margem</th></tr></thead>
        <tbody>
          ${filtered.map(p => {
            const meta = STATUS_META[p.status] || STATUS_META.RASCUNHO;
            const margin = (p.saleValue ?? 0) - (p.costValue ?? 0);
            return `
            <tr data-opportunity="${esc(p.opportunityId)}">
              <td><b>${esc(p.opportunityCustomerName || '—')}</b></td>
              <td>${esc(p.opportunityDestination || '—')}</td>
              <td>V${p.version}</td>
              <td><span class="pill ${meta.pill}">${meta.label}</span></td>
              <td>${money(p.costValue)}</td>
              <td>${money(p.saleValue)}</td>
              <td>${money(margin)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

  document.querySelectorAll('#proposalsList tbody tr').forEach(row => {
    row.onclick = () => openOpportunityPage(row.dataset.opportunity);
  });
}
