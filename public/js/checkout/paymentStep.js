// Etapas 3 e 4: pagamento (simulado) e confirmacao final. Sequencia fixa
// (uma leva sempre a outra), por isso ficam juntas no mesmo modulo.

import { $, money, api, statusLabel } from '../utils.js';
import { getLastPayment } from '../state.js';
import { goHome } from '../router.js';
import { setCheckoutStep, closeCheckoutModal } from './checkoutShell.js';

function paymentInstructions(method, payment) {
  if (method.includes('MB WAY')) {
    return `<div class="payment-method-box">
      <div class="payment-method-icon">\u{1F4F1}</div>
      <div><b>Confirme na app MB WAY</b><p class="muted">Vai receber um pedido de pagamento de ${money(payment.amount)} para aprovar na app associada ao seu numero.</p></div>
    </div>`;
  }
  if (method.includes('Multibanco')) {
    return `<div class="mb-slip">
        <div class="mb-slip-row"><span>Entidade</span><strong>12345</strong></div>
        <div class="mb-slip-row"><span>Referencia</span><strong>${payment.reference}</strong></div>
        <div class="mb-slip-row"><span>Valor</span><strong>${money(payment.amount)}</strong></div>
      </div>
      <p class="muted small">Valida ate ${new Date(payment.expiresAt).toLocaleString('pt-PT')}.</p>`;
  }
  return `<div class="payment-method-box">
    <div class="payment-method-icon">\u{1F4B3}</div>
    <div><b>Pagamento com cartao</b><p class="muted">Seria redirecionado para um gateway seguro (Stripe/SIBS) para introduzir os dados do cartao.</p></div>
  </div>`;
}

export function renderCheckoutStep3(data) {
  $('#checkoutMain').innerHTML = `
    <div class="payment-step">
      <h3>Pagamento - ${data.payment.method}</h3>
      ${paymentInstructions(data.payment.method, data.payment)}
      <div class="secure-box">Reserva <b>${data.reservation.id}</b> criada. Ainda sem emissao final ate o pagamento e a disponibilidade serem validados.</div>
      <div id="checkoutPaymentError"></div>
      <button class="btn wide" id="confirmPayment" type="button">Confirmar pagamento (simulado)</button>
      <button class="ghost wide" id="saveForLater" type="button">Guardar e continuar mais tarde</button>
      <p class="trust-note">Ambiente de testes: este pagamento e simulado. Em producao liga a SIBS, Easypay, Ifthenpay, EuPago ou Stripe.</p>
    </div>`;
  $('#confirmPayment').onclick = onConfirmPayment;
  $('#saveForLater').onclick = () => renderSavedForLater(data);
}

// A reserva e o pagamento ja existem (status PENDING_PAYMENT/PENDING) desde
// que a etapa de Passageiros terminou - nao ha nada extra a gravar aqui, so
// tranquilizar quem nao tem o cartao a mao agora e dizer onde retomar.
function renderSavedForLater(data) {
  $('#checkoutMain').innerHTML = `
    <div class="confirmation-state">
      <div class="confirmation-icon">💾</div>
      <h3>Reserva guardada</h3>
      <p class="muted">Referencia <b>${data.reservation.id}</b> fica guardada em seu nome. Pode concluir o pagamento quando quiser, sem preencher nada outra vez.</p>
      <p class="secure-box">Va a <b>Área de Cliente → As minhas viagens</b> e escolha esta reserva para retomar o pagamento.</p>
      <button class="ghost" type="button" id="checkoutSavedDone">Fechar</button>
    </div>`;
  $('#checkoutSavedDone').onclick = () => closeCheckoutModal();
}

function renderCheckoutStep4(data) {
  $('#checkoutMain').innerHTML = `
    <div class="confirmation-state">
      <div class="confirmation-icon">✓</div>
      <h3>Reserva registada com sucesso</h3>
      <p class="muted">Referencia interna <b>${data.reservation.id}</b> - estado atual: <b>${statusLabel(data.reservation.status)}</b>.</p>
      <p class="secure-box">A nossa equipa esta a validar disponibilidade e preco com o operador. Assim que confirmado, recebe email com o voucher e todos os detalhes.</p>
      <button class="ghost" type="button" id="checkoutDone">Fechar e fazer nova pesquisa</button>
    </div>`;
  $('#checkoutDone').onclick = () => {
    closeCheckoutModal();
    goHome();
  };
}

async function onConfirmPayment() {
  const btn = $('#confirmPayment');
  btn.disabled = true;
  btn.textContent = 'A validar...';
  $('#checkoutPaymentError').innerHTML = '';
  try {
    const data = await api('/api/payment/confirm', { method: 'POST', body: JSON.stringify({ paymentId: getLastPayment().id }) });
    setCheckoutStep(4);
    renderCheckoutStep4(data);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Confirmar pagamento (simulado)';
    $('#checkoutPaymentError').innerHTML = `<p class="error">${err.message}</p>`;
  }
}
