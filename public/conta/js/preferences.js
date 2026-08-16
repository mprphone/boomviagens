// Vista "Preferências": informação comercial (destinos, tipo de viagem,
// hotel, regime, companhia aérea, orçamento habitual...) que ajuda a
// agência a propor a próxima viagem sem perguntar tudo de novo. Mesmos
// campos da vista equivalente do backoffice (preferencesTab.js), exceto
// commercialNotes (notas internas da equipa, nunca editáveis nem
// visíveis ao próprio cliente).

import { $, esc, api } from './utils.js';

export async function renderPreferencias() {
  const el = $('#view-preferencias');
  el.innerHTML = '<p class="muted">A carregar...</p>';
  let data;
  try {
    data = await api('/api/customer/profile');
  } catch (err) {
    el.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }
  const p = data.customer.preferences || {};

  el.innerHTML = `
    <div class="panel" style="max-width:640px">
      <div class="panel-head"><h2>Preferências de viagem</h2></div>
      <p class="muted">Ajuda-nos a sugerir a próxima viagem certa para si.</p>
      <form id="preferencesForm" class="customer-profile-grid" style="margin-top:14px">
        <label>Destinos preferidos <input name="preferredDestinations" value="${esc(p.preferredDestinations || '')}" placeholder="ex.: Caraíbas, Sudeste Asiático" /></label>
        <label>Tipo de viagem <input name="tripType" value="${esc(p.tripType || '')}" placeholder="ex.: Praia, City break, Neve, Cruzeiro" /></label>
        <label>Categoria de hotel <input name="hotelCategory" value="${esc(p.hotelCategory || '')}" placeholder="ex.: 4-5★" /></label>
        <label>Regime preferido <input name="boardPreference" value="${esc(p.boardPreference || '')}" placeholder="ex.: Tudo incluído" /></label>
        <label>Companhia aérea preferida <input name="preferredAirline" value="${esc(p.preferredAirline || '')}" /></label>
        <label>Lugares no avião <input name="seatPreference" value="${esc(p.seatPreference || '')}" placeholder="ex.: Corredor, junto à janela" /></label>
        <label>Tipo de quarto <input name="roomType" value="${esc(p.roomType || '')}" placeholder="ex.: Duplo vista mar" /></label>
        <label>Orçamento habitual <input name="usualBudget" value="${esc(p.usualBudget || '')}" placeholder="ex.: 1000-1500€/pessoa" /></label>
        <label>Datas/períodos preferidos <input name="preferredPeriods" value="${esc(p.preferredPeriods || '')}" placeholder="ex.: Julho/Agosto, Páscoa" /></label>
        <label>Aeroporto de partida preferido <input name="departureAirport" value="${esc(p.departureAirport || '')}" placeholder="ex.: Porto" /></label>
        <div style="grid-column:1/-1"><label>Necessidades especiais <textarea name="specialNeeds" rows="2">${esc(p.specialNeeds || '')}</textarea></label></div>
        <div style="grid-column:1/-1"><button class="btn mini-action" type="submit">Guardar</button></div>
        <p class="customer-form-message" style="grid-column:1/-1"></p>
      </form>
    </div>`;

  $('#preferencesForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button[type=submit]');
    const msg = f.querySelector('.customer-form-message');
    btn.disabled = true;
    btn.textContent = 'A guardar...';
    try {
      await api('/api/customer/preferences', {
        method: 'POST',
        body: JSON.stringify({
          preferences: {
            preferredDestinations: f.preferredDestinations.value,
            tripType: f.tripType.value,
            hotelCategory: f.hotelCategory.value,
            boardPreference: f.boardPreference.value,
            preferredAirline: f.preferredAirline.value,
            seatPreference: f.seatPreference.value,
            roomType: f.roomType.value,
            usualBudget: f.usualBudget.value,
            preferredPeriods: f.preferredPeriods.value,
            departureAirport: f.departureAirport.value,
            specialNeeds: f.specialNeeds.value
          }
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
