// Moldura do modal de checkout, partilhada por todas as etapas: indicador
// de progresso, resumo da oferta na coluna lateral, e abrir/fechar o modal.

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
  $('#checkoutSummary').innerHTML = `
    <div class="meta">${offer.live ? '<span class="pill live">Preco real</span>' : '<span class="pill">Simulacao</span>'}</div>
    <h3>${esc(offer.hotel)}</h3>
    <p class="muted">${esc(offer.destination)}${offer.country ? `, ${esc(offer.country)}` : ''}</p>
    ${trip ? `<div class="summary-dates">${trip}</div>` : ''}
    <ul class="summary-facts">
      <li>${offer.board}</li>
      <li>${offer.nights} noites</li>
      <li>${offer.adults} adultos${offer.children ? ` + ${offer.children} criancas` : ''}</li>
      <li>${offer.freeCancellation ? 'Cancelamento flexivel' : 'Tarifa nao reembolsavel'}</li>
    </ul>
    <div class="summary-total"><span>Total</span><strong id="summaryTotalValue">${money(offer.finalPrice)}</strong></div>
    <p class="muted small">${offer.live ? 'Preco obtido diretamente no operador.' : 'Preco demonstrativo - a equipa confirma disponibilidade real antes de emitir documentos.'}</p>`;
}

export function openCheckoutModal() {
  $('#checkoutModal').hidden = false;
  document.body.style.overflow = 'hidden';
}

export function closeCheckoutModal() {
  $('#checkoutModal').hidden = true;
  document.body.style.overflow = '';
}
