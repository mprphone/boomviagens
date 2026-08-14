// Separador "Geral": dados completos do cliente, editaveis pelo operador
// (util quando e a equipa a recolher os dados por telefone) - mesmos
// campos que o proprio cliente pode editar em /conta, mais notas internas.

import { esc, api } from '../utils.js';

const TRAVEL_SCOPES = [
  { value: '', label: 'Não definido' },
  { value: 'LAZER', label: 'Lazer' },
  { value: 'NEGOCIOS', label: 'Negócios' },
  { value: 'AMBOS', label: 'Lazer e negócios' }
];

export function renderGeneralTab(panel, data) {
  const c = data.customer;
  panel.innerHTML = `
    <form class="customer-profile-form">
      <div class="customer-profile-grid">
        <label>Nome <input name="name" value="${esc(c.name || '')}" required /></label>
        <label>Email <input value="${esc(c.email)}" disabled /></label>
        <label>Telefone <input name="phone" value="${esc(c.phone || '')}" /></label>
        <label>Telefone alternativo <input name="phone2" value="${esc(c.phone2 || '')}" /></label>
        <label>NIF <input name="nif" value="${esc(c.nif || '')}" maxlength="9" /></label>
        <label>Data de nascimento <input name="birthdate" type="date" value="${esc(c.birthdate || '')}" /></label>
        <label>Morada <input name="address" value="${esc(c.address || '')}" /></label>
        <label>Código postal <input name="postalCode" value="${esc(c.postalCode || '')}" placeholder="0000-000" /></label>
        <label>Localidade <input name="city" value="${esc(c.city || '')}" /></label>
        <label>Âmbito de viagem
          <select name="travelScope">
            ${TRAVEL_SCOPES.map(o => `<option value="${o.value}" ${o.value === (c.travelScope || '') ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>
        </label>
      </div>
      <label>Notas internas <textarea name="notes" rows="3">${esc(c.notes || '')}</textarea></label>
      <button class="btn mini-action" type="submit">Guardar</button>
      <p class="customer-form-message"></p>
    </form>`;

  panel.querySelector('.customer-profile-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const msg = panel.querySelector('.customer-form-message');
    const f = e.target;
    btn.disabled = true;
    btn.textContent = 'A guardar...';
    try {
      await api('/api/admin/customers/update', {
        method: 'POST',
        body: JSON.stringify({
          email: c.email,
          name: f.name.value,
          phone: f.phone.value,
          phone2: f.phone2.value,
          nif: f.nif.value,
          birthdate: f.birthdate.value,
          address: f.address.value,
          postalCode: f.postalCode.value,
          city: f.city.value,
          travelScope: f.travelScope.value,
          notes: f.notes.value
        })
      });
      btn.textContent = 'Guardado ✓';
      setTimeout(() => { btn.textContent = 'Guardar'; btn.disabled = false; }, 1500);
    } catch (err) {
      msg.textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Guardar';
    }
  });
}
