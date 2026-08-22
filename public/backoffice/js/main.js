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

// Areas com botao proprio na tab bar movel; as restantes (Financeiro,
// Gestao) acendem o botao "Mais".
const PRIMARY_AREAS = new Set(['comercial', 'operacao', 'online', 'equipa']);

function closeMobileSheet() {
  const sheet = $('#boSheet');
  if (sheet) sheet.hidden = true;
  $('#appShell')?.classList.remove('is-sheet-open');
  $('#moreMenuBtn')?.setAttribute('aria-expanded', 'false');
}

function toggleMobileSheet() {
  const sheet = $('#boSheet');
  if (!sheet) return;
  const opening = sheet.hidden;
  sheet.hidden = !opening;
  $('#appShell')?.classList.toggle('is-sheet-open', opening);
  $('#moreMenuBtn')?.setAttribute('aria-expanded', String(opening));
}

// Constroi a folha "Mais" a partir da propria sidebar - assim os dois
// menus nunca ficam dessincronizados quando se adiciona uma vista.
function buildMobileSheet() {
  const host = $('#boSheetGroups');
  if (!host) return;
  document.querySelectorAll('.nav-area').forEach(area => {
    const group = document.createElement('div');
    group.className = 'bo-sheet-group';
    const title = area.querySelector('.nav-section-title')?.textContent || '';
    group.innerHTML = `<h3>${title}</h3>`;
    area.querySelectorAll('.nav-item[data-view]').forEach(item => {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'sheet-link';
      link.dataset.area = area.dataset.area;
      link.dataset.view = item.dataset.view;
      // So os nos de texto - sem o icone nem o badge "em breve".
      link.textContent = [...item.childNodes]
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent.trim())
        .join(' ');
      link.addEventListener('click', () => switchWorkspace(link.dataset.area, link.dataset.view));
      group.appendChild(link);
    });
    host.appendChild(group);
  });
}

function switchWorkspace(area, preferredView = null) {
  if (!WORKSPACES[area]) return;
  currentWorkspace = area;
  document.querySelectorAll('.workspace-tab').forEach(btn => btn.classList.toggle('is-active', btn.dataset.area === area));
  document.querySelectorAll('.nav-area').forEach(group => { group.hidden = group.dataset.area !== area; });
  document.querySelectorAll('.tab-item[data-area]').forEach(btn => btn.classList.toggle('is-active', btn.dataset.area === area));
  const moreBtn = $('#moreMenuBtn');
  if (moreBtn) moreBtn.classList.toggle('is-active', !PRIMARY_AREAS.has(area));
  closeMobileSheet();
  const view = preferredView || WORKSPACES[area].defaultView;
  switchView(view);
}

function switchView(name) {
  const view = VIEWS[name];
  if (!view) return;
  document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.view === name);
  });
  document.querySelectorAll('.sheet-link[data-view]').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.view === name && btn.dataset.area === currentWorkspace);
  });
  document.querySelectorAll('.view').forEach(sec => { sec.hidden = sec.id !== `view-${name}`; });
  $('#pageTitle').textContent = view.title;
  closeMobileSheet();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  view.render();
}

async function refreshOnlineIndicator() {
  try {
    const data = await api('/api/admin/reservations');
    const online = (data.reservations || []).filter(r => r.origin === 'WEBSITE' || r.source === 'site');
    const requiresAttention = online.filter(r => ['PENDING_PAYMENT','IN_VALIDATION','HUMAN_REVIEW'].includes(r.status));
    // Ha dois pontos de alerta: no selector de workspaces (desktop) e na
    // tab bar movel - atualizam-se os dois de uma vez.
    document.querySelectorAll('.workspace-alert-dot').forEach(dot => {
      dot.hidden = requiresAttention.length === 0;
      dot.title = `${requiresAttention.length} entrada(s) online por tratar`;
    });
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

// Navegacao movel: tab bar (areas principais) + folha "Mais".
document.querySelectorAll('.tab-item[data-area]').forEach(btn => {
  btn.addEventListener('click', () => switchWorkspace(btn.dataset.area));
});
$('#moreMenuBtn')?.addEventListener('click', toggleMobileSheet);
$('#boSheetBackdrop')?.addEventListener('click', closeMobileSheet);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeMobileSheet();
});
// Reutiliza o handler de logout ligado em auth.js ao botao da sidebar.
$('#sheetLogoutBtn')?.addEventListener('click', () => $('#logoutBtn')?.click());
buildMobileSheet();

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
