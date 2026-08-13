// Vista "Resumo": KPIs, funil comercial e as duas listas de topo,
// todos alimentados por /api/admin/crm/overview (numeros reais, nada
// de probabilidades ou contagens inventadas).

import { $, esc, money, shortDate, api } from './utils.js';

export async function renderResumo() {
  const el = $('#view-resumo');
  el.innerHTML = '<p class="muted">A carregar...</p>';
  let data;
  try {
    data = await api('/api/admin/crm/overview');
  } catch (err) {
    el.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }
  const { kpis, funil, interessesRecentes, proximasViagens } = data;
  $('#companyBadge').textContent = data.company?.brand || 'Boomviagens';

  const maxFunnelCount = Math.max(1, ...funil.map(f => f.count));

  el.innerHTML = `
    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-icon indigo">🔥</div>
        <div class="kpi-value">${kpis.interessesHoje}</div>
        <div class="kpi-label">Novos interesses</div>
        <div class="kpi-sub">Hoje</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon blue">📑</div>
        <div class="kpi-value">${kpis.propostasAguardamResposta}</div>
        <div class="kpi-label">Propostas enviadas</div>
        <div class="kpi-sub">Aguardam resposta</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon green">✈️</div>
        <div class="kpi-value">${kpis.reservasConfirmadas}</div>
        <div class="kpi-label">Reservas</div>
        <div class="kpi-sub">Confirmadas</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon amber">💳</div>
        <div class="kpi-value">${kpis.pagamentosPendentes.count}</div>
        <div class="kpi-label">Pagamentos em falta</div>
        <div class="kpi-sub">${money(kpis.pagamentosPendentes.valor)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon indigo">🗓️</div>
        <div class="kpi-value">${kpis.proximasPartidas}</div>
        <div class="kpi-label">Viagens</div>
        <div class="kpi-sub">Próximos 7 dias</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Funil comercial</h2></div>
      <div class="funnel">
        ${funil.map(f => `
          <div class="funnel-stage">
            <div class="funnel-stage-label">${esc(f.label)}</div>
            <div class="funnel-stage-count">${f.count}</div>
            <div class="funnel-stage-value">${money(f.potentialValue)} potencial</div>
            <div class="funnel-stage-bar"><span style="width:${Math.round(f.count / maxFunnelCount * 100)}%"></span></div>
          </div>`).join('')}
      </div>
    </div>

    <div class="dashboard-columns">
      <div class="panel">
        <div class="panel-head"><h2>Interesses recentes</h2></div>
        ${interessesRecentes.length ? interessesRecentes.map(l => `
          <div class="list-row">
            <div class="list-row-main"><b>${esc(l.destination || 'Destino a definir')}</b><span>${esc(l.name || l.email || 'Sem contacto')}</span></div>
            <div class="list-row-side"><span class="stage-pill ${l.stage}">${esc(l.stageLabel)}</span><strong>${money(l.budget)}</strong></div>
          </div>`).join('') : '<p class="empty-note">Ainda sem interesses registados.</p>'}
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Próximas partidas</h2></div>
        ${proximasViagens.length ? proximasViagens.map(r => `
          <div class="list-row">
            <div class="list-row-main"><b>${esc(r.customerName || 'Cliente')}</b><span>${esc(r.destination)} · ${r.adults} adultos${r.children ? ` + ${r.children} crianças` : ''}</span></div>
            <div class="list-row-side"><strong>${shortDate(r.checkin)}</strong></div>
          </div>`).join('') : '<p class="empty-note">Sem partidas confirmadas nos próximos 7 dias.</p>'}
      </div>
    </div>`;
}
