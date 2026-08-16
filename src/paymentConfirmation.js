// Logica partilhada de "um pagamento acabou de ser confirmado" - valida no
// operador, marca o pagamento PAID, decide o proximo estado da reserva,
// gera o email e emite a fatura (src/invoicing.js). Extraido de
// checkoutRoutes.js#POST /api/payment/confirm para tambem ser chamado pelo
// webhook da Stripe (paymentsRoutes.js) - a unica parte que NAO e partilhada
// e a verificacao de sessao do cliente, que so faz sentido para o pedido
// vindo do proprio browser (o webhook autentica-se pela assinatura, nao por
// sessao).

module.exports = function createPaymentConfirmation(ctx) {
  const { readDb, updateDb, operators, reservationEmail, invoicing, domain } = ctx;
  const { ensureCollections, audit, addOperatorLog, id, now } = domain;

  async function confirmPayment(paymentId) {
    const db = ensureCollections(await readDb());
    const payment = db.payments.find(p => p.id === paymentId);
    if (!payment) return { ok: false, error: 'Pagamento não encontrado' };
    const reservation = db.reservations.find(r => r.id === payment.reservationId);
    if (!reservation) return { ok: false, error: 'Reserva não encontrada' };

    const adapter = operators.getForOffer(reservation.offer);
    // Operador desconhecido (ver auditoria) - nunca assumir o primeiro
    // adapter registado, fica sempre para revisao humana.
    const validation = adapter
      ? await adapter.value({ offer: reservation.offer, reservation })
      : { ok: false, operator: null, priceStillValid: false, availabilityStillValid: false, needsHumanReview: true, raw: { reason: `Operador desconhecido: "${reservation.offer?.operator || ''}"` } };

    let resultPayload = null;
    await updateDb(d => {
      ensureCollections(d);
      const p = d.payments.find(x => x.id === payment.id);
      if (p.status !== 'PAID') {
        p.status = 'PAID';
        p.paidAt = now();
      }
      const r = d.reservations.find(x => x.id === reservation.id);
      // needsHumanReview tem de bloquear a validacao automatica tal como
      // priceStillValid/availabilityStillValid - uma oferta sem referencias
      // reais do operador (needsHumanReview=true) nunca passa a
      // IN_VALIDATION como se tivesse sido mesmo validada.
      r.status = validation.priceStillValid && validation.availabilityStillValid && !validation.needsHumanReview ? 'IN_VALIDATION' : 'HUMAN_REVIEW';
      r.paymentReceivedAt = p.paidAt;
      r.operatorValidation = validation.raw?.mock ? 'MOCK_VALUE_OK' : 'VALUE_SENT';
      r.operatorValidationAt = now();
      const email = reservationEmail({ reservation: r, payment: p });
      d.emails.unshift({ id: id('email'), createdAt: now(), to: r.customer?.email || 'cliente@exemplo.pt', status: 'GERADO_DEMO', ...email });
      addOperatorLog(d, 'VALUE', validation);
      audit(d, 'system', 'PAYMENT_CONFIRMED_PENDING_OPERATOR', { reservationId: r.id, paymentId: p.id, status: r.status });
      resultPayload = { ok: true, payment: p, reservation: r, validation, next: 'Aguardando aprovacao do backoffice para confirmar no operador.' };
    });
    // Nunca deixa uma falha aqui (dados em falta, API fora do ar) rebentar a
    // confirmacao do pagamento em si - ver src/invoicing.js. Aguardado (nao
    // "fire and forget") porque em producao (Vercel) a funcao pode ser
    // congelada logo a seguir a responder.
    resultPayload.invoice = await invoicing.issueInvoiceForPayment(reservation.id, payment.id);
    return resultPayload;
  }

  return { confirmPayment };
};
