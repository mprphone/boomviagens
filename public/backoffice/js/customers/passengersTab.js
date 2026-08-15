// Separador "Passageiros": agregado familiar do cliente (conjuge, filhos,
// pais, amigos...) reutilizavel entre viagens - cada pessoa fica com nome,
// nascimento, nacionalidade, documento e relacao. Guardado como lista
// completa no cliente (ver /api/admin/customers/passengers), com
// adicionar/editar numa gaveta lateral.

import { esc, api } from '../utils.js';
import { openDrawer, closeDrawer } from '../drawer.js';

const DOCUMENT_TYPES = [
  { value: 'PASSPORT', label: 'Passaporte' },
  { value: 'CC', label: 'Cartão de cidadão' },
  { value: 'OTHER', label: 'Outro' }
];

const RELATIONSHIPS = [
  { value: 'TITULAR', label: 'Titular (o próprio cliente)' },
  { value: 'CONJUGE', label: 'Cônjuge' },
  { value: 'FILHO', label: 'Filho(a)' },
  { value: 'PAI_MAE', label: 'Pai/Mãe' },
  { value: 'FAMILIAR', label: 'Familiar' },
  { value: 'AMIGO', label: 'Amigo(a)' },
  { value: 'OUTRO', label: 'Outro' }
];

function labelFor(list, value) {
  return list.find(o => o.value === value)?.label || value || '—';
}

function age(birthdate) {
  if (!birthdate) return null;
  const diff = Date.now() - new Date(birthdate).getTime();
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
}

function expiryClass(dateStr) {
  if (!dateStr) return '';
  const months = (new Date(dateStr) - new Date()) / (1000 * 60 * 60 * 24 * 30);
  if (months < 0) return 'pill-warning';
  if (months < 6) return 'pill-warning';
  return 'pill-ok';
}

export function renderPassengersTab(panel, data, email, reload) {
  const passengers = data.customer.passengers || [];

  panel.innerHTML = `
    <div class="tab-toolbar">
      <button type="button" class="btn mini-action passenger-add">+ Adicionar passageiro</button>
    </div>
    <div class="passenger-card-grid">
      ${passengers.map(p => `
        <div class="passenger-card" data-id="${esc(p.id)}">
          <div class="passenger-card-head">
            <b>${esc(p.name)}</b>
            <span class="pill">${esc(labelFor(RELATIONSHIPS, p.relationship))}</span>
          </div>
          <div class="muted small">${age(p.birthdate) !== null ? `${age(p.birthdate)} anos · ` : ''}${esc(p.nationality || '—')}</div>
          ${p.documentNumber ? `<div class="muted small">${esc(labelFor(DOCUMENT_TYPES, p.documentType))} ${esc(p.documentNumber)}${p.documentExpiry ? ` · <span class="pill ${expiryClass(p.documentExpiry)}">válido até ${esc(p.documentExpiry)}</span>` : ''}</div>` : ''}
          ${p.notes ? `<p class="muted small">${esc(p.notes)}</p>` : ''}
        </div>`).join('') || '<p class="empty-note">Ainda sem passageiros registados.</p>'}
    </div>`;

  panel.querySelectorAll('.passenger-card').forEach(card => {
    card.onclick = () => openPassengerDrawer(passengers.find(p => p.id === card.dataset.id), passengers, email, reload);
  });

  panel.querySelector('.passenger-add').onclick = () => openPassengerDrawer(null, passengers, email, reload);
}

function openPassengerDrawer(passenger, passengers, email, reload) {
  const body = openDrawer(passenger ? passenger.name : 'Novo passageiro');
  body.innerHTML = `
    <form class="passenger-form">
      <div class="drawer-form-fields">
        <label>Nome <input name="name" required value="${esc(passenger?.name || '')}" /></label>
        <label>Relação <select name="relationship">${RELATIONSHIPS.map(r => `<option value="${r.value}" ${passenger?.relationship === r.value ? 'selected' : ''}>${r.label}</option>`).join('')}</select></label>
        <label>Data de nascimento <input type="date" name="birthdate" value="${esc(passenger?.birthdate || '')}" /></label>
        <label>Nacionalidade <input name="nationality" value="${esc(passenger?.nationality || '')}" placeholder="ex.: Portuguesa" /></label>
        <label>Tipo de documento <select name="documentType">${DOCUMENT_TYPES.map(t => `<option value="${t.value}" ${passenger?.documentType === t.value ? 'selected' : ''}>${t.label}</option>`).join('')}</select></label>
        <label>Nº documento <input name="documentNumber" value="${esc(passenger?.documentNumber || '')}" /></label>
        <label>Validade do documento <input type="date" name="documentExpiry" value="${esc(passenger?.documentExpiry || '')}" /></label>
      </div>
      <label class="service-line-notes">Observações <textarea name="notes" rows="2">${esc(passenger?.notes || '')}</textarea></label>
      <div class="service-line-form-actions">
        <button class="btn mini-action" type="submit">${passenger ? 'Guardar alterações' : 'Adicionar passageiro'}</button>
        ${passenger ? '<button type="button" class="ghost mini-action passenger-delete">Eliminar</button>' : ''}
      </div>
      <p class="customer-form-message"></p>
    </form>`;

  const form = body.querySelector('.passenger-form');
  form.onsubmit = async ev => {
    ev.preventDefault();
    const msg = body.querySelector('.customer-form-message');
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    const updated = {
      id: passenger?.id,
      name: form.name.value,
      relationship: form.relationship.value,
      birthdate: form.birthdate.value,
      nationality: form.nationality.value,
      documentType: form.documentType.value,
      documentNumber: form.documentNumber.value,
      documentExpiry: form.documentExpiry.value,
      notes: form.notes.value
    };
    const next = passenger
      ? passengers.map(p => p.id === passenger.id ? updated : p)
      : [...passengers, updated];
    try {
      await api('/api/admin/customers/passengers', { method: 'POST', body: JSON.stringify({ email, passengers: next }) });
      await reload();
      closeDrawer();
    } catch (err) {
      msg.textContent = err.message;
      btn.disabled = false;
    }
  };

  const deleteBtn = body.querySelector('.passenger-delete');
  if (deleteBtn) {
    deleteBtn.onclick = async () => {
      if (!confirm('Eliminar este passageiro?')) return;
      try {
        const next = passengers.filter(p => p.id !== passenger.id);
        await api('/api/admin/customers/passengers', { method: 'POST', body: JSON.stringify({ email, passengers: next }) });
        await reload();
        closeDrawer();
      } catch (err) { alert(err.message); }
    };
  }
}
