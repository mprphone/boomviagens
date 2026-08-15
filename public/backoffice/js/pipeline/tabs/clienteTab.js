// Separador "Cliente": dados de contacto do cliente desta oportunidade.

import { esc, api } from '../../utils.js';

export function renderClienteTab(panel, data, opportunityId, reload) {
  const o = data.opportunity;
  panel.innerHTML = `
    <form class="customer-profile-form">
      <div class="customer-profile-grid">
        <label>Nome <input name="customerName" value="${esc(o.customerName || '')}" required /></label>
        <label>Email <input name="customerEmail" type="email" value="${esc(o.customerEmail || '')}" /></label>
        <label>Telefone <input name="customerPhone" value="${esc(o.customerPhone || '')}" /></label>
      </div>
      <button class="btn mini-action" type="submit">Guardar</button>
      <p class="customer-form-message"></p>
    </form>`;

  panel.querySelector('.customer-profile-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button[type="submit"]');
    const msg = panel.querySelector('.customer-form-message');
    btn.disabled = true;
    btn.textContent = 'A guardar...';
    try {
      await api('/api/admin/opportunities', {
        method: 'POST',
        body: JSON.stringify({ id: opportunityId, customerName: f.customerName.value, customerEmail: f.customerEmail.value, customerPhone: f.customerPhone.value })
      });
      btn.textContent = 'Guardado ✓';
      await reload();
    } catch (err) {
      msg.textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Guardar';
    }
  });
}
