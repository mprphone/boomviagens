// Ponto de entrada: decide entre login e app, preenche o cabecalho da
// sidebar com dados reais do cliente e liga a navegacao entre vistas.

import { $, api, notify } from './utils.js';
import { watchCustomerSessionChanges, clearCustomerScopedBrowserState } from '../../js/sessionGuard.js';
import { wireLogin } from './auth.js';
import { renderDashboard } from './dashboard.js';
import { renderViagens, renderAnteriores } from './reservations.js';
import { renderDocumentos } from './documents.js';
import { renderPagamentos } from './payments.js';
import { renderDados } from './profile.js';
import { renderPassageiros } from './passengers.js';
import { renderPreferencias } from './preferences.js';
import { renderMensagens } from './support.js';
import { renderEmergencia } from './emergencyContacts.js';

const VIEWS = {
  dashboard: { title: 'Dashboard', render: renderDashboard },
  viagens: { title: 'As minhas viagens', render: renderViagens },
  anteriores: { title: 'Reservas anteriores', render: renderAnteriores },
  documentos: { title: 'Documentos', render: renderDocumentos },
  pagamentos: { title: 'Pagamentos', render: renderPagamentos },
  dados: { title: 'Os meus dados', render: renderDados },
  passageiros: { title: 'Passageiros', render: renderPassageiros },
  preferencias: { title: 'Preferências', render: renderPreferencias },
  mensagens: { title: 'Pedidos e mensagens', render: renderMensagens },
  emergencia: { title: 'Contactos de emergência', render: renderEmergencia }
};

let activeSessionEmail = '';
let sessionCheckRunning = false;
let paymentReturnHandled = false;

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
    if (company.phone) { $('#helpPhone').textContent = company.phone; $('#helpPhone').href = `tel:${company.phone}`; }
    if (company.email) { $('#helpEmail').textContent = company.email; $('#helpEmail').href = `mailto:${company.email}`; }
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

async function activateSession(session = {}) {
  activeSessionEmail = String(session.email || '').toLowerCase();
  showApp();
  await handlePaymentReturn();
}

async function reconcileSession() {
  if (sessionCheckRunning) return;
  sessionCheckRunning = true;
  try {
    const data = await api('/api/customer/session');
    const nextEmail = data.authenticated ? String(data.email || '').toLowerCase() : '';
    if (activeSessionEmail && activeSessionEmail !== nextEmail) {
      clearCustomerScopedBrowserState();
      location.reload();
      return;
    }
    if (data.authenticated) {
      if (!activeSessionEmail) await activateSession(data);
    } else if (activeSessionEmail) {
      clearCustomerScopedBrowserState();
      location.reload();
    } else if ($('#appShell').hidden) showLogin();
  } catch {
    if ($('#appShell').hidden) showLogin();
  } finally {
    sessionCheckRunning = false;
  }
}

async function handlePaymentReturn() {
  if (paymentReturnHandled) return;
  const params = new URLSearchParams(location.search);
  const result = params.get('payment');
  const paymentId = params.get('paymentId');
  if (!result || !paymentId) return;
  paymentReturnHandled = true;
  switchView('pagamentos');
  if (result === 'cancelled') {
    notify('O pagamento foi cancelado. A reserva continua guardada e pode tentar novamente.', 'error');
  } else {
    let confirmed = false;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        const status = await api(`/api/payment/status?paymentId=${encodeURIComponent(paymentId)}`);
        if (status.payment?.status === 'PAID') { confirmed = true; break; }
      } catch { break; }
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    notify(confirmed ? 'Pagamento confirmado com segurança.' : 'Pagamento recebido pelo gateway. A confirmação ainda está a ser processada.', confirmed ? 'success' : 'error');
    renderPagamentos();
  }
  history.replaceState({}, '', '/conta/');
}

wireLogin(activateSession);

// Ver o comentario equivalente em public/backoffice/js/main.js: sem
// esta guarda, esta verificacao de sessao feita ao carregar a pagina
// pode chegar depois de um login bem sucedido pelo formulario (login
// por codigo demora mais que uma verificacao simples) e reverter a app
// de volta para o ecra de login.
reconcileSession();
watchCustomerSessionChanges(reconcileSession);
window.addEventListener('focus', reconcileSession);
document.addEventListener('visibilitychange', () => { if (!document.hidden) reconcileSession(); });
