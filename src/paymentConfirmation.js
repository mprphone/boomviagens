// Registo de um pagamento confirmado por gateway/mock. Regra principal:
// dinheiro recebido e um facto financeiro independente da disponibilidade
// do operador. Primeiro grava PAID de forma duravel; so depois consulta o
// operador. Se o operador falhar, o processo fica HUMAN_REVIEW, nunca volta
// a parecer "nao pago".

const AUTO_CONFIRM_ENABLED = String(process.env.HBX_AUTO_CONFIRM_ENABLED || '').toLowerCase() === 'true';
// Uma tentativa de reserva HBX demora 1-2s; se o gateway desistir de esperar
// a nossa resposta e reenviar o mesmo webhook enquanto a primeira tentativa
// ainda esta a decorrer, as duas nao podem chegar a chamar createBooking em
// paralelo (reservava-se a dobrar). updateDb() (src/storage.js) le tudo,
// muda, escreve - nao ha compare-and-swap ao nivel da base de dados, por
// isso isto nao protege contra dois pedidos verdadeiramente simultaneos na
// mesma fracao de segundo, mas fecha o caso real (retry de webhook a meio
// de uma tentativa lenta). Uma trava a serio exigiria mudar updateDb para
// todo o projeto - fora de escopo aqui.
const LOCK_STALE_MS = 2 * 60 * 1000;

module.exports = function createPaymentConfirmation(ctx) {
  const { readDb, updateDb, operators, reservationEmail, invoicing, voucherIssuing, mailer, domain } = ctx;
  const { ensureCollections, audit, addOperatorLog, id, now } = domain;

  // sendMail() e' assincrono (SMTP real) - nunca pode correr dentro do
  // mutator sincrono do updateDb (ver storage.js). Chamado a seguir, com o
  // conteudo ja decidido dentro do mutator. Nunca deixa uma falha aqui
  // reverter o pagamento/confirmacao ja gravados - so fica registada para
  // deteção, mesmo padrao de invoicing.js/voucherIssuing.js.
  async function sendReservationEmail(pending) {
    if (!pending) return;
    try {
      await mailer.sendMail(pending);
    } catch (err) {
      await updateDb(d => {
        ensureCollections(d);
        d.reservationEvents.unshift({ id: id('evt'), createdAt: now(), reservationId: pending.reservationId, actor: 'sistema', type: 'EMAIL_SEND_FAILED', description: err.message });
      });
    }
  }

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
      // 'locked' = outra tentativa esta mesmo a decorrer agora (back off,
      // fica para revisao humana). 'already' = uma tentativa concorrente ja
      // terminou com sucesso entretanto (idempotente - usa o locator real
      // que ja existe, nunca sobrepor com HUMAN_REVIEW).
      let outcome = 'proceed';
      let existingLocator = null;
      await updateDb(d => {
        ensureCollections(d);
        const r = d.reservations.find(x => x.id === reservation.id);
        if (!r) return;
        if (r.operatorLocator) { outcome = 'already'; existingLocator = r.operatorLocator; return; }
        const lock = r.hbxBookingLock;
        const stale = lock && Date.now() - new Date(lock.startedAt).getTime() > LOCK_STALE_MS;
        if (lock && !stale) { outcome = 'locked'; return; }
        r.hbxBookingLock = { startedAt: now() };
      });
      if (outcome === 'already') {
        confirmation = { ok: true, operator: adapter.name, locator: existingLocator, needsHumanReview: false, raw: { idempotent: true } };
      } else if (outcome === 'locked') {
        confirmation = { ok: false, operator: adapter.name, locator: null, needsHumanReview: true, raw: { reason: 'Outra tentativa de confirmação automática já em curso para esta reserva.' } };
      } else {
        try {
          confirmation = await adapter.confirm({ reservation: paidReservation, payment: paidPayment });
        } catch (err) {
          confirmation = { ok: false, operator: adapter.name, locator: null, needsHumanReview: true, raw: { reason: err.message, operatorUnavailable: true } };
        }
      }
    }
    const canAutoConfirm = Boolean(confirmation?.ok && confirmation.locator && !confirmation.needsHumanReview);

    let resultPayload;
    let pendingEmail = null;
    await updateDb(d => {
      ensureCollections(d);
      const p = d.payments.find(x => x.id === payment.id);
      const r = d.reservations.find(x => x.id === reservation.id);
      if (!p || !r) return;
      delete r.hbxBookingLock;
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
      const to = r.customer?.email || 'cliente@exemplo.pt';
      d.emails.unshift({ id: id('email'), createdAt: now(), to, status: mailer.isConfigured() ? 'ENVIADO' : 'GERADO_DEMO', ...email });
      pendingEmail = { to, subject: email.subject, body: email.body, reservationId: r.id };
      resultPayload = { ok: true, payment: { ...p }, reservation: { ...r }, validation, confirmation, next: canAutoConfirm ? 'Reserva confirmada automaticamente.' : 'Pagamento registado; processo aguarda validacao/confirmacao operacional.' };
    });

    await sendReservationEmail(pendingEmail);
    resultPayload.invoice = await invoicing.issueInvoiceForPayment(reservation.id, payment.id);
    if (canAutoConfirm) resultPayload.voucher = await voucherIssuing.issueVoucherForReservation(reservation.id, payment.id);
    return resultPayload;
  }

  return { confirmPayment };
};
