// Vistas "Margens", "Emails" e "Operador" - a ultima parte do painel
// antigo que faltava portar para o novo shell. Todas as tres leem de
// /api/admin/dashboard, que ja calcula exatamente estes dados; o
// diagnostico ao operador usa /api/admin/operator/tourdiez/test.

import { $, esc, money, api } from './utils.js';

export async function renderMargens() {
  const el = $('#view-margens');
  el.innerHTML = '<p class="muted">A carregar...</p>';
  let data;
  try {
    data = await api('/api/admin/dashboard');
  } catch (err) {
    el.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }
  el.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>Regras de margem</h2></div>
      ${data.margins.length ? data.margins.map(m => `
        <div class="list-row">
          <div class="list-row-main">
            <b>${esc(m.name)}</b>
            <span class="match-tag">match: ${esc(m.match)}</span>
          </div>
          <div class="list-row-side">
            <span class="stage-pill ${m.active === false ? 'PERDIDA' : 'RESERVADO'}">${m.active === false ? 'Inativa' : 'Ativa'}</span>
            <strong>${m.percent}% · mín. ${money(m.min)}</strong>
          </div>
        </div>`).join('') : '<p class="empty-note">Sem regras de margem configuradas.</p>'}
    </div>`;
}

export async function renderEmails() {
  const el = $('#view-emails');
  el.innerHTML = '<p class="muted">A carregar...</p>';
  let data;
  try {
    data = await api('/api/admin/dashboard');
  } catch (err) {
    el.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }
  const emails = data.latest.emails;
  el.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>Emails gerados recentemente</h2></div>
      ${emails.length ? emails.map(e => `
        <div class="list-row">
          <div class="list-row-main">
            <b>${esc(e.subject)}</b>
            <span>Para: ${esc(e.to)}</span>
          </div>
          <div class="list-row-side">
            <span class="stage-pill NOVA">${esc(e.status)}</span>
            <strong>${new Date(e.createdAt).toLocaleString('pt-PT')}</strong>
          </div>
        </div>`).join('') : '<p class="empty-note">Ainda sem emails gerados.</p>'}
    </div>`;
}

export async function renderOperador() {
  const el = $('#view-operador');
  el.innerHTML = '<p class="muted">A carregar...</p>';
  let data;
  try {
    data = await api('/api/admin/dashboard');
  } catch (err) {
    el.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }

  el.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>Operadores configurados</h2></div>
      ${data.operators.map(o => `
        <div class="list-row">
          <div class="list-row-main"><b>${esc(o.name)}</b></div>
          <div class="list-row-side"><span class="stage-pill ${o.configured ? 'RESERVADO' : 'PERDIDA'}">${o.configured ? 'Configurado' : 'Sem configuração'}</span></div>
        </div>`).join('')}
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Diagnóstico TourDiez</h2></div>
      <div class="op-actions">
        <button type="button" id="testOperatorBtn" class="btn">Testar TourDiez</button>
        <span id="opStatus" class="op-status"></span>
      </div>
      <pre id="operatorLog" class="log">${esc(JSON.stringify({ chamadas: data.latest.logs, auditoria: data.latest.audit }, null, 2))}</pre>
    </div>`;

  $('#testOperatorBtn').onclick = async () => {
    $('#opStatus').textContent = 'A testar login + disponibilidade TourDiez...';
    $('#operatorLog').textContent = '';
    try {
      const result = await api('/api/admin/operator/tourdiez/test', { method: 'POST', body: JSON.stringify({ destination: 'Punta Cana', nights: 7, adults: 2 }) });
      $('#opStatus').textContent = result.tourdiezOk ? 'Ligação à TourDiez OK.' : 'TourDiez respondeu, mas com erro - ver detalhe abaixo.';
      $('#operatorLog').textContent = JSON.stringify(result, null, 2);
    } catch (err) {
      $('#opStatus').textContent = 'Falhou.';
      $('#operatorLog').textContent = err.message;
    }
  };
}
