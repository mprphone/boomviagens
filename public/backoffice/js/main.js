// Ponto de entrada: decide entre login e app, e faz a navegacao entre
// vistas na sidebar (aplicacao pequena, nao precisa de um router).

import { $, api } from './utils.js';
import { wireLogin } from './auth.js';
import { renderResumo } from './dashboard.js';
import { renderPipeline } from './pipeline.js';
import { renderPropostas } from './propostas.js';
import { renderFollowups } from './followups.js';
import { renderReservas } from './reservations.js';
import { renderClientes } from './customers.js';
import { renderEquipa } from './team.js';
import { renderFornecedores } from './suppliers.js';
import { renderMargens, renderEmails, renderOperador } from './system.js';

const VIEWS = {
  resumo: { title: 'Resumo Geral', render: renderResumo },
  pipeline: { title: 'Pipeline', render: renderPipeline },
  propostas: { title: 'Propostas', render: renderPropostas },
  followups: { title: 'Follow-ups', render: renderFollowups },
  reservas: { title: 'Reservas', render: renderReservas },
  clientes: { title: 'Clientes', render: renderClientes },
  equipa: { title: 'Equipa', render: renderEquipa },
  fornecedores: { title: 'Fornecedores', render: renderFornecedores },
  margens: { title: 'Margens', render: renderMargens },
  emails: { title: 'Emails', render: renderEmails },
  operador: { title: 'Operador', render: renderOperador }
};

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

function showApp() {
  $('#loginGate').hidden = true;
  $('#appShell').hidden = false;
  switchView('resumo');
}

function showLogin() {
  $('#loginGate').hidden = false;
  $('#appShell').hidden = true;
}

document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
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
