// Modal de checkout: aviso sobre nomes de passageiros, dados/pagamento
// simulado e a confirmacao final. Tambem gere os dois modais (passaporte
// e checkout), ja que a passagem de um para o outro esta ligada.

import { $, esc, money, dateRange, formToJson, api, statusLabel } from './utils.js';
import { getCurrentOffer, getLastPayment, setLastPayment, setLastReservation } from './state.js';
import { goHome } from './router.js';
import { refreshAdmin } from './admin.js';

function setCheckoutStep(step) {
  document.querySelectorAll('#checkoutStepper .stepper-step').forEach(el => {
    const n = Number(el.dataset.step);
    el.classList.toggle('is-active', n === step);
    el.classList.toggle('is-done', n < step);
  });
}

function renderCheckoutSummary(offer) {
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

function passengerFields(offer) {
  const adults = offer.adults || 1;
  const children = offer.children || 0;
  const cards = [];
  for (let i = 0; i < adults + children; i++) {
    const isChild = i >= adults;
    const label = isChild ? `Criança ${i - adults + 1}` : `Adulto ${i + 1}`;
    cards.push(`
      <div class="passenger-card">
        <div class="passenger-card-title">${label}</div>
        <div class="passenger-card-grid">
          <label>Nome <input name="passengerName_${i}" ${i === 0 ? 'value="Cliente Teste"' : ''} required /></label>
          <label>Apelido <input name="passengerSurname_${i}" /></label>
          <label>Data de nascimento <input name="passengerBirthdate_${i}" type="date" /></label>
          <label>Género
            <select name="passengerGender_${i}">
              <option value="">Prefiro não indicar</option>
              <option value="F">Feminino</option>
              <option value="M">Masculino</option>
            </select>
          </label>
          <label>Nacionalidade <input name="passengerNationality_${i}" placeholder="Portuguesa" /></label>
          <label>Tipo de documento
            <select name="passengerDocType_${i}">
              <option value="CC">Cartão de Cidadão</option>
              <option value="PASSPORT">Passaporte</option>
            </select>
          </label>
          <label>Número do documento <input name="passengerDocNumber_${i}" /></label>
          <label>País do documento <input name="passengerDocCountry_${i}" placeholder="Portugal" /></label>
          <label>Validade do documento <input name="passengerDocExpiry_${i}" type="date" /></label>
        </div>
      </div>`);
  }
  return cards.join('');
}

function renderCheckoutStep1() {
  const offer = getCurrentOffer();
  $('#checkoutMain').innerHTML = `
    <form id="checkoutForm" class="checkout-form">
      <h3>Dados de faturacao</h3>
      <div class="form-row">
        <label>Nome completo <input name="name" value="Cliente Teste" required /></label>
        <label>Email <input type="email" name="email" value="cliente@exemplo.pt" required /></label>
      </div>
      <div class="form-row">
        <label>Telefone <input name="phone" value="+351900000000" /></label>
        <label>Contribuinte (NIF) <input name="nif" pattern="[0-9]{9}" maxlength="9" placeholder="opcional" /></label>
      </div>
      <label class="field-label">Passageiros</label>
      <div class="legal-notice">
        <span class="legal-notice-icon">⚠️</span>
        <p>Os nomes têm de corresponder exatamente ao documento de identificação (Cartão de Cidadão ou Passaporte). Correções depois da confirmação podem implicar custos adicionais cobrados pelo operador.</p>
      </div>
      <div class="passenger-list">${passengerFields(offer)}</div>
      <label class="consent"><input type="checkbox" required /><span>Confirmo que os nomes e dados dos passageiros estão corretos e coincidem com o documento de identificação que vão usar na viagem.</span></label>
      <label class="field-label">Metodo de pagamento</label>
      <div class="payment-methods" role="radiogroup" aria-label="Metodo de pagamento">
        <label class="payment-option"><input type="radio" name="paymentMethod" value="MB WAY" checked /><span class="payment-option-icon">\u{1F4F1}</span><span>MB WAY</span></label>
        <label class="payment-option"><input type="radio" name="paymentMethod" value="Referência Multibanco" /><span class="payment-option-icon">\u{1F3E7}</span><span>Multibanco</span></label>
        <label class="payment-option"><input type="radio" name="paymentMethod" value="Cartão" /><span class="payment-option-icon">\u{1F4B3}</span><span>Cartão</span></label>
      </div>
      <label class="consent"><input type="checkbox" required /><span>Li e aceito os <a href="#legal">Termos e Condicoes</a> e a <a href="#legal">Politica de Privacidade</a>.</span></label>
      <div id="checkoutFormError"></div>
      <button class="btn wide" type="submit">Continuar para pagamento</button>
      <p class="trust-note">Ligacao encriptada. Os seus dados servem apenas para tratar esta reserva.</p>
    </form>`;
  $('#checkoutForm').addEventListener('submit', onCheckoutSubmit);
}

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

function renderCheckoutStep2(data) {
  $('#checkoutMain').innerHTML = `
    <div class="payment-step">
      <h3>Pagamento - ${data.payment.method}</h3>
      ${paymentInstructions(data.payment.method, data.payment)}
      <div class="secure-box">Reserva <b>${data.reservation.id}</b> criada. Ainda sem emissao final ate o pagamento e a disponibilidade serem validados.</div>
      <div id="checkoutPaymentError"></div>
      <button class="btn wide" id="confirmPayment" type="button">Confirmar pagamento (simulado)</button>
      <p class="trust-note">Ambiente de testes: este pagamento e simulado. Em producao liga a SIBS, Easypay, Ifthenpay, EuPago ou Stripe.</p>
    </div>`;
  $('#confirmPayment').onclick = onConfirmPayment;
}

function renderCheckoutStep3(data) {
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

function openCheckoutModal() {
  $('#checkoutModal').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeCheckoutModal() {
  $('#checkoutModal').hidden = true;
  document.body.style.overflow = '';
}

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
  renderCheckoutSummary(getCurrentOffer());
  setCheckoutStep(1);
  renderCheckoutStep1();
};

async function onCheckoutSubmit(e) {
  e.preventDefault();
  const currentOffer = getCurrentOffer();
  if (!currentOffer) return;
  const form = e.target;
  const f = formToJson(form);
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'A criar reserva...';
  $('#checkoutFormError').innerHTML = '';
  const adults = currentOffer.adults || 1;
  const total = adults + (currentOffer.children || 0);
  const passengers = Array.from({ length: total }, (_, i) => ({
    name: f[`passengerName_${i}`] || '',
    surname: f[`passengerSurname_${i}`] || '',
    type: i < adults ? 'ADT' : 'CHD',
    birthdate: f[`passengerBirthdate_${i}`] || '',
    gender: f[`passengerGender_${i}`] || '',
    nationality: f[`passengerNationality_${i}`] || '',
    documentType: f[`passengerDocType_${i}`] || '',
    documentNumber: f[`passengerDocNumber_${i}`] || '',
    documentCountry: f[`passengerDocCountry_${i}`] || '',
    documentExpiry: f[`passengerDocExpiry_${i}`] || ''
  }));
  try {
    const data = await api('/api/checkout', {
      method: 'POST',
      body: JSON.stringify({
        offer: currentOffer,
        customer: { name: f.name, email: f.email, phone: f.phone, nif: f.nif, passengers },
        paymentMethod: f.paymentMethod,
        idempotencyKey: `${currentOffer.id}-${f.email}-${Date.now()}`
      })
    });
    setLastPayment(data.payment);
    setLastReservation(data.reservation);
    setCheckoutStep(2);
    renderCheckoutStep2(data);
    refreshAdmin();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Continuar para pagamento';
    $('#checkoutFormError').innerHTML = `<p class="error">${err.message}</p>`;
  }
}

async function onConfirmPayment() {
  const btn = $('#confirmPayment');
  btn.disabled = true;
  btn.textContent = 'A validar...';
  $('#checkoutPaymentError').innerHTML = '';
  try {
    const data = await api('/api/payment/confirm', { method: 'POST', body: JSON.stringify({ paymentId: getLastPayment().id }) });
    setCheckoutStep(3);
    renderCheckoutStep3(data);
    refreshAdmin();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Confirmar pagamento (simulado)';
    $('#checkoutPaymentError').innerHTML = `<p class="error">${err.message}</p>`;
  }
}
