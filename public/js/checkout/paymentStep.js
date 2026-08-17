// Etapas 3 e 4: pagamento e confirmação. A escolha do método pertence aqui,
// nunca misturada com os passageiros. Em modo mock existe um botão explícito
// de simulação; em produção esse endpoint fica bloqueado no servidor.

import { $, money, api, esc, statusLabel } from '../utils.js';
import { getLastPayment, setLastPayment } from '../state.js';
import { goHome } from '../router.js';
import { setCheckoutStep, closeCheckoutModal } from './checkoutShell.js';

let checkoutData = null;
let paymentsMode = 'disabled';

export async function renderCheckoutStep3(data) {
  checkoutData = data;
  try { paymentsMode = (await api('/api/config')).paymentsMode || 'disabled'; } catch { paymentsMode = 'disabled'; }
  renderPaymentChoice(data);
}

function renderPaymentChoice(data) {
  const payment = getLastPayment() || data.payment;
  $('#checkoutMain').innerHTML = `
    <div class="payment-step">
      <div class="checkout-step-heading"><div><p class="eyebrow">Pagamento</p><h3>Escolha como pretende pagar</h3></div><span class="secure-payment-badge">Pagamento seguro</span></div>
      <div class="prepayment-checks">
        <div class="check-ok">✓ Passageiros validados</div>
        <div class="check-ok">✓ Documentos válidos até ao regresso</div>
        <div class="check-ok">✓ Total da viagem: <b>${money(payment.amount)}</b></div>
      </div>
      <div class="payment-methods payment-methods-large" role="radiogroup" aria-label="Método de pagamento">
        ${paymentOption('MB WAY','MW','MB WAY','Confirmação rápida na aplicação')}
        ${paymentOption('Referência Multibanco','MB','Multibanco','Pague através do banco ou homebanking')}
        ${paymentOption('Cartão','CC','Cartão','Visa / Mastercard em ambiente seguro')}
      </div>
      <label class="consent"><input type="checkbox" id="termsCheck" /><span>Li e aceito os <a href="#legal">Termos e Condições</a> e a <a href="#legal">Política de Privacidade</a>.</span></label>
      <div id="checkoutPaymentError"></div>
      <button class="btn wide" id="paymentContinue" type="button">Continuar com MB WAY</button>
      <button class="ghost wide" id="saveForLater" type="button">Guardar e pagar mais tarde</button>
      <p class="trust-note">O estado “pago” só é aceite pelo servidor após confirmação do gateway. Em modo de testes existe uma simulação controlada.</p>
    </div>`;

  function paymentOption(value, icon, title, subtitle) {
    return `<label class="payment-option detailed"><input type="radio" name="paymentMethod" value="${esc(value)}" ${value === 'MB WAY' ? 'checked' : ''}/><span class="payment-option-icon">${icon}</span><span><b>${title}</b><small>${subtitle}</small></span></label>`;
  }

  document.querySelectorAll('input[name="paymentMethod"]').forEach(radio => {
    radio.onchange = () => { $('#paymentContinue').textContent = `Continuar com ${radio.value}`; };
  });
  $('#paymentContinue').onclick = selectMethodAndContinue;
  $('#saveForLater').onclick = () => renderSavedForLater(data);
}

async function selectMethodAndContinue() {
  const method = document.querySelector('input[name="paymentMethod"]:checked')?.value || 'MB WAY';
  if (!$('#termsCheck').checked) {
    $('#checkoutPaymentError').innerHTML = '<p class="error">Aceite os Termos e Condições para continuar.</p>';
    return;
  }
  const btn = $('#paymentContinue');
  btn.disabled = true; btn.textContent = 'A preparar pagamento...';
  try {
    const updated = await api('/api/payment/method', { method: 'POST', body: JSON.stringify({ paymentId: getLastPayment().id, method }) });
    setLastPayment(updated.payment);
    renderPaymentGateway({ ...checkoutData, payment: updated.payment });
  } catch (err) {
    btn.disabled = false; btn.textContent = `Continuar com ${method}`;
    $('#checkoutPaymentError').innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

function paymentInstructions(method, payment) {
  const mock = paymentsMode === 'mock';
  if (method.includes('MB WAY')) return `<div class="payment-method-box"><div class="payment-method-icon">MW</div><div><b>MB WAY</b><p class="muted">${mock ? 'No ambiente de testes simulamos a confirmação.' : 'A referência/pedido real só será criado quando a sessão do gateway estiver ligada.'}</p></div></div>`;
  if (method.includes('Multibanco')) {
    if (!mock) return '<div class="payment-method-box"><div class="payment-method-icon">MB</div><div><b>Multibanco</b><p class="muted">A entidade e referência reais serão mostradas apenas depois de serem criadas pelo gateway.</p></div></div>';
    return `<div class="mb-slip"><div class="mb-slip-row"><span>Entidade de teste</span><strong>12345</strong></div><div class="mb-slip-row"><span>Referência de teste</span><strong>${esc(payment.reference)}</strong></div><div class="mb-slip-row"><span>Valor</span><strong>${money(payment.amount)}</strong></div></div>`;
  }
  return `<div class="payment-method-box"><div class="payment-method-icon">CC</div><div><b>Cartão</b><p class="muted">${mock ? 'No ambiente de testes a cobrança é simulada.' : 'A sessão de cartão será apresentada pelo gateway; a Boomviagens não deve receber os dados brutos do cartão.'}</p></div></div>`;
}

function renderPaymentGateway(data) {
  $('#checkoutMain').innerHTML = `
    <div class="payment-step">
      <button type="button" class="text-back" id="backPaymentChoice">← Alterar método</button>
      <h3>${esc(data.payment.method)}</h3>
      ${paymentInstructions(data.payment.method, data.payment)}
      <div class="secure-box">A reserva <b>${esc(data.reservation.id)}</b> está guardada. Nenhum pagamento é considerado recebido apenas por voltar à página de confirmação.</div>
      <div id="checkoutPaymentError"></div>
      ${paymentsMode === 'mock' ? '<button class="btn wide" id="confirmPayment" type="button">Simular pagamento aprovado</button>' : '<div class="legal-notice"><span class="legal-notice-icon">ℹ</span><p>Gateway real selecionado. Esta versão do frontend ainda aguarda a criação da sessão de pagamento pelo PaymentAdapter.</p></div>'}
      <button class="ghost wide" id="saveForLater" type="button">Guardar e continuar mais tarde</button>
    </div>`;
  $('#backPaymentChoice').onclick = () => renderPaymentChoice(data);
  $('#confirmPayment')?.addEventListener('click', onConfirmPayment);
  $('#saveForLater').onclick = () => renderSavedForLater(data);
}

function renderSavedForLater(data) {
  $('#checkoutMain').innerHTML = `<div class="confirmation-state"><div class="confirmation-icon">OK</div><h3>Reserva guardada</h3><p class="muted">A referência <b>${esc(data.reservation.id)}</b> fica associada à sua conta. Pode retomar na Área de Cliente sem voltar a preencher os passageiros.</p><p class="secure-box">Área de Cliente → Próximas viagens → Retomar pagamento.</p><button class="ghost" type="button" id="checkoutSavedDone">Fechar</button></div>`;
  $('#checkoutSavedDone').onclick = () => closeCheckoutModal();
}

function renderCheckoutStep4(data) {
  $('#checkoutMain').innerHTML = `
    <div class="confirmation-state celebration">
      <div class="confirmation-icon">✓</div>
      <p class="eyebrow">Reserva recebida</p>
      <h3>${esc(data.reservation.offer?.destination || 'A sua viagem')} está mais perto!</h3>
      <p class="muted">Referência <b>${esc(data.reservation.id)}</b> · ${statusLabel(data.reservation.status)}</p>
      <div class="confirmation-timeline"><div>✓ Pagamento registado</div><div>✓ Dados dos passageiros recebidos</div><div>⏳ Validação do operador</div><div>⏳ Vouchers após confirmação</div></div>
      <button class="btn" type="button" id="goCustomerArea">Ir para a minha viagem</button>
      <button class="ghost" type="button" id="checkoutDone">Fechar e pesquisar outra viagem</button>
    </div>`;
  $('#goCustomerArea').onclick = () => { location.href = '/conta/'; };
  $('#checkoutDone').onclick = () => { closeCheckoutModal(); goHome(); };
}

async function onConfirmPayment() {
  const btn = $('#confirmPayment');
  btn.disabled = true; btn.textContent = 'A confirmar...';
  $('#checkoutPaymentError').innerHTML = '';
  try {
    const data = await api('/api/payment/confirm', { method: 'POST', body: JSON.stringify({ paymentId: getLastPayment().id }) });
    setCheckoutStep(5); renderCheckoutStep4(data);
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Simular pagamento aprovado';
    $('#checkoutPaymentError').innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}
