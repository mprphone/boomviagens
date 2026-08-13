// Ponto de entrada: decide entre login e app, preenche o cabecalho da
// sidebar com dados reais do cliente e liga a navegacao entre vistas.

import { $, api } from './utils.js';
import { wireLogin } from './auth.js';
import { renderDashboard } from './dashboard.js';
import { renderViagens, renderAnteriores } from './reservations.js';
import { renderDocumentos } from './documents.js';
import { renderPagamentos } from './payments.js';
import { renderDados } from './profile.js';

const VIEWS = {
  dashboard: { title: 'Dashboard', render: renderDashboard },
  viagens: { title: 'As minhas viagens', render: renderViagens },
  anteriores: { title: 'Reservas anteriores', render: renderAnteriores },
  documentos: { title: 'Documentos', render: renderDocumentos },
  pagamentos: { title: 'Pagamentos', render: renderPagamentos },
  dados: { title: 'Os meus dados', render: renderDados }
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

async function fillSidebarProfile() {
  try {
    const data = await api('/api/customer/profile');
    const name = data.customer.name || data.customer.email;
    $('#profileName').textContent = `Olá, ${name.split(' ')[0]}!`;
    $('#avatarInitial').textContent = name.charAt(0).toUpperCase();
    if (data.customer.createdAt) {
      $('#profileSub').textContent = `Cliente desde ${new Date(data.customer.createdAt).getFullYear()}`;
    }
  } catch {
    // Sessao valida mas ainda sem registo de cliente (ex.: nunca fez
    // checkout) - mantem os valores por omissao do HTML.
  }
}

async function fillHelpBox() {
  try {
    const data = await api('/api/config');
    const company = data.company || {};
    if (company.phone) { $('#helpPhone').textContent = `📞 ${company.phone}`; $('#helpPhone').href = `tel:${company.phone}`; }
    if (company.email) { $('#helpEmail').textContent = `✉️ ${company.email}`; $('#helpEmail').href = `mailto:${company.email}`; }
  } catch {
    // Painel de ajuda so nao aparece com dados - nao e critico para a conta funcionar.
  }
}

function showApp() {
  $('#loginGate').hidden = true;
  $('#appShell').hidden = false;
  fillSidebarProfile();
  fillHelpBox();
  switchView('dashboard');
}

function showLogin() {
  $('#loginGate').hidden = false;
  $('#appShell').hidden = true;
}

document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

wireLogin(showApp);

// Ver o comentario equivalente em public/backoffice/js/main.js: sem
// esta guarda, esta verificacao de sessao feita ao carregar a pagina
// pode chegar depois de um login bem sucedido pelo formulario (login
// por codigo demora mais que uma verificacao simples) e reverter a app
// de volta para o ecra de login.
api('/api/customer/session').then(data => {
  if (data.authenticated) showApp();
  else if ($('#appShell').hidden) showLogin();
}).catch(() => { if ($('#appShell').hidden) showLogin(); });
