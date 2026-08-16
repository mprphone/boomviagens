// "Concluir pagamento" - quando uma reserva ficou "Guardar e continuar mais
// tarde" no checkout (etapa de Pagamento, paymentStep.js no site publico),
// clicar nela em "As minhas viagens" traz de volta exatamente o mesmo ecra
// que o cliente viu la: instrucoes do metodo de pagamento ja escolhido +
// confirmar. App separada da do checkout (ver convencao no topo dos outros
// ficheiros desta pasta) - por isso reconstruido aqui, nao importado.

import { $, esc, money, api } from './utils.js';
import { openTripDetail } from './tripDetail.js';

function paymentInstructions(payment) {
  const method = payment.method || '';
  if (method.includes('MB WAY')) {
    return `<div class="payment-method-box">
      <div class="payment-method-icon">📱</div>
      <div><b>Confirme na app MB WAY</b><p class="muted">Vai receber um pedido de pagamento de ${money(payment.amount)} para aprovar na app associada ao seu número.</p></div>
    </div>`;
  }
  if (method.includes('Multibanco')) {
    return `<div class="mb-slip">
        <div class="mb-slip-row"><span>Entidade</span><strong>12345</strong></div>
        <div class="mb-slip-row"><span>Referência</span><strong>${esc(payment.reference || '')}</strong></div>
        <div class="mb-slip-row"><span>Valor</span><strong>${money(payment.amount)}</strong></div>
      </div>
      ${payment.expiresAt ? `<p class="muted small">Válida até ${new Date(payment.expiresAt).toLocaleString('pt-PT')}.</p>` : ''}`;
  }
  return `<div class="payment-method-box">
    <div class="payment-method-icon">💳</div>
    <div><b>Pagamento com cartão</b><p class="muted">Seria redirecionado para um gateway seguro (Stripe/SIBS) para introduzir os dados do cartão.</p></div>
  </div>`;
}

export async function renderResumePayment(reservationId) {
  document.querySelectorAll('.nav-item[data-view]').forEach(btn => btn.classList.toggle('is-active', btn.dataset.view === 'viagens'));
  document.querySelectorAll('.view').forEach(sec => { sec.hidden = sec.id !== 'view-viagem'; });
  const pageTitle = $('#pageTitle');

  const el = $('#view-viagem');
  el.innerHTML = '<p class="muted">A carregar...</p>';
  let data;
  try {
    data = await api(`/api/customer/reservations/detail?reservationId=${encodeURIComponent(reservationId)}`);
  } catch (err) {
    el.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }
  const r = data.reservation;
  const offer = r.offer || {};
  const payment = (r.payments || []).find(p => p.status !== 'PAID');
  if (pageTitle) pageTitle.textContent = offer.destination || 'Concluir pagamento';

  // Ja nao ha pagamento por concluir (confirmado entretanto por outra via,
  // ex.: a equipa) - mostra antes o detalhe normal da viagem.
  if (!payment) return openTripDetail(reservationId);

  el.innerHTML = `
    <button type="button" class="back-link">← As minhas viagens</button>
    <div class="trip-header">
      <h2>${esc(offer.destination || '')}${offer.country ? `, ${esc(offer.country)}` : ''}</h2>
      <p class="muted">${esc(offer.hotel || '')}</p>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Concluir pagamento - ${esc(payment.method || '')}</h2></div>
      ${paymentInstructions(payment)}
      <div class="secure-box">Reserva <b>${esc(r.id)}</b> guardada em seu nome desde que saiu do checkout. Confirme o pagamento para avançar.</div>
      <div id="resumePaymentError"></div>
      <button class="btn wide" type="button" id="resumeConfirmPayment">Confirmar pagamento (simulado)</button>
    </div>`;

  el.querySelector('.back-link').onclick = () => document.querySelector('.nav-item[data-view="viagens"]')?.click();
  $('#resumeConfirmPayment').onclick = async () => {
    const btn = $('#resumeConfirmPayment');
    btn.disabled = true;
    btn.textContent = 'A validar...';
    $('#resumePaymentError').innerHTML = '';
    try {
      await api('/api/payment/confirm', { method: 'POST', body: JSON.stringify({ paymentId: payment.id }) });
      openTripDetail(reservationId);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Confirmar pagamento (simulado)';
      $('#resumePaymentError').innerHTML = `<p class="error">${esc(err.message)}</p>`;
    }
  };
}
