// Ponto de entrada: decide entre login e app, e faz a navegacao entre
// vistas na sidebar (aplicacao pequena, nao precisa de um router).

import { $, api } from './utils.js';
import { wireLogin } from './auth.js';
import { renderResumo } from './dashboard.js';
import { renderInteresses } from './pipeline.js';

const VIEWS = {
  resumo: { title: 'Resumo Geral', render: renderResumo },
  interesses: { title: 'Interesses', render: renderInteresses }
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

api('/api/admin/session').then(data => {
  if (data.authenticated) showApp(); else showLogin();
}).catch(() => showLogin());
