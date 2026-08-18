// Duas formas de entrar: password (se ja tiver sido definida - ver
// checkout ou Os meus dados) ou codigo por email em dois passos (pede o
// codigo, depois confirma). Mesmas rotas /api/customer/login/* que a
// area de cliente embutida no site ja usava.

import { $, api } from './utils.js';
import { announceCustomerSessionChange, clearCustomerScopedBrowserState } from '../../js/sessionGuard.js';

let pendingEmail = '';
let pendingChallenge = '';

export function wireLogin(onSuccess) {
  $('#loginEmailForm').addEventListener('submit', async e => {
    e.preventDefault();
    const email = e.target.email.value.trim();
    const password = e.target.password.value;
    if (password) return loginWithPassword(email, password);
    return requestLoginCode(email);
  });

  $('#requestCodeBtn').onclick = () => requestLoginCode($('#loginEmailForm').email.value.trim());

  $('#loginCodeForm').addEventListener('submit', async e => {
    e.preventDefault();
    const code = e.target.code.value.trim();
    const btn = e.target.querySelector('button[type="submit"]');
    const msg = $('#loginCodeMessage');
    btn.disabled = true;
    msg.textContent = 'A validar...';
    msg.classList.remove('is-error');
    try {
      const data = await api('/api/customer/login/verify', { method: 'POST', body: JSON.stringify({ email: pendingEmail, code, challenge: pendingChallenge }) });
      announceCustomerSessionChange();
      onSuccess(data);
    } catch (err) {
      msg.textContent = err.message;
      msg.classList.add('is-error');
      btn.disabled = false;
    }
  });

  $('#backToEmailBtn').onclick = () => {
    $('#loginCodeForm').hidden = true;
    $('#loginEmailForm').hidden = false;
    $('#loginEmailMessage').textContent = '';
  };

  $('#logoutBtn').onclick = async () => {
    await api('/api/customer/logout', { method: 'POST', body: '{}' });
    clearCustomerScopedBrowserState();
    announceCustomerSessionChange();
    location.reload();
  };

  async function loginWithPassword(email, password) {
    const btn = $('#loginSubmitBtn');
    const msg = $('#loginEmailMessage');
    btn.disabled = true;
    msg.textContent = 'A validar...';
    msg.classList.remove('is-error');
    try {
      const data = await api('/api/customer/login/password', { method: 'POST', body: JSON.stringify({ email, password }) });
      announceCustomerSessionChange();
      onSuccess(data);
    } catch (err) {
      msg.textContent = err.message;
      msg.classList.add('is-error');
      btn.disabled = false;
    }
  }

  async function requestLoginCode(email) {
    const btn = $('#loginSubmitBtn');
    const msg = $('#loginEmailMessage');
    btn.disabled = true;
    msg.textContent = 'A gerar código...';
    msg.classList.remove('is-error');
    try {
      const data = await api('/api/customer/login/request', { method: 'POST', body: JSON.stringify({ email }) });
      pendingEmail = email;
      pendingChallenge = data.challenge;
      $('#loginEmailForm').hidden = true;
      $('#loginCodeForm').hidden = false;
      $('#loginCodeMessage').textContent = data.demoCode
        ? `Código (demo, sem email real): ${data.demoCode}`
        : 'Código enviado por email. Verifique a sua caixa de entrada.';
    } catch (err) {
      msg.textContent = err.message;
      msg.classList.add('is-error');
    } finally {
      btn.disabled = false;
    }
  }
}
