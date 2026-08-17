// Moldura comum do checkout: progresso, resumo fixo e sinais de confianca.
// O cliente deve perceber sempre onde esta, o que escolheu e quanto vai pagar.

import { $, esc, money, dateRange } from '../utils.js';

export function setCheckoutStep(step) {
  document.querySelectorAll('#checkoutStepper .stepper-step').forEach(el => {
    const n = Number(el.dataset.step);
    el.classList.toggle('is-active', n === step);
    el.classList.toggle('is-done', n < step);
  });
}

export function renderCheckoutSummary(offer) {
  const trip = dateRange(offer.checkin, offer.checkout);
  const pax = `${offer.adults || 1} adulto${(offer.adults || 1) > 1 ? 's' : ''}${offer.children ? ` + ${offer.children} criança${offer.children > 1 ? 's' : ''}` : ''}${offer.infants ? ` + ${offer.infants} bebé${offer.infants > 1 ? 's' : ''}` : ''}`;
  $('#checkoutSummary').innerHTML = `
    <div class="checkout-summary-head">
      <div>
        <p class="eyebrow">A sua viagem</p>
        <h3>${esc(offer.destination || offer.hotel)}</h3>
        <p class="muted">${esc(offer.hotel || '')}</p>
      </div>
      <span class="pill ${offer.live ? 'live' : ''}">${offer.live ? 'Preço do operador' : 'Estimativa'}</span>
    </div>
    ${trip ? `<div class="summary-dates">${trip}</div>` : ''}
    <ul class="summary-facts">
      <li><span>👥</span>${esc(pax)}</li>
      <li><span>🌙</span>${offer.nights || '-'} noites</li>
      <li><span>🍽️</span>${esc(offer.board || 'Regime a confirmar')}</li>
      <li><span>${offer.freeCancellation ? '✓' : '!'}</span>${offer.freeCancellation ? 'Cancelamento flexível' : 'Tarifa com restrições de cancelamento'}</li>
    </ul>
    <div class="summary-total"><span>Total da viagem</span><strong id="summaryTotalValue">${money(offer.finalPrice)}</strong></div>
    <div class="checkout-confidence-list">
      <div>✓ Preço revisto antes do pagamento</div>
      <div>✓ Dados validados antes de avançar</div>
      <div>✓ Apoio humano se alguma etapa exigir confirmação</div>
    </div>`;
}

export function setAutosaveStatus(text = 'Guardado automaticamente') {
  const el = document.getElementById('checkoutAutosaveStatus');
  if (el) el.textContent = `✓ ${text}`;
}

export function openCheckoutModal() {
  $('#checkoutModal').hidden = false;
  document.body.style.overflow = 'hidden';
}

export function closeCheckoutModal() {
  $('#checkoutModal').hidden = true;
  document.body.style.overflow = '';
}
