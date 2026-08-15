// Separador "Preferências": informação comercial (destinos, tipo de
// viagem, hotel, regime, companhia aérea, orçamento habitual...) que
// substitui o antigo campo genérico "Âmbito de viagem" - ajuda a propor a
// próxima viagem sem ter de perguntar tudo de novo.

import { esc, api } from '../utils.js';

export function renderPreferencesTab(panel, data, email, reload) {
  const p = data.customer.preferences || {};

  panel.innerHTML = `
    <form class="customer-preferences-form">
      <div class="customer-profile-grid">
        <label>Destinos preferidos <input name="preferredDestinations" value="${esc(p.preferredDestinations || '')}" placeholder="ex.: Caraíbas, Sudeste Asiático" /></label>
        <label>Tipo de viagem <input name="tripType" value="${esc(p.tripType || '')}" placeholder="ex.: Praia, City break, Neve, Cruzeiro" /></label>
        <label>Categoria de hotel <input name="hotelCategory" value="${esc(p.hotelCategory || '')}" placeholder="ex.: 4-5★" /></label>
        <label>Regime preferido <input name="boardPreference" value="${esc(p.boardPreference || '')}" placeholder="ex.: Tudo incluído" /></label>
        <label>Companhia aérea preferida <input name="preferredAirline" value="${esc(p.preferredAirline || '')}" /></label>
        <label>Lugares no avião <input name="seatPreference" value="${esc(p.seatPreference || '')}" placeholder="ex.: Corredor, junto à janela" /></label>
        <label>Tipo de quarto <input name="roomType" value="${esc(p.roomType || '')}" placeholder="ex.: Duplo vista mar" /></label>
        <label>Orçamento habitual <input name="usualBudget" value="${esc(p.usualBudget || '')}" placeholder="ex.: 1000-1500€/pessoa" /></label>
        <label>Datas/períodos preferidos <input name="preferredPeriods" value="${esc(p.preferredPeriods || '')}" placeholder="ex.: Julho/Agosto, Páscoa" /></label>
        <label>Aeroporto de partida preferido <input name="departureAirport" value="${esc(p.departureAirport || '')}" placeholder="ex.: Lisboa" /></label>
      </div>
      <label>Necessidades especiais <textarea name="specialNeeds" rows="2">${esc(p.specialNeeds || '')}</textarea></label>
      <label>Observações comerciais <textarea name="commercialNotes" rows="3">${esc(p.commercialNotes || '')}</textarea></label>
      <button class="btn mini-action" type="submit">Guardar</button>
      <p class="customer-form-message"></p>
    </form>`;

  panel.querySelector('.customer-preferences-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button[type="submit"]');
    const msg = panel.querySelector('.customer-form-message');
    btn.disabled = true;
    btn.textContent = 'A guardar...';
    try {
      await api('/api/admin/customers/preferences', {
        method: 'POST',
        body: JSON.stringify({
          email,
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
            specialNeeds: f.specialNeeds.value,
            commercialNotes: f.commercialNotes.value
          }
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
