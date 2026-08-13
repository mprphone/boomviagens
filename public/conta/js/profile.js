// Vista "Os meus dados": nome/telefone/NIF editaveis; o email fica
// so-de-leitura porque e a propria identidade da sessao (mudar de
// email aqui significaria mudar de conta).

import { $, esc, api } from './utils.js';

export async function renderDados() {
  const el = $('#view-dados');
  el.innerHTML = '<p class="muted">A carregar...</p>';
  let data;
  try {
    data = await api('/api/customer/profile');
  } catch (err) {
    el.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }
  const c = data.customer;
  el.innerHTML = `
    <div class="panel" style="max-width:520px">
      <div class="panel-head"><h2>Os meus dados</h2></div>
      <form id="profileForm" style="display:flex;flex-direction:column;gap:14px">
        <label>Email <input value="${esc(c.email)}" disabled /></label>
        <label>Nome completo <input name="name" value="${esc(c.name || '')}" /></label>
        <label>Telefone <input name="phone" value="${esc(c.phone || '')}" /></label>
        <label>Contribuinte (NIF) <input name="nif" value="${esc(c.nif || '')}" pattern="[0-9]{9}" maxlength="9" /></label>
        <button class="btn" type="submit">Guardar alterações</button>
        <p id="profileMessage" class="muted" style="margin:0"></p>
      </form>
    </div>`;

  $('#profileForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const msg = $('#profileMessage');
    btn.disabled = true;
    msg.textContent = 'A guardar...';
    try {
      await api('/api/customer/profile', {
        method: 'POST',
        body: JSON.stringify({ name: e.target.name.value, phone: e.target.phone.value, nif: e.target.nif.value })
      });
      msg.textContent = 'Dados guardados.';
    } catch (err) {
      msg.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
}
