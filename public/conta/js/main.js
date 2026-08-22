// Ponto de entrada: decide entre login e app, preenche o cabecalho da
// sidebar com dados reais do cliente e liga a navegacao entre vistas.

import { $, api, notify } from './utils.js';
import { watchCustomerSessionChanges, clearCustomerScopedBrowserState } from '../../js/sessionGuard.js';
import { wireLogin } from './auth.js';
import { renderDashboard } from './dashboard.js';
import { renderGuardadas, renderViagens, renderAnteriores } from './reservations.js';
import { renderDocumentos } from './documents.js';
import { renderPagamentos } from './payments.js';
import { renderDados } from './profile.js';
import { renderPassageiros } from './passengers.js';
import { renderPreferencias } from './preferences.js';
import { renderMensagens } from './support.js';
import { renderEmergencia } from './emergencyContacts.js';

const VIEWS = {
  dashboard: { title: 'Início', render: renderDashboard },
  guardadas: { title: 'Viagens', render: renderGuardadas },
  viagens: { title: 'Viagens', render: renderViagens },
  anteriores: { title: 'Viagens', render: renderAnteriores },
  documentos: { title: 'Documentos', render: renderDocumentos },
  pagamentos: { title: 'Pagamentos', render: renderPagamentos },
  dados: { title: 'Os meus dados', render: renderDados },
  passageiros: { title: 'Passageiros', render: renderPassageiros },
  preferencias: { title: 'Preferências', render: renderPreferencias },
  mensagens: { title: 'Pedidos e mensagens', render: renderMensagens },
  emergencia: { title: 'Contactos de emergência', render: renderEmergencia }
};

const TRIP_VIEWS = new Set(['viagens', 'guardadas', 'anteriores']);
const PRIMARY_TABS = new Set(['dashboard', 'viagens', 'documentos', 'pagamentos']);

let activeSessionEmail = '';
let sessionCheckRunning = false;
let paymentReturnHandled = false;
let sessionRevision = 0;

function closeMobileNav() {
  $('#appShell')?.classList.remove('is-nav-open');
  const sheet = $('#accountSheet');
  if (sheet) sheet.hidden = true;
  ['#menuToggle', '#moreMenuBtn'].forEach(sel => {
    const btn = $(sel);
    if (btn) btn.setAttribute('aria-expanded', 'false');
  });
  const backdrop = $('#sidebarBackdrop');
  if (backdrop) backdrop.hidden = true;
}

function openMobileNav() {
  $('#appShell')?.classList.add('is-nav-open');
  const sheet = $('#accountSheet');
  if (sheet) sheet.hidden = false;
  ['#menuToggle', '#moreMenuBtn'].forEach(sel => {
    const btn = $(sel);
    if (btn) btn.setAttribute('aria-expanded', 'true');
  });
  const backdrop = $('#sidebarBackdrop');
  if (backdrop) backdrop.hidden = false;
}

function toggleMobileNav() {
  if ($('#accountSheet') && !$('#accountSheet').hidden) closeMobileNav();
  else openMobileNav();
}

function highlightNav(name) {
  document.querySelectorAll('.nav-item[data-view], .sheet-link[data-view], .trip-hub-tab[data-view]').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.view === name);
  });
  document.querySelectorAll('.tab-item[data-view]').forEach(btn => {
    const tripActive = btn.dataset.view === 'viagens' && TRIP_VIEWS.has(name);
    btn.classList.toggle('is-active', btn.dataset.view === name || tripActive);
  });
  const moreBtn = $('#moreMenuBtn');
  if (moreBtn) moreBtn.classList.toggle('is-active', !PRIMARY_TABS.has(name) && !TRIP_VIEWS.has(name));
  const hub = $('#tripHub');
  if (hub) hub.hidden = !TRIP_VIEWS.has(name);
}

const DESKTOP_TITLES = {
  dashboard: 'Dashboard',
  guardadas: 'Viagens guardadas',
  viagens: 'As minhas viagens',
  anteriores: 'Reservas anteriores'
};

function switchView(name) {
  const view = VIEWS[name];
  if (!view) return;
  highlightNav(name);
  document.querySelectorAll('.view').forEach(sec => { sec.hidden = sec.id !== `view-${name}`; });
  const desktop = window.matchMedia('(min-width: 901px)').matches;
  $('#pageTitle').textContent = (desktop && DESKTOP_TITLES[name]) || view.title;
  closeMobileNav();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  view.render();
}

async function fillSidebarProfile() {
  try {
    const data = await api('/api/customer/profile');
    const name = data.customer.name || data.customer.email;
    const hello = `Olá, ${name.split(' ')[0]}!`;
    const initial = name.charAt(0).toUpperCase();
    const since = data.customer.createdAt ? `Cliente desde ${new Date(data.customer.createdAt).getFullYear()}` : '';
    $('#profileName').textContent = hello;
    $('#avatarInitial').textContent = initial;
    if (since) $('#profileSub').textContent = since;
    if ($('#sheetName')) $('#sheetName').textContent = hello;
    if ($('#sheetAvatar')) $('#sheetAvatar').textContent = initial;
    if (since && $('#sheetSub')) $('#sheetSub').textContent = since;
  } catch {
    // Sessao valida mas ainda sem registo de cliente (ex.: nunca fez
    // checkout) - mantem os valores por omissao do HTML.
  }
}

async function fillHelpBox() {
  try {
    const data = await api('/api/config');
    const company = data.company || {};
    if (company.phone) {
      ['#helpPhone', '#sheetHelpPhone'].forEach(sel => {
        const el = $(sel);
        if (!el) return;
        el.textContent = company.phone;
        el.href = `tel:${company.phone}`;
      });
    }
    if (company.email) {
      ['#helpEmail', '#sheetHelpEmail'].forEach(sel => {
        const el = $(sel);
        if (!el) return;
        el.textContent = company.email;
        el.href = `mailto:${company.email}`;
      });
    }
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

document.querySelectorAll('.nav-item[data-view], .tab-item[data-view], .sheet-link[data-view], .trip-hub-tab[data-view]').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

$('#menuToggle')?.addEventListener('click', toggleMobileNav);
$('#moreMenuBtn')?.addEventListener('click', toggleMobileNav);
$('#sidebarBackdrop')?.addEventListener('click', closeMobileNav);
$('#accountSheetBackdrop')?.addEventListener('click', closeMobileNav);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeMobileNav();
});

async function activateSession(session = {}) {
  // Invalida qualquer /api/customer/session iniciado antes do login. Em
  // redes moveis esse pedido antigo pode terminar depois do POST de login e
  // nao pode voltar a esconder a aplicacao com o estado anterior.
  sessionRevision += 1;
  activeSessionEmail = String(session.email || '').toLowerCase();
  showApp();
  await handlePaymentReturn();
}

async function reconcileSession() {
  if (sessionCheckRunning) return;
  sessionCheckRunning = true;
  const revisionAtStart = sessionRevision;
  try {
    const data = await api('/api/customer/session');
    if (revisionAtStart !== sessionRevision) return;
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
    await renderPagamentos();
    if (confirmed) {
      // Cartao/Stripe sai do site para pagar e volta direto para a Area de
      // Cliente - nunca passa pelo ecra "Reserva recebida" do checkout (esse
      // so existe dentro do popup, para MB WAY/simulacao). Sem isto, um
      // pagamento com cartao confirmado so tinha uma toast que desaparece
      // sozinha em segundos, sem nada visivel a seguir.
      const banner = document.createElement('div');
      banner.className = 'panel';
      banner.innerHTML = '<div class="panel-head"><h2>✓ Pagamento confirmado</h2><span class="pill ok">Pago</span></div><p class="muted">A sua reserva está paga e segue agora para validação do operador. Pode acompanhar o estado aqui ou em "Viagens guardadas".</p>';
      $('#view-pagamentos').prepend(banner);
    }
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
