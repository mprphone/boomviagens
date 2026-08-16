// Vista "Passageiros": carteira reutilizavel do agregado do cliente
// (conjuge, filhos, pais, amigos...) - cada pessoa fica com nome,
// nascimento, nacionalidade, documento e relacao, guardados como lista
// completa (POST /api/customer/passengers). Mesmos campos da vista
// equivalente do backoffice (passengersTab.js).

import { $, esc, api } from './utils.js';

const RELATIONSHIPS = [
  { value: 'TITULAR', label: 'Titular (eu próprio)' },
  { value: 'CONJUGE', label: 'Cônjuge' },
  { value: 'FILHO', label: 'Filho(a)' },
  { value: 'PAI_MAE', label: 'Pai/Mãe' },
  { value: 'FAMILIAR', label: 'Familiar' },
  { value: 'AMIGO', label: 'Amigo(a)' },
  { value: 'OUTRO', label: 'Outro' }
];
const DOCUMENT_TYPES = [
  { value: 'PASSPORT', label: 'Passaporte' },
  { value: 'CC', label: 'Cartão de cidadão' },
  { value: 'OTHER', label: 'Outro' }
];

function labelFor(list, value) {
  return list.find(o => o.value === value)?.label || value || '—';
}

function age(birthdate) {
  if (!birthdate) return null;
  return Math.floor((Date.now() - new Date(birthdate).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

let passengers = [];

export async function renderPassageiros() {
  const el = $('#view-passageiros');
  el.innerHTML = '<p class="muted">A carregar...</p>';
  let data;
  try {
    data = await api('/api/customer/profile');
  } catch (err) {
    el.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }
  passengers = data.customer.passengers || [];

  el.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2>Passageiros</h2>
        <button type="button" class="btn mini-action" id="passengerAddBtn">+ Adicionar passageiro</button>
      </div>
      <p class="muted">Guarde aqui quem viaja consigo habitualmente, para não ter de introduzir os mesmos dados em cada reserva.</p>
      <form id="passengerForm" class="customer-profile-grid" hidden style="margin:14px 0">
        <label>Nome <input name="name" required /></label>
        <label>Relação <select name="relationship">${RELATIONSHIPS.map(r => `<option value="${r.value}">${r.label}</option>`).join('')}</select></label>
        <label>Data de nascimento <input type="date" name="birthdate" /></label>
        <label>Nacionalidade <input name="nationality" placeholder="ex.: Portuguesa" /></label>
        <label>Tipo de documento <select name="documentType">${DOCUMENT_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}</select></label>
        <label>Nº documento <input name="documentNumber" /></label>
        <label>Validade do documento <input type="date" name="documentExpiry" /></label>
        <div style="grid-column:1/-1"><label>Observações <textarea name="notes" rows="2"></textarea></label></div>
        <div style="grid-column:1/-1;display:flex;gap:10px">
          <button class="btn mini-action" type="submit">Guardar</button>
          <button class="ghost mini-action" type="button" id="passengerCancelBtn">Cancelar</button>
          <button class="ghost mini-action" type="button" id="passengerDeleteBtn" hidden>Eliminar</button>
        </div>
        <p class="customer-form-message" style="grid-column:1/-1"></p>
      </form>
      <div class="passenger-card-grid">
        ${passengers.map(p => `
          <div class="passenger-card" data-id="${esc(p.id)}">
            <div class="passenger-card-head">
              <b>${esc(p.name)}</b>
              <span class="pill info">${esc(labelFor(RELATIONSHIPS, p.relationship))}</span>
            </div>
            <div class="muted small">${age(p.birthdate) !== null ? `${age(p.birthdate)} anos · ` : ''}${esc(p.nationality || '—')}</div>
            ${p.documentNumber ? `<div class="muted small">${esc(labelFor(DOCUMENT_TYPES, p.documentType))} ${esc(p.documentNumber)}${p.documentExpiry ? ` · válido até ${esc(p.documentExpiry)}` : ''}</div>` : ''}
            <button type="button" class="ghost mini-action passenger-edit" data-id="${esc(p.id)}">Editar</button>
          </div>`).join('') || '<p class="empty-note">Ainda não tem passageiros guardados.</p>'}
      </div>
    </div>`;

  const form = $('#passengerForm');
  $('#passengerAddBtn').onclick = () => openForm(null);
  $('#passengerCancelBtn').onclick = () => { form.hidden = true; form.reset(); };
  el.querySelectorAll('.passenger-edit').forEach(btn => {
    btn.onclick = () => openForm(passengers.find(p => p.id === btn.dataset.id));
  });

  function openForm(passenger) {
    form.hidden = false;
    form.reset();
    form.dataset.editingId = passenger?.id || '';
    if (passenger) {
      form.name.value = passenger.name || '';
      form.relationship.value = passenger.relationship || 'TITULAR';
      form.birthdate.value = passenger.birthdate || '';
      form.nationality.value = passenger.nationality || '';
      form.documentType.value = passenger.documentType || 'PASSPORT';
      form.documentNumber.value = passenger.documentNumber || '';
      form.documentExpiry.value = passenger.documentExpiry || '';
      form.notes.value = passenger.notes || '';
    }
    $('#passengerDeleteBtn').hidden = !passenger;
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  $('#passengerDeleteBtn').onclick = async () => {
    const editingId = form.dataset.editingId;
    if (!editingId || !confirm('Eliminar este passageiro?')) return;
    await savePassengers(passengers.filter(p => p.id !== editingId));
  };

  form.onsubmit = async ev => {
    ev.preventDefault();
    const updated = {
      id: form.dataset.editingId || undefined,
      name: form.name.value,
      relationship: form.relationship.value,
      birthdate: form.birthdate.value,
      nationality: form.nationality.value,
      documentType: form.documentType.value,
      documentNumber: form.documentNumber.value,
      documentExpiry: form.documentExpiry.value,
      notes: form.notes.value
    };
    const next = form.dataset.editingId
      ? passengers.map(p => p.id === form.dataset.editingId ? { ...updated, id: p.id } : p)
      : [...passengers, updated];
    await savePassengers(next);
  };

  async function savePassengers(next) {
    const msg = form.querySelector('.customer-form-message');
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await api('/api/customer/passengers', { method: 'POST', body: JSON.stringify({ passengers: next }) });
      await renderPassageiros();
    } catch (err) {
      msg.textContent = err.message;
      btn.disabled = false;
    }
  }
}
