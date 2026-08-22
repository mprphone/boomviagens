// Reconciliacao periodica de pagamentos pendentes. Hoje so os webhooks
// (src/routes/paymentsRoutes.js) confirmam pagamentos: se uma notificacao
// se perder (gateway em baixo, endpoint indisponivel, restart a meio), a
// reserva ficava PENDING_PAYMENT para sempre mesmo com o dinheiro recebido.
// Este modulo corre de hora em hora via GET /api/cron/payment-reconciliation
// (ver src/routes/cronRoutes.js e vercel.json) e pergunta diretamente a cada
// gateway, de forma autenticada, pelo estado real dos pagamentos pendentes
// ha mais de X horas - reutilizando o verifyPayment() que cada adapter ja
// expoe para a reconciliacao direta de /api/payment/status.
//
// Agendamento num VPS (fora da Vercel nao ha "crons" da plataforma): basta
// uma entrada no cron do sistema a chamar o endpoint protegido, ex.:
//   0 * * * * curl -sf -H "Authorization: Bearer $CRON_SECRET" https://dominio/api/cron/payment-reconciliation
//
// Modo mock: seguro por construcao. Pagamentos criados em PAYMENTS_MODE=mock
// nunca tem gateway/gatewaySessionId (ver checkoutRoutes.js), por isso nem
// sequer entram na lista de candidatos; e mesmo que existissem, um adapter
// sem credenciais (isConfigured() === false) e saltado sem qualquer
// verificacao. Nada e marcado como pago sem uma resposta autenticada do
// gateway a confirmar paymentId + montante + moeda.

module.exports = function createPaymentReconciliation(ctx) {
  const { readDb, updateDb, paymentGateways, paymentConfirmation, domain } = ctx;
  const { ensureCollections, audit } = domain;

  // Mesma barreira de seguranca do webhook (paymentsRoutes.js) e da
  // reconciliacao de /api/payment/status (checkoutRoutes.js): o id bater
  // certo nao chega - o montante e a moeda verificados no gateway tem de
  // coincidir com o que o nosso ledger esperava.
  function matchesLedger(payment, verification) {
    const expectedAmount = Number(payment.amount || 0);
    const amountMatches = (verification?.amountMinor == null || Math.round(expectedAmount * 100) === Math.round(Number(verification.amountMinor)))
      && (verification?.amount == null || Math.abs(expectedAmount - Number(verification.amount)) <= 0.005);
    const currencyMatches = !verification?.currency || verification.currency === 'EUR';
    return verification?.paymentId === payment.id && amountMatches && currencyMatches;
  }

  async function reconcilePendingPayments({ olderThanHours = 2 } = {}) {
    const hours = Number.isFinite(Number(olderThanHours)) && Number(olderThanHours) > 0 ? Number(olderThanHours) : 2;
    const db = ensureCollections(await readDb());
    const cutoffMs = Date.now() - hours * 60 * 60 * 1000;

    // So pagamentos com sessao real num gateway conhecido fazem sentido
    // reconciliar. Usa-se updatedAt/createdAt (o mais recente) para dar
    // margem a pagamentos acabados de criar/reusar antes de os inquietar.
    const candidates = db.payments.filter(payment => {
      if (payment.status !== 'PENDING') return false;
      if (!payment.gateway || !payment.gatewaySessionId) return false;
      const since = new Date(payment.updatedAt || payment.createdAt || 0).getTime();
      return since && since < cutoffMs;
    });

    const summary = { olderThanHours: hours, candidates: candidates.length, checked: 0, confirmed: 0, stillPending: 0, skipped: 0, errors: [] };
    for (const payment of candidates) {
      const adapter = paymentGateways?.get?.(payment.gateway);
      // Sem adapter ou sem credenciais nao ha como verificar de forma
      // autenticada - saltar e a unica opcao segura (nunca assumir pago).
      if (!adapter || typeof adapter.verifyPayment !== 'function' || !adapter.isConfigured()) {
        summary.skipped += 1;
        continue;
      }
      summary.checked += 1;
      try {
        const verification = await adapter.verifyPayment(payment.gatewaySessionId);
        if (matchesLedger(payment, verification)) {
          // Exatamente o mesmo fluxo do webhook: grava PAID de forma
          // duravel, valida no operador, fatura, voucher e emails - e e
          // idempotente se o webhook entretanto ja tiver chegado.
          await paymentConfirmation.confirmPayment(payment.id);
          summary.confirmed += 1;
        } else {
          summary.stillPending += 1;
        }
      } catch (err) {
        // Um gateway em baixo nao pode falhar a reconciliacao dos outros
        // pagamentos - fica registado e a proxima corrida volta a tentar.
        summary.errors.push({ paymentId: payment.id, gateway: payment.gateway, error: err.message });
      }
    }

    // So audita quando a corrida teve efeito ou problemas - um cron de hora
    // a hora a escrever "nada aconteceu" inundava o audit log (cap de 200).
    if (summary.confirmed > 0 || summary.errors.length > 0) {
      await updateDb(d => {
        ensureCollections(d);
        audit(d, 'system', 'PAYMENT_RECONCILIATION_RUN', summary);
      });
    }
    return summary;
  }

  return { reconcilePendingPayments };
};
