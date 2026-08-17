// Ponto de entrada: decide entre login e app, e faz a navegacao entre
// vistas na sidebar (aplicacao pequena, nao precisa de um router).

import { $, api } from './utils.js';
import { wireLogin } from './auth.js';
import { renderResumo } from './dashboard.js';
import { renderOnline } from './online.js';
import { renderPipeline } from './pipeline.js';
import { renderPropostas } from './propostas.js';
import { renderFollowups } from './followups.js';
import { renderReservas } from './reservations.js';
import { renderPipelineOperacional } from './pipelineOperacional.js';
import { renderClientes } from './customers.js';
import { renderEquipa } from './team.js';
import { renderVisaoGeral } from './team/overview.js';
import { renderMeuDia } from './team/myDay.js';
import { renderTarefasEquipa } from './team/tasks.js';
import { renderAgenda } from './team/agenda.js';
import { renderFornecedores } from './suppliers.js';
import { renderAgencias } from './agencias.js';
import { renderMargens, renderEmails, renderOperador } from './system.js';

const VIEWS = {
  resumo: { title: 'Resumo Operacional', render: renderResumo },
  online: { title: 'Online', render: renderOnline },
  pipeline: { title: 'Pipeline', render: renderPipeline },
  propostas: { title: 'Propostas', render: renderPropostas },
  followups: { title: 'Follow-ups', render: renderFollowups },
  reservas: { title: 'Reservas', render: renderReservas },
  'pipeline-operacional': { title: 'Pipeline Operacional', render: renderPipelineOperacional },
  clientes: { title: 'Clientes', render: renderClientes },
  'meu-dia': { title: 'O Meu Dia', render: renderMeuDia },
  'visao-geral': { title: 'Visão Geral', render: renderVisaoGeral },
  equipa: { title: 'Equipa', render: renderEquipa },
  'tarefas-equipa': { title: 'Tarefas', render: renderTarefasEquipa },
  agenda: { title: 'Agenda', render: renderAgenda },
  fornecedores: { title: 'Fornecedores', render: renderFornecedores },
  agencias: { title: 'Agências', render: renderAgencias },
  margens: { title: 'Margens', render: renderMargens },
  emails: { title: 'Emails', render: renderEmails },
  operador: { title: 'Operador', render: renderOperador }
};

const WORKSPACES = {
  comercial: { defaultView: 'pipeline' },
  operacao: { defaultView: 'resumo' },
  online: { defaultView: 'online' },
  equipa: { defaultView: 'meu-dia' },
  financeiro: { defaultView: 'fornecedores' },
  gestao: { defaultView: 'agencias' }
};
let currentWorkspace = 'comercial';

function switchWorkspace(area, preferredView = null) {
  if (!WORKSPACES[area]) return;
  currentWorkspace = area;
  document.querySelectorAll('.workspace-tab').forEach(btn => btn.classList.toggle('is-active', btn.dataset.area === area));
  document.querySelectorAll('.nav-area').forEach(group => { group.hidden = group.dataset.area !== area; });
  const view = preferredView || WORKSPACES[area].defaultView;
  switchView(view);
}

function switchView(name) {
  const view = VIEWS[name];
  if (!view) return;
  document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.view === name);
  });
  document.querySelectorAll('.view').forEach(sec => { sec.hidden = sec.id !== `view-${name}`; });
  $('#pageTitle').textContent = view.title;
  view.render();
}

async function refreshOnlineIndicator() {
  try {
    const data = await api('/api/admin/reservations');
    const online = (data.reservations || []).filter(r => r.origin === 'WEBSITE' || r.source === 'site');
    const requiresAttention = online.filter(r => ['PENDING_PAYMENT','IN_VALIDATION','HUMAN_REVIEW'].includes(r.status));
    const dot = document.getElementById('onlineSalesDot');
    if (dot) { dot.hidden = requiresAttention.length === 0; dot.title = `${requiresAttention.length} entrada(s) online por tratar`; }
  } catch {}
}

function showApp() {
  $('#loginGate').hidden = true;
  $('#appShell').hidden = false;
  switchWorkspace('comercial');
  refreshOnlineIndicator();
}

function showLogin() {
  $('#loginGate').hidden = false;
  $('#appShell').hidden = true;
}

document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

document.querySelectorAll('.workspace-tab').forEach(btn => {
  btn.addEventListener('click', () => switchWorkspace(btn.dataset.area));
});

wireLogin(showApp);

// Verificacao de sessao ao carregar a pagina, em paralelo com o
// utilizador poder ja estar a preencher o formulario. Se o login pelo
// formulario for mais rapido, esta resposta chega depois a dizer
// "nao autenticado" (foi pedida antes do cookie de sessao existir) -
// sem a guarda abaixo, isso reverte a app de volta para o ecra de
// login mesmo depois de um login bem sucedido.
api('/api/admin/session').then(data => {
  if (data.authenticated) showApp();
  else if ($('#appShell').hidden) showLogin();
}).catch(() => { if ($('#appShell').hidden) showLogin(); });
