// Separador "Viagem": destino, datas, passageiros, valor/probabilidade,
// origem, temperatura e etiquetas da oportunidade.

import { esc, api } from '../../utils.js';

const TAGS = [
  { value: 'VIP', label: 'VIP' }, { value: 'FAMILIA', label: 'Família' }, { value: 'LUA_DE_MEL', label: 'Lua de mel' },
  { value: 'GRUPO', label: 'Grupo' }, { value: 'URGENTE', label: 'Urgente' }
];

export function renderViagemTab(panel, data, opportunityId, reload) {
  const o = data.opportunity;
  const origins = data.origins || [];
  const temperatures = data.temperatures || [];

  panel.innerHTML = `
    <form class="customer-profile-form">
      <div class="customer-profile-grid">
        <label>Destino <input name="destination" value="${esc(o.destination || '')}" /></label>
        <label>Data início <input type="date" name="dateStart" value="${esc(o.dateStart || '')}" /></label>
        <label>Data fim <input type="date" name="dateEnd" value="${esc(o.dateEnd || '')}" /></label>
        <label>Adultos <input type="number" name="paxAdults" min="0" value="${o.paxAdults ?? 1}" /></label>
        <label>Crianças <input type="number" name="paxChildren" min="0" value="${o.paxChildren ?? 0}" /></label>
        <label>Valor estimado (€) <input type="number" name="estimatedValue" min="0" step="0.01" value="${o.estimatedValue ?? ''}" /></label>
        <label>Probabilidade (%) <input type="number" name="probability" min="0" max="100" value="${o.probability ?? ''}" /></label>
        <label>Origem <select name="origin"><option value="">Selecionar...</option>${origins.map(x => `<option value="${x.value}" ${o.origin === x.value ? 'selected' : ''}>${x.label}</option>`).join('')}</select></label>
        <label>Temperatura <select name="temperature">${temperatures.map(x => `<option value="${x.value}" ${o.temperature === x.value ? 'selected' : ''}>${x.label}</option>`).join('')}</select></label>
      </div>
      <fieldset class="drawer-form-fields" style="border:0;padding:0;margin:10px 0">
        <legend class="summary-block-label" style="margin:0 0 6px">Etiquetas</legend>
        ${TAGS.map(t => `<label class="service-line-checkbox"><input type="checkbox" name="tags" value="${t.value}" ${o.tags?.includes(t.value) ? 'checked' : ''} /> ${t.label}</label>`).join('')}
      </fieldset>
      <label>Notas <textarea name="notes" rows="3">${esc(o.notes || '')}</textarea></label>
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
      const tags = [...f.querySelectorAll('input[name=tags]:checked')].map(cb => cb.value);
      await api('/api/admin/opportunities', {
        method: 'POST',
        body: JSON.stringify({
          id: opportunityId, customerName: data.opportunity.customerName,
          destination: f.destination.value, dateStart: f.dateStart.value, dateEnd: f.dateEnd.value,
          paxAdults: f.paxAdults.value, paxChildren: f.paxChildren.value, estimatedValue: f.estimatedValue.value || undefined,
          probability: f.probability.value || undefined, origin: f.origin.value, temperature: f.temperature.value,
          tags, notes: f.notes.value
        })
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
