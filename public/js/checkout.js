// Ponto de entrada do checkout: abre/fecha os modais (passaporte e
// checkout) e arranca a etapa 1. A logica de cada etapa vive em
// ./checkout/*.js - ver checkoutState.js para o estado partilhado entre
// elas e checkoutShell.js para a moldura comum (stepper, resumo, modal).

import { $ } from './utils.js';
import { getCurrentOffer } from './state.js';
import { setCheckoutStep, renderCheckoutSummary, openCheckoutModal, closeCheckoutModal } from './checkout/checkoutShell.js';
import { resetCheckoutState, hasCheckoutProgress } from './checkout/checkoutState.js';
import { renderCheckoutStep1 } from './checkout/billingStep.js';

// O checkout tem dados reais a perder (faturacao, passageiros) antes de
// chegar ao pagamento - so ai a reserva fica guardada no servidor (e so
// ai ha um botao "Guardar e continuar mais tarde"). Antes disso, fechar
// por engano (clique no fundo, Escape) nao deve apagar tudo em silencio:
// um clique no fundo passa a nao fazer nada, e o botao X pede confirmacao
// enquanto houver progresso feito.
function requestCloseCheckout() {
  if (hasCheckoutProgress() && !confirm('Tem a certeza que quer sair? Os dados preenchidos nesta reserva vão perder-se.')) return;
  closeCheckoutModal();
}

$('#closeCheckoutModal').onclick = requestCloseCheckout;
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#checkoutModal').hidden) requestCloseCheckout();
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
