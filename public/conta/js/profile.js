// Vista "Os meus dados": ficha completa do titular da conta (nome,
// contactos, NIF, nascimento, nacionalidade, morada) editavel; o email
// fica so-de-leitura porque e a propria identidade da sessao (mudar de
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
        <label>Telefone alternativo <span class="muted">(opcional)</span> <input name="phone2" value="${esc(c.phone2 || '')}" /></label>
        <label>Contribuinte (NIF) <input name="nif" value="${esc(c.nif || '')}" pattern="[0-9]{9}" maxlength="9" /></label>
        <label>Data de nascimento <span class="muted">(opcional)</span> <input name="birthdate" type="date" value="${esc(c.birthdate || '')}" /></label>
        <label>Nacionalidade <span class="muted">(opcional)</span> <input name="nationality" value="${esc(c.nationality || '')}" placeholder="ex.: Portuguesa" /></label>
        <label>Morada <span class="muted">(opcional)</span> <input name="address" value="${esc(c.address || '')}" placeholder="Rua, número" /></label>
        <div style="display:flex;gap:14px">
          <label style="flex:1">Código postal <input name="postalCode" value="${esc(c.postalCode || '')}" placeholder="0000-000" /></label>
          <label style="flex:2">Localidade <input name="city" value="${esc(c.city || '')}" /></label>
        </div>
        <button class="btn" type="submit">Guardar alterações</button>
        <p id="profileMessage" class="muted" style="margin:0"></p>
      </form>
    </div>
    <div class="panel" style="max-width:520px;margin-top:16px">
      <div class="panel-head"><h2>Password</h2></div>
      <p class="muted">${data.hasPassword ? 'Já tem password definida. Pode alterá-la aqui.' : 'Ainda entra sempre com código por email. Defina uma password para entrar mais depressa da próxima vez.'}</p>
      <form id="passwordForm" style="display:flex;flex-direction:column;gap:14px">
        <label>${data.hasPassword ? 'Nova password' : 'Password'} <input name="password" type="password" minlength="8" placeholder="mínimo 8 caracteres" required /></label>
        <button class="btn" type="submit">${data.hasPassword ? 'Alterar password' : 'Definir password'}</button>
        <p id="passwordMessage" class="muted" style="margin:0"></p>
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
        body: JSON.stringify({
          name: e.target.name.value, phone: e.target.phone.value, phone2: e.target.phone2.value, nif: e.target.nif.value,
          birthdate: e.target.birthdate.value, nationality: e.target.nationality.value,
          address: e.target.address.value, postalCode: e.target.postalCode.value, city: e.target.city.value
        })
      });
      msg.textContent = 'Dados guardados.';
    } catch (err) {
      msg.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  $('#passwordForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const msg = $('#passwordMessage');
    btn.disabled = true;
    msg.textContent = 'A guardar...';
    try {
      await api('/api/customer/set-password', { method: 'POST', body: JSON.stringify({ password: e.target.password.value }) });
      msg.textContent = 'Password guardada.';
      e.target.reset();
    } catch (err) {
      msg.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
}
