// Area de cliente: login por codigo de email (sem password) e a lista
// das reservas do cliente autenticado.

import { $, api, money, statusLabel, formToJson } from './utils.js';

let pendingCustomerEmail = '';
let pendingCustomerChallenge = '';

function setCustomerState(authenticated) {
  $('#customerLoginForm').hidden = authenticated;
  $('#customerCodeForm').hidden = true;
  $('#customerContent').hidden = !authenticated;
  $('#customerLogout').hidden = !authenticated;
}

async function loadCustomerReservations() {
  try {
    const data = await api('/api/customer/reservations');
    $('#customerReservations').innerHTML = data.reservations.map(r => `
      <div class="mini-item">
        <b>${r.offer?.hotel || ''}</b> - ${statusLabel(r.status)}<br>
        ${r.offer?.destination || ''} - ${r.offer?.nights || ''} noites<br>
        ${money(r.offer?.finalPrice)}${r.operatorLocator ? ` - Localizador: ${r.operatorLocator}` : ''}
      </div>`).join('') || '<div class="mini-item">Ainda nao tem reservas.</div>';
  } catch (err) {
    $('#customerReservations').innerHTML = `<p class="error">${err.message}</p>`;
  }
}

export async function refreshCustomerArea() {
  let data;
  try {
    data = await api('/api/customer/session');
  } catch (err) {
    setCustomerState(false);
    return;
  }
  setCustomerState(data.authenticated);
  if (data.authenticated) loadCustomerReservations();
}

$('#customerLoginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = formToJson(e.target);
  $('#customerLoginMessage').textContent = 'A gerar codigo...';
  try {
    const data = await api('/api/customer/login/request', { method: 'POST', body: JSON.stringify({ email: f.email }) });
    pendingCustomerEmail = f.email;
    pendingCustomerChallenge = data.challenge;
    $('#customerLoginForm').hidden = true;
    $('#customerCodeForm').hidden = false;
    $('#customerCodeMessage').textContent = `Codigo (demo, sem email real): ${data.demoCode}`;
  } catch (err) {
    $('#customerLoginMessage').textContent = err.message;
  }
});

$('#customerCodeForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = formToJson(e.target);
  $('#customerCodeMessage').textContent = 'A validar...';
  try {
    await api('/api/customer/login/verify', { method: 'POST', body: JSON.stringify({ email: pendingCustomerEmail, code: f.code, challenge: pendingCustomerChallenge }) });
    setCustomerState(true);
    loadCustomerReservations();
  } catch (err) {
    $('#customerCodeMessage').textContent = err.message;
  }
});

$('#customerLogout').onclick = async () => {
  await api('/api/customer/logout', { method: 'POST', body: '{}' });
  pendingCustomerEmail = '';
  pendingCustomerChallenge = '';
  setCustomerState(false);
  $('#customerLoginMessage').textContent = 'Entre com o seu email para ver as suas reservas.';
};
