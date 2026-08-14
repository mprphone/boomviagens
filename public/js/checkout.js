// Ponto de entrada do checkout: abre/fecha os modais (passaporte e
// checkout) e arranca a etapa 1. A logica de cada etapa vive em
// ./checkout/*.js - ver checkoutState.js para o estado partilhado entre
// elas e checkoutShell.js para a moldura comum (stepper, resumo, modal).

import { $ } from './utils.js';
import { getCurrentOffer } from './state.js';
import { setCheckoutStep, renderCheckoutSummary, openCheckoutModal, closeCheckoutModal } from './checkout/checkoutShell.js';
import { resetCheckoutState } from './checkout/checkoutState.js';
import { renderCheckoutStep1 } from './checkout/billingStep.js';

$('#closeCheckoutModal').onclick = closeCheckoutModal;
$('#checkoutModal').addEventListener('click', e => {
  if (e.target.id === 'checkoutModal') closeCheckoutModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#checkoutModal').hidden) closeCheckoutModal();
  if (e.key === 'Escape' && !$('#passportModal').hidden) closePassportModal();
});

export function openPassportModal() { $('#passportModal').hidden = false; }
function closePassportModal() { $('#passportModal').hidden = true; }

$('#passportModalClose').onclick = closePassportModal;
$('#passportModal').addEventListener('click', e => { if (e.target.id === 'passportModal') closePassportModal(); });
$('#passportModalAccept').onclick = () => {
  closePassportModal();
  openCheckoutModal();
  resetCheckoutState();
  renderCheckoutSummary(getCurrentOffer());
  setCheckoutStep(1);
  renderCheckoutStep1();
};
