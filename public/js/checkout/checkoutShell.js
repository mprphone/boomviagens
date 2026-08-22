// Moldura comum do checkout: progresso, resumo fixo e sinais de confianca.
// O cliente deve perceber sempre onde esta, o que escolheu e quanto vai pagar.

import { $, esc, money, dateRange } from '../utils.js';

export function setCheckoutStep(step) {
  document.querySelectorAll('#checkoutStepper .stepper-step').forEach(el => {
    const n = Number(el.dataset.step);
    el.classList.toggle('is-active', n === step);
    el.classList.toggle('is-done', n < step);
  });
  document.querySelector('.checkout-layout')?.scrollTo({ top: 0, behavior: 'smooth' });
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
    <div class="summary-total"><span>Total da viagem</span><strong id="summaryTotalValue">${money(offer.finalPrice)}</strong></div>
    <details class="checkout-summary-more"${window.matchMedia('(max-width: 900px)').matches ? '' : ' open'}>
      <summary>Detalhes da viagem</summary>
      ${trip ? `<div class="summary-dates">${trip}</div>` : ''}
      <ul class="summary-facts">
        <li><span>PX</span>${esc(pax)}</li>
        <li><span>NT</span>${offer.nights || '-'} noites</li>
        <li><span>RG</span>${esc(offer.board || 'Regime a confirmar')}</li>
        <li><span>${offer.freeCancellation ? '✓' : '!'}</span>${offer.freeCancellation ? 'Cancelamento flexível' : 'Tarifa com restrições de cancelamento'}</li>
      </ul>
      <div class="checkout-confidence-list">
        <div>✓ Preço revisto antes do pagamento</div>
        <div>✓ Dados validados antes de avançar</div>
        <div>✓ Apoio humano se alguma etapa exigir confirmação</div>
      </div>
    </details>`;
}

export function setAutosaveStatus(text = 'Guardado automaticamente') {
  const el = document.getElementById('checkoutAutosaveStatus');
  if (el) el.textContent = `✓ ${text}`;
}

export function openCheckoutModal() {
  $('#checkoutModal').hidden = false;
  document.body.classList.add('modal-open', 'checkout-open');
  document.body.style.overflow = 'hidden';
}

export function closeCheckoutModal() {
  $('#checkoutModal').hidden = true;
  document.body.classList.remove('modal-open', 'checkout-open');
  document.body.style.overflow = '';
}
