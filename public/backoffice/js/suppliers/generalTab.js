// Separador "Geral": dados de contacto e notas do fornecedor.

import { esc, api } from '../utils.js';

const TYPES = [
  { value: 'OPERADOR', label: 'Operador' },
  { value: 'HOTEL', label: 'Hotel' },
  { value: 'SEGURADORA', label: 'Seguradora' },
  { value: 'TRANSPORTE', label: 'Transporte' },
  { value: 'OUTRO', label: 'Outro' }
];

export function renderGeneralTab(panel, data) {
  const s = data.supplier;
  panel.innerHTML = `
    <form class="customer-profile-form">
      <div class="customer-profile-grid">
        <label>Nome <input name="name" value="${esc(s.name)}" required /></label>
        <label>Tipo
          <select name="type">
            ${TYPES.map(t => `<option value="${t.value}" ${t.value === s.type ? 'selected' : ''}>${t.label}</option>`).join('')}
          </select>
        </label>
        <label>Email <input name="email" type="email" value="${esc(s.email || '')}" /></label>
        <label>Telefone <input name="phone" value="${esc(s.phone || '')}" /></label>
        <label>NIF <input name="nif" value="${esc(s.nif || '')}" maxlength="9" /></label>
      </div>
      <label>Notas <textarea name="notes" rows="3">${esc(s.notes || '')}</textarea></label>
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
      await api('/api/admin/suppliers', {
        method: 'POST',
        body: JSON.stringify({ id: s.id, name: f.name.value, type: f.type.value, email: f.email.value, phone: f.phone.value, nif: f.nif.value, notes: f.notes.value })
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
