// Ponto de entrada do checkout: abre/fecha os modais (passaporte e
// checkout) e arranca a etapa 1. A logica de cada etapa vive em
// ./checkout/*.js - ver checkoutState.js para o estado partilhado entre
// elas e checkoutShell.js para a moldura comum (stepper, resumo, modal).

import { $ } from './utils.js';
import { getCurrentOffer } from './state.js';
import { setCheckoutStep, renderCheckoutSummary, openCheckoutModal, closeCheckoutModal } from './checkout/checkoutShell.js';
import { resetCheckoutState, hasCheckoutProgress, restoreCheckoutDraft, setDraftOfferId } from './checkout/checkoutState.js';
import { renderCheckoutStep1, applyExistingSessionIfAny } from './checkout/billingStep.js';

// O checkout tem dados reais a perder (faturacao, passageiros) antes de
// chegar ao pagamento - so ai a reserva fica guardada no servidor (e so
// ai ha um botao "Guardar e continuar mais tarde"). Antes disso, fechar
// por engano (clique no fundo, Escape) nao deve apagar tudo em silencio:
// um clique no fundo passa a nao fazer nada, e o botao X pede confirmacao
// enquanto houver progresso feito.
function requestCloseCheckout() {
  if (hasCheckoutProgress() && !confirm('Quer sair deste checkout? O rascunho fica guardado neste navegador para poder continuar mais tarde.')) return;
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
$('#passportModalAccept').onclick = async () => {
  closePassportModal();
  openCheckoutModal();
  const offer = getCurrentOffer();
  resetCheckoutState({ keepDraft: true });
  const restored = restoreCheckoutDraft(offer?.id);
  setDraftOfferId(offer?.id);
  renderCheckoutSummary(offer);
  setCheckoutStep(1);
  // Se ja houver sessao ativa da Area de Cliente, isto marca o email como
  // verificado e pre-preenche os dados antes do primeiro render - sem
  // isto, o formulario piscava rapidamente no estado "por verificar".
  await applyExistingSessionIfAny();
  renderCheckoutStep1();
  if (restored) setTimeout(() => { const el = document.getElementById('checkoutAutosaveStatus'); if (el) el.textContent = '✓ Recuperámos os dados que já tinha preenchido'; }, 0);
};
