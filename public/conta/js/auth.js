// Login por codigo de email (sem password) em dois passos - pede o
// codigo, depois confirma. Mesmas rotas /api/customer/login/* que a
// area de cliente embutida no site ja usava.

import { $, api } from './utils.js';

let pendingEmail = '';
let pendingChallenge = '';

export function wireLogin(onSuccess) {
  $('#loginEmailForm').addEventListener('submit', async e => {
    e.preventDefault();
    const email = e.target.email.value.trim();
    const msg = $('#loginEmailMessage');
    msg.textContent = 'A gerar código...';
    msg.classList.remove('is-error');
    try {
      const data = await api('/api/customer/login/request', { method: 'POST', body: JSON.stringify({ email }) });
      pendingEmail = email;
      pendingChallenge = data.challenge;
      $('#loginEmailForm').hidden = true;
      $('#loginCodeForm').hidden = false;
      $('#loginCodeMessage').textContent = `Código (demo, sem email real): ${data.demoCode}`;
    } catch (err) {
      msg.textContent = err.message;
      msg.classList.add('is-error');
    }
  });

  $('#loginCodeForm').addEventListener('submit', async e => {
    e.preventDefault();
    const code = e.target.code.value.trim();
    const msg = $('#loginCodeMessage');
    msg.textContent = 'A validar...';
    msg.classList.remove('is-error');
    try {
      await api('/api/customer/login/verify', { method: 'POST', body: JSON.stringify({ email: pendingEmail, code, challenge: pendingChallenge }) });
      onSuccess();
    } catch (err) {
      msg.textContent = err.message;
      msg.classList.add('is-error');
    }
  });

  $('#backToEmailBtn').onclick = () => {
    $('#loginCodeForm').hidden = true;
    $('#loginEmailForm').hidden = false;
    $('#loginEmailMessage').textContent = '';
  };

  $('#logoutBtn').onclick = async () => {
    await api('/api/customer/logout', { method: 'POST', body: '{}' });
    location.reload();
  };
}
