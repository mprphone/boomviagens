// Etapa 3: confirma o que já faz parte da viagem e permite pedir extras sem
// inventar preço ou disponibilidade. O pedido entra no CRM e a reserva segue.

import { $, api, esc } from '../utils.js';
import { getCurrentOffer } from '../state.js';
import { getBilling } from './checkoutState.js';
import { setCheckoutStep } from './checkoutShell.js';
import { renderCheckoutStep3 } from './paymentStep.js';

export function renderCheckoutExtras(data) {
  const offer = getCurrentOffer() || {};
  const included = [
    offer.flight ? 'Voo selecionado' : null,
    offer.hotel ? `Estadia em ${offer.hotel}` : null,
    offer.transfer ? 'Transfer incluído' : null,
    offer.insurance ? 'Seguro incluído' : null,
    Array.isArray(offer.activities) && offer.activities.length
      ? `${offer.activities.length} experiência${offer.activities.length === 1 ? '' : 's'} selecionada${offer.activities.length === 1 ? '' : 's'}`
      : null
  ].filter(Boolean);

  $('#checkoutMain').innerHTML = `
    <div class="checkout-form extras-step">
      <div class="checkout-step-heading"><div><p class="eyebrow">Extras</p><h3>Complete a sua viagem</h3></div><span class="step-count">Opcional</span></div>
      <div class="included-services">
        <b>Já incluído na seleção</b>
        <ul>${(included.length ? included : ['Serviços apresentados no resumo da viagem']).map(item => `<li><span aria-hidden="true">✓</span>${esc(item)}</li>`).join('')}</ul>
      </div>
      <p class="muted">Os pedidos abaixo não alteram o total agora. A equipa confirma disponibilidade e preço antes de qualquer cobrança adicional.</p>
      <div class="extras-options">
        <label class="extra-option"><input type="checkbox" value="TRANSFER" /><span><b>Transfer</b><small>Aeroporto, hotel ou porto</small></span></label>
        <label class="extra-option"><input type="checkbox" value="INSURANCE" /><span><b>Seguro de viagem</b><small>Proteção ajustada ao destino</small></span></label>
        <label class="extra-option"><input type="checkbox" value="EXPERIENCE" /><span><b>Experiências</b><small>Tours, eventos e atividades</small></span></label>
      </div>
      <div id="checkoutExtrasFeedback" class="inline-feedback" aria-live="polite"></div>
      <button class="btn wide" type="button" id="extrasContinue">Continuar para pagamento</button>
      <button class="ghost wide" type="button" id="extrasSkip">Continuar sem pedir extras</button>
    </div>`;

  $('#extrasContinue').onclick = () => continueFromExtras(data, true);
  $('#extrasSkip').onclick = () => continueFromExtras(data, false);
}

async function continueFromExtras(data, submitRequests) {
  const selected = submitRequests
    ? [...document.querySelectorAll('.extras-options input:checked')].map(input => input.value)
    : [];
  const button = submitRequests ? $('#extrasContinue') : $('#extrasSkip');
  button.disabled = true;
  button.textContent = selected.length ? 'A registar os pedidos…' : 'A preparar pagamento…';

  if (selected.length) {
    const billing = getBilling();
    const offer = getCurrentOffer() || {};
    const outcomes = await Promise.allSettled(selected.map(kind => api('/api/assisted-request', {
      method: 'POST',
      body: JSON.stringify({
        kind,
        name: billing.name,
        email: billing.email,
        phone: billing.phone,
        destination: offer.destination || offer.hotel || '',
        checkin: offer.checkin || '',
        checkout: offer.checkout || '',
        adults: offer.adults || 1,
        children: offer.children || 0,
        notes: `Extra pedido durante o checkout da reserva ${data.reservation?.id || ''}`
      })
    })));
    const failed = outcomes.filter(result => result.status === 'rejected').length;
    if (failed) $('#checkoutExtrasFeedback').textContent = 'Alguns pedidos não ficaram registados. Pode continuar e pedir apoio na sua área de cliente.';
  }

  setCheckoutStep(4);
  await renderCheckoutStep3(data);
}
