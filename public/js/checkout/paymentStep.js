// Etapas 4 e 5: escolha do meio, sessão segura no gateway e confirmação.
// O browser nunca marca dinheiro como recebido; apenas o webhook autenticado
// (ou o simulador explicitamente ativado) altera o estado financeiro.

import { $, money, api, esc, statusLabel } from '../utils.js';
import { getLastPayment, setLastPayment } from '../state.js';
import { goHome } from '../router.js';
import { setCheckoutStep, closeCheckoutModal } from './checkoutShell.js';

let checkoutData = null;
let paymentsMode = 'disabled';
let paymentCapabilities = [];
let paymentAvailability = 'disabled';
let easypayInstance = null;

export async function renderCheckoutStep3(data) {
  checkoutData = data;
  try {
    const config = await api('/api/config');
    paymentsMode = config.paymentsMode || 'disabled';
    paymentCapabilities = Array.isArray(config.paymentMethods) ? config.paymentMethods : [];
    paymentAvailability = config.paymentAvailability || (paymentCapabilities.length ? 'available' : paymentsMode);
  } catch {
    paymentsMode = 'disabled';
    paymentCapabilities = [];
    paymentAvailability = 'disabled';
  }
  renderPaymentChoice(data);
}

function renderPaymentChoice(data) {
  easypayInstance?.unmount?.();
  easypayInstance = null;
  const payment = getLastPayment() || data.payment;
  const methods = paymentsMode === 'mock'
    ? [
        { id: 'MB WAY', label: 'MB WAY' },
        { id: 'Referência Multibanco', label: 'Multibanco' },
        { id: 'Cartão', label: 'Cartão' }
      ]
    : paymentCapabilities;
  const firstMethod = methods[0]?.id || '';
  const selectedMethod = methods.some(method => method.id === payment.method) ? payment.method : firstMethod;

  $('#checkoutMain').innerHTML = `
    <div class="payment-step">
      <div class="checkout-step-heading"><div><p class="eyebrow">Pagamento</p><h3>Escolha como pretende pagar</h3></div><span class="secure-payment-badge">Pagamento seguro</span></div>
      <div class="prepayment-checks">
        <div class="check-ok">✓ Passageiros validados</div>
        <div class="check-ok">✓ Documentos válidos até ao regresso</div>
        <div class="check-ok">✓ Total da viagem: <b>${money(payment.amount)}</b></div>
      </div>
      <div class="payment-methods payment-methods-large" role="radiogroup" aria-label="Método de pagamento">
        ${methods.map(method => paymentOption(method, method.id === selectedMethod)).join('')}
      </div>
      ${methods.length ? '' : `<div class="legal-notice"><span class="legal-notice-icon">!</span><p>${paymentAvailability === 'misconfigured' ? 'Os pagamentos de teste estão ativos, mas as credenciais Stripe/Easypay não estão disponíveis neste servidor. A configuração do deployment tem de ser atualizada.' : 'Os pagamentos online ainda não estão disponíveis neste ambiente. A reserva pode ser guardada e retomada mais tarde.'}</p></div>`}
      <label class="consent"><input type="checkbox" id="termsCheck" /><span>Li e aceito os <a href="#legal">Termos e Condições</a> e a <a href="#legal">Política de Privacidade</a>.</span></label>
      <div id="checkoutPaymentError"></div>
      <button class="btn wide" id="paymentContinue" type="button" ${methods.length ? '' : 'disabled'}>${methods.length ? `Continuar com ${esc(selectedMethod)}` : 'Pagamento indisponível'}</button>
      <button class="ghost wide" id="saveForLater" type="button">Guardar e pagar mais tarde</button>
      <p class="trust-note">O estado “pago” só é aceite pelo servidor após confirmação autenticada do gateway. Nunca introduza dados de cartão diretamente na Boomviagens.</p>
    </div>`;

  document.querySelectorAll('input[name="paymentMethod"]').forEach(radio => {
    radio.onchange = () => { $('#paymentContinue').textContent = `Continuar com ${radio.value}`; };
  });
  $('#paymentContinue').onclick = selectMethodAndContinue;
  $('#saveForLater').onclick = () => renderSavedForLater(data);
}

function paymentOption(method, checked) {
  const icon = method.id === 'MB WAY' ? 'MW' : method.id.includes('Multibanco') ? 'MB' : 'CC';
  const subtitle = method.id === 'MB WAY'
    ? 'Confirmação rápida na aplicação'
    : method.id.includes('Multibanco')
      ? 'Pague através do banco ou homebanking'
      : 'Visa / Mastercard em ambiente seguro';
  return `<label class="payment-option detailed"><input type="radio" name="paymentMethod" value="${esc(method.id)}" ${checked ? 'checked' : ''}/><span class="payment-option-icon">${icon}</span><span><b>${esc(method.label)}</b><small>${esc(subtitle)}</small></span></label>`;
}

async function selectMethodAndContinue() {
  const method = document.querySelector('input[name="paymentMethod"]:checked')?.value;
  if (!method) return;
  if (!$('#termsCheck').checked) {
    $('#checkoutPaymentError').innerHTML = '<p class="error">Aceite os Termos e Condições para continuar.</p>';
    return;
  }
  const btn = $('#paymentContinue');
  btn.disabled = true;
  btn.textContent = 'A preparar pagamento…';
  try {
    const updated = await api('/api/payment/method', { method: 'POST', body: JSON.stringify({ paymentId: getLastPayment().id, method }) });
    setLastPayment(updated.payment);
    await renderPaymentGateway({ ...checkoutData, payment: updated.payment });
  } catch (err) {
    btn.disabled = false;
    btn.textContent = `Continuar com ${method}`;
    $('#checkoutPaymentError').innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

function paymentInstructions(method, payment) {
  const mock = paymentsMode === 'mock';
  if (method === 'MB WAY') return `<div class="payment-method-box"><div class="payment-method-icon">MW</div><div><b>MB WAY</b><p class="muted">${mock ? 'No ambiente de testes simulamos a confirmação.' : 'O pedido é criado e confirmado no checkout seguro da Easypay.'}</p></div></div>`;
  if (method.includes('Multibanco')) {
    if (!mock) return '<div class="payment-method-box"><div class="payment-method-icon">MB</div><div><b>Multibanco</b><p class="muted">A entidade e a referência são geradas no checkout seguro da Easypay.</p></div></div>';
    return `<div class="mb-slip"><div class="mb-slip-row"><span>Entidade de teste</span><strong>12345</strong></div><div class="mb-slip-row"><span>Referência de teste</span><strong>${esc(payment.reference)}</strong></div><div class="mb-slip-row"><span>Valor</span><strong>${money(payment.amount)}</strong></div></div>`;
  }
  return `<div class="payment-method-box"><div class="payment-method-icon">CC</div><div><b>Cartão</b><p class="muted">${mock ? 'No ambiente de testes a cobrança é simulada.' : 'Será encaminhado para o Checkout seguro da Stripe; a Boomviagens nunca recebe os dados do cartão.'}</p></div></div>`;
}

async function renderPaymentGateway(data) {
  easypayInstance?.unmount?.();
  easypayInstance = null;
  $('#checkoutMain').innerHTML = `
    <div class="payment-step">
      <button type="button" class="text-back" id="backPaymentChoice">← Alterar método</button>
      <h3>${esc(data.payment.method)}</h3>
      ${paymentInstructions(data.payment.method, data.payment)}
      <div class="secure-box">A reserva <b>${esc(data.reservation.id)}</b> está guardada. Nenhum pagamento é considerado recebido apenas por voltar à página.</div>
      <div id="checkoutPaymentError"></div>
      ${paymentsMode === 'mock'
        ? '<button class="btn wide" id="confirmPayment" type="button">Simular pagamento aprovado</button>'
        : '<div class="gateway-loading" id="gatewayLoading"><span class="spinner"></span><p>A criar uma sessão segura no gateway…</p></div><div id="easypay-checkout" class="easypay-checkout"></div>'}
      <button class="ghost wide" id="saveForLater" type="button">Guardar e continuar mais tarde</button>
    </div>`;
  $('#backPaymentChoice').onclick = () => renderPaymentChoice(data);
  $('#confirmPayment')?.addEventListener('click', onConfirmPayment);
  $('#saveForLater').onclick = () => renderSavedForLater(data);
  if (paymentsMode !== 'mock') await startGatewaySession(data);
}

function loadEasyPaySdk() {
  if (window.easypayCheckout?.startCheckout) return Promise.resolve(window.easypayCheckout);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-easypay-sdk]');
    if (existing) {
      // Se chegou aqui, a biblioteca ainda nao criou o objeto global. Um
      // script anterior pode ter falhado; removemo-lo para o retry voltar a
      // efetuar um pedido real em vez de ficar eternamente à espera.
      existing.remove();
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.easypay.pt/checkout/2.9.1/';
    script.async = true;
    script.dataset.easypaySdk = 'true';
    script.onload = () => resolve(window.easypayCheckout);
    script.onerror = () => { script.remove(); reject(new Error('Não foi possível carregar o checkout Easypay.')); };
    document.head.appendChild(script);
  });
}

async function startGatewaySession(data) {
  const errorBox = $('#checkoutPaymentError');
  try {
    const response = await api('/api/payment/session', { method: 'POST', body: JSON.stringify({ paymentId: data.payment.id }) });
    const session = response.session;
    if (session.display === 'redirect' && session.url) {
      $('#gatewayLoading').innerHTML = '<p>A abrir o Checkout seguro da Stripe…</p>';
      window.location.assign(session.url);
      return;
    }
    if (session.display !== 'embedded' || !session.manifest) throw new Error('O gateway devolveu uma sessão inválida.');
    const sdk = await loadEasyPaySdk();
    $('#gatewayLoading')?.remove();
    easypayInstance = sdk.startCheckout(session.manifest, {
      id: 'easypay-checkout', display: 'inline', testing: Boolean(session.testing), language: 'pt_PT',
      accentColor: '#0878b9', buttonBackgroundColor: '#0878b9', buttonBorderRadius: 10, inputBorderRadius: 10,
      onSuccess: info => handleEasyPaySuccess(info, data),
      onError: error => {
        const message = error?.code === 'checkout-expired' ? 'A sessão expirou. Volte a escolher o método para criar uma nova.' : 'Não foi possível concluir este pagamento.';
        errorBox.innerHTML = `<p class="error">${esc(message)}</p>`;
      },
      onPaymentError: () => { errorBox.innerHTML = '<p class="error">O pagamento não foi autorizado. Pode corrigir os dados ou escolher outro método.</p>'; }
    });
  } catch (err) {
    $('#gatewayLoading')?.remove();
    errorBox.innerHTML = `<p class="error">${esc(err.message)}</p><button type="button" class="ghost wide" id="retryGateway">Tentar novamente</button>`;
    $('#retryGateway').onclick = () => startGatewaySession(data);
  }
}

async function handleEasyPaySuccess(info, data) {
  const paymentInfo = info?.payment || {};
  const reference = paymentInfo.reference
    ? `<div class="mb-slip"><div class="mb-slip-row"><span>Entidade</span><strong>${esc(paymentInfo.entity || '')}</strong></div><div class="mb-slip-row"><span>Referência</span><strong>${esc(paymentInfo.reference)}</strong></div><div class="mb-slip-row"><span>Valor</span><strong>${money(paymentInfo.value || data.payment.amount)}</strong></div></div>`
    : '';
  const confirmed = await waitForPayment(data.payment.id, 12);
  if (confirmed?.payment?.status === 'PAID') {
    setLastPayment(confirmed.payment);
    setCheckoutStep(5);
    renderCheckoutStep4({ ...data, payment: confirmed.payment, reservation: { ...data.reservation, status: confirmed.reservation.status } });
    return;
  }
  // O gateway autorizou, mas a confirmacao autenticada (webhook) ainda nao
  // chegou. O browser nunca marca como pago por si - explicar e deixar
  // verificar de novo ou acompanhar na area de cliente, em vez de ficar em
  // silencio como antes.
  $('#checkoutPaymentError').innerHTML = `
    ${reference}
    <p class="secure-box">Pedido recebido pela Easypay. Ainda estamos a aguardar a confirmação autenticada do pagamento — pode demorar alguns momentos.</p>
    <button class="btn wide" type="button" id="checkPaymentStatus">Verificar estado</button>
    <button class="ghost wide" type="button" id="goToAccount">Ver na Área de Cliente</button>`;
  $('#checkPaymentStatus').onclick = () => handleEasyPaySuccess(info, data);
  $('#goToAccount').onclick = () => { location.href = '/conta/'; };
}

async function waitForPayment(paymentId, attempts = 12) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const status = await api(`/api/payment/status?paymentId=${encodeURIComponent(paymentId)}`);
      if (status.payment?.status === 'PAID') return status;
    } catch { /* Continua pendente; pode ser retomado na área de cliente. */ }
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  return null;
}

function renderSavedForLater(data) {
  easypayInstance?.unmount?.();
  easypayInstance = null;
  $('#checkoutMain').innerHTML = `<div class="confirmation-state"><div class="confirmation-icon">OK</div><h3>Reserva guardada</h3><p class="muted">A referência <b>${esc(data.reservation.id)}</b> fica associada à sua conta. Pode retomar na Área de Cliente sem voltar a preencher os passageiros.</p><p class="secure-box">Área de Cliente → Próximas viagens → Rever e continuar.</p><button class="ghost" type="button" id="checkoutSavedDone">Fechar</button></div>`;
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
  btn.disabled = true;
  btn.textContent = 'A confirmar…';
  $('#checkoutPaymentError').innerHTML = '';
  try {
    const data = await api('/api/payment/confirm', { method: 'POST', body: JSON.stringify({ paymentId: getLastPayment().id }) });
    setCheckoutStep(5);
    renderCheckoutStep4(data);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Simular pagamento aprovado';
    $('#checkoutPaymentError').innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}
