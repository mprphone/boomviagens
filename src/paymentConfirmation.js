// Registo de um pagamento confirmado por gateway/mock. Regra principal:
// dinheiro recebido e um facto financeiro independente da disponibilidade
// do operador. Primeiro grava PAID de forma duravel; so depois consulta o
// operador. Se o operador falhar, o processo fica HUMAN_REVIEW, nunca volta
// a parecer "nao pago".

const AUTO_CONFIRM_ENABLED = String(process.env.HBX_AUTO_CONFIRM_ENABLED || '').toLowerCase() === 'true';

module.exports = function createPaymentConfirmation(ctx) {
  const { readDb, updateDb, operators, reservationEmail, invoicing, voucherIssuing, domain } = ctx;
  const { ensureCollections, audit, addOperatorLog, id, now } = domain;

  async function confirmPayment(paymentId) {
    const db = ensureCollections(await readDb());
    const payment = db.payments.find(p => p.id === paymentId);
    if (!payment) return { ok: false, error: 'Pagamento não encontrado' };
    const reservation = db.reservations.find(r => r.id === payment.reservationId);
    if (!reservation) return { ok: false, error: 'Reserva não encontrada' };

    // Webhooks podem repetir. Se este pagamento ja foi tratado, nao volta a
    // consultar o operador nem a gerar emails; apenas garante que a faturacao
    // (e o voucher, se ja houver localizador real) tem oportunidade de
    // recuperar de uma falha anterior.
    if (payment.status === 'PAID') {
      const invoice = await invoicing.issueInvoiceForPayment(reservation.id, payment.id);
      const voucher = await voucherIssuing.issueVoucherForReservation(reservation.id, payment.id);
      return { ok: true, payment, reservation, idempotent: true, invoice, voucher };
    }

    let paidPayment;
    let paidReservation;
    await updateDb(d => {
      ensureCollections(d);
      const p = d.payments.find(x => x.id === payment.id);
      const r = d.reservations.find(x => x.id === reservation.id);
      if (!p || !r) return;
      if (p.status !== 'PAID') {
        p.status = 'PAID';
        p.paidAt = now();
        p.updatedAt = now();
      }
      delete p.gatewaySession;
      if (r.offer?._paymentSessions) delete r.offer._paymentSessions[p.id];
      r.paymentReceivedAt = p.paidAt;
      // Estado transitório: o pagamento esta seguro, a validacao operacional
      // acontece a seguir. Isto e importante se a API externa estiver em baixo.
      if (r.status === 'PENDING_PAYMENT') r.status = 'PAYMENT_RECEIVED';
      audit(d, 'system', 'PAYMENT_RECEIVED', { reservationId: r.id, paymentId: p.id });
      paidPayment = { ...p };
      paidReservation = { ...r };
    });

    const adapter = operators.getForOffer(reservation.offer);
    let validation;
    try {
      validation = adapter
        ? await adapter.value({ offer: reservation.offer, reservation: paidReservation })
        : { ok: false, operator: null, priceStillValid: false, availabilityStillValid: false, needsHumanReview: true, raw: { reason: `Operador desconhecido: "${reservation.offer?.operator || ''}"` } };
    } catch (err) {
      validation = { ok: false, operator: reservation.offer?.operator || null, priceStillValid: false, availabilityStillValid: false, needsHumanReview: true, raw: { reason: err.message, operatorUnavailable: true } };
    }

    // So tenta confirmar sozinho quando o flag esta ligado e a valorizacao
    // veio limpa - usa o mesmo portao ok+locator+!needsHumanReview ja usado
    // no botao manual de aprovacao (adminRoutes.js). A TourDiezAdapter nunca
    // devolve locator (ver operatorAdapters.js), por isso este caminho fica
    // sempre inacessivel para ela - nenhuma reserva TourDiez muda de
    // comportamento com isto.
    let confirmation = null;
    if (AUTO_CONFIRM_ENABLED && adapter && validation.priceStillValid && validation.availabilityStillValid && !validation.needsHumanReview) {
      try {
        confirmation = await adapter.confirm({ reservation: paidReservation, payment: paidPayment });
      } catch (err) {
        confirmation = { ok: false, operator: adapter.name, locator: null, needsHumanReview: true, raw: { reason: err.message, operatorUnavailable: true } };
      }
    }
    const canAutoConfirm = Boolean(confirmation?.ok && confirmation.locator && !confirmation.needsHumanReview);

    let resultPayload;
    await updateDb(d => {
      ensureCollections(d);
      const p = d.payments.find(x => x.id === payment.id);
      const r = d.reservations.find(x => x.id === reservation.id);
      if (!p || !r) return;
      if (canAutoConfirm) {
        r.status = 'CONFIRMED';
        r.confirmedAt = now();
        r.operatorLocator = confirmation.locator;
        r.operatorConfirmation = confirmation.raw?.mock ? 'MOCK_CONFIRM_OK' : 'CONFIRM_SENT';
        addOperatorLog(d, 'CONFIRM', confirmation);
        audit(d, 'system', 'RESERVATION_AUTO_CONFIRMED', { reservationId: r.id, paymentId: p.id, operatorLocator: r.operatorLocator });
      } else {
        r.status = validation.priceStillValid && validation.availabilityStillValid && !validation.needsHumanReview ? 'IN_VALIDATION' : 'HUMAN_REVIEW';
        r.operatorValidation = validation.raw?.mock ? 'MOCK_VALUE_OK' : (validation.raw?.operatorUnavailable ? 'VALUE_ERROR' : 'VALUE_SENT');
        r.operatorValidationAt = now();
        addOperatorLog(d, 'VALUE', validation);
        audit(d, 'system', 'PAYMENT_CONFIRMED_PENDING_OPERATOR', { reservationId: r.id, paymentId: p.id, status: r.status });
      }
      const email = reservationEmail({ reservation: r, payment: p });
      d.emails.unshift({ id: id('email'), createdAt: now(), to: r.customer?.email || 'cliente@exemplo.pt', status: 'GERADO_DEMO', ...email });
      resultPayload = { ok: true, payment: { ...p }, reservation: { ...r }, validation, confirmation, next: canAutoConfirm ? 'Reserva confirmada automaticamente.' : 'Pagamento registado; processo aguarda validacao/confirmacao operacional.' };
    });

    resultPayload.invoice = await invoicing.issueInvoiceForPayment(reservation.id, payment.id);
    if (canAutoConfirm) resultPayload.voucher = await voucherIssuing.issueVoucherForReservation(reservation.id, payment.id);
    return resultPayload;
  }

  return { confirmPayment };
};
