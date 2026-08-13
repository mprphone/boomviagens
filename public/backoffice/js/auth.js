// Login/sessao/logout - usa as mesmas rotas /api/admin/* e o mesmo
// cookie de sessao que o backoffice antigo embutido no site, por isso
// autenticar aqui tambem autentica la (e vice-versa) sem duplicar logica.

import { $, api } from './utils.js';

export function wireLogin(onSuccess) {
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    $('#loginMessage').textContent = 'A validar credenciais...';
    try {
      await api('/api/admin/login', { method: 'POST', body: JSON.stringify(f) });
      $('#loginMessage').textContent = '';
      onSuccess();
    } catch (err) {
      $('#loginMessage').textContent = err.message;
    }
  });

  $('#logoutBtn').onclick = async () => {
    await api('/api/admin/logout', { method: 'POST', body: '{}' });
    location.reload();
  };
}
