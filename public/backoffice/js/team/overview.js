// Separador "Visão Geral" da equipa: uma linha por colaborador com a carga
// de trabalho (secao "Visão Geral da Equipa" / "Carga de trabalho") e um
// resumo de performance comercial. Clicar num colaborador abre o Pipeline
// ou o Pipeline Operacional ja filtrado por essa pessoa.

import { $, esc, money, api } from '../utils.js';
import { filterPipelineByStaff } from '../pipeline.js';
import { filterOperacionalByStaff } from '../pipelineOperacional.js';

const WORKLOAD_LABEL = { green: '🟢 Disponível', yellow: '🟡 Carga média', red: '🔴 Sobrecarregado' };

export async function renderVisaoGeral() {
  const el = $('#view-visao-geral');
  el.innerHTML = `<div class="panel"><div id="overviewList"><p class="muted">A carregar...</p></div></div>`;
  try {
    const data = await api('/api/admin/team/overview');
    renderTable(data.overview);
  } catch (err) {
    $('#overviewList').innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

function renderTable(overview) {
  $('#overviewList').innerHTML = `
    <div class="bo-table-wrap">
      <table class="bo-table">
        <thead>
          <tr>
            <th>Colaborador</th><th>Carga</th><th>Oportunidades</th><th>Processos ativos</th>
            <th>Follow-ups hoje</th><th>Tarefas atrasadas</th><th>Viagens próximas</th>
            <th>Reclamações</th><th>Propostas enviadas</th><th>Ganhas/Perdidas</th><th>Conversão</th><th>Valor ganho</th>
          </tr>
        </thead>
        <tbody>
          ${overview.map(row => `
            <tr data-staff="${esc(row.staff.id)}">
              <td>
                <span class="staff-color-dot" style="background:${esc(row.staff.color || '#94a3b8')}"></span>
                <b>${esc(row.staff.name)}</b>
              </td>
              <td>${WORKLOAD_LABEL[row.workload.color]}</td>
              <td><button type="button" class="ghost mini-action goto-pipeline" data-staff="${esc(row.staff.id)}">${row.openOpportunities}</button></td>
              <td><button type="button" class="ghost mini-action goto-operacional" data-staff="${esc(row.staff.id)}">${row.activeReservations}</button></td>
              <td>${row.followUpsToday}</td>
              <td>${row.overdueTasks ? `<span class="pill pill-warning">${row.overdueTasks}</span>` : '0'}</td>
              <td>${row.upcomingTrips}</td>
              <td>${row.openComplaints ? `<span class="pill pill-warning">${row.openComplaints}</span>` : '0'}</td>
              <td>${row.proposalsSent}</td>
              <td>${row.wonCount} / ${row.lostCount}</td>
              <td>${row.conversionRate}%</td>
              <td>${money(row.wonValue)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` || '<p class="empty-note">Sem colaboradores ativos.</p>';

  document.querySelectorAll('.goto-pipeline').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      filterPipelineByStaff(btn.dataset.staff);
      document.querySelector('.nav-item[data-view=pipeline]')?.click();
    };
  });
  document.querySelectorAll('.goto-operacional').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      filterOperacionalByStaff(btn.dataset.staff);
      document.querySelector('.nav-item[data-view=pipeline-operacional]')?.click();
    };
  });
}
