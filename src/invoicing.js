// Emissao automatica de fatura de venda quando um pagamento passa a PAID -
// chamado por checkoutRoutes.js (/api/payment/confirm) e adminRoutes.js
// (/api/admin/reservations/payments), sempre DEPOIS do proprio updateDb que
// marca o pagamento como pago. updateDb() so aceita mutators sincronos (ve-
// -se em storage.js: `const result = mutator(db) || db;`, sem await) - por
// isso as chamadas assincronas (API da Facturalusa, download do PDF,
// storage) ficam todas fora de qualquer updateDb, e so escrevem o resultado
// no fim, num updateDb proprio e sincrono.
//
// Nunca deixa uma falha (dados em falta, API fora do ar) subir e rebentar a
// confirmacao do pagamento em si - fica sempre registada em
// reservationEvents, com um botao "Tentar emitir agora" no backoffice
// (faturasDocumentosSubTab.js) para recuperar depois de corrigido o motivo.

module.exports = function createInvoicing(ctx) {
  const { readDb, updateDb, fileStorage, facturalusa, domain } = ctx;
  const { id, now, ensureCollections, audit } = domain;

  async function logEvent(reservationId, type, description) {
    await updateDb(d => {
      ensureCollections(d);
      d.reservationEvents.unshift({ id: id('evt'), createdAt: now(), reservationId, actor: 'sistema', type, description });
    });
  }

  async function issueInvoiceForPayment(reservationId, paymentId) {
    const db = ensureCollections(await readDb());
    const reservation = db.reservations.find(r => r.id === reservationId);
    const payment = db.payments.find(p => p.id === paymentId);
    if (!reservation || !payment) return { ok: false, reason: 'Reserva ou pagamento não encontrado' };

    // Idempotencia: se ja houver uma fatura ligada a este pagamento (ex.:
    // pedido repetido), nao emite outra vez.
    if (db.documents.some(doc => doc.paymentId === paymentId && doc.type === 'INVOICE_SALE')) {
      return { ok: true, alreadyIssued: true };
    }

    const customerInfo = reservation.customer || {};
    const { address, city, postalCode } = customerInfo;
    if (!address || !city || !postalCode) {
      const reason = 'Falta morada/localidade/código postal do cliente na ficha';
      await logEvent(reservationId, 'INVOICE_ISSUE_SKIPPED', reason);
      return { ok: false, reason };
    }

    try {
      const customer = await facturalusa.findOrCreateCustomer({
        name: customerInfo.name, email: customerInfo.email, nif: customerInfo.nif,
        address, city, postalCode
      });
      const article = await facturalusa.findOrCreateTravelArticle();
      const series = await facturalusa.findOrCreateSeries();
      const offer = reservation.offer || {};
      const description = [offer.hotel, offer.destination].filter(Boolean).join(' - ') || 'Viagem';
      const result = await facturalusa.issueSaleInvoice({
        customer, article, series, description,
        amount: payment.amount,
        vatRegime: reservation.vatRegime || 'MARGEM',
        address, city, postalCode
      });

      let storagePath;
      let fileName = `${result.documentNumber || paymentId}.pdf`;
      if (result.fileUrl) {
        const pdfRes = await fetch(result.fileUrl);
        if (!pdfRes.ok) throw new Error(`Falha ao descarregar PDF da fatura: ${pdfRes.status}`);
        const buffer = Buffer.from(await pdfRes.arrayBuffer());
        const docId = id('doc');
        storagePath = `${reservationId}/financeiro/${docId}-${fileName}`;
        await fileStorage.uploadFile(storagePath, buffer, 'application/pdf');
      }

      await updateDb(d => {
        ensureCollections(d);
        const docId = id('doc');
        d.documents.unshift({
          id: docId, createdAt: now(),
          reservationId, paymentId,
          documentNumber: result.documentNumber || undefined,
          documentDate: now().slice(0, 10),
          amount: result.amount,
          type: 'INVOICE_SALE',
          fileName,
          storagePath: storagePath || undefined,
          uploadedBy: 'sistema (Facturalusa)'
        });
        d.reservationEvents.unshift({ id: id('evt'), createdAt: now(), reservationId, actor: 'sistema', type: 'INVOICE_ISSUED', description: `Fatura ${result.documentNumber || ''} emitida automaticamente via Facturalusa` });
        audit(d, 'sistema', 'INVOICE_ISSUED', { reservationId, paymentId, documentNumber: result.documentNumber });
      });
      return { ok: true, documentNumber: result.documentNumber };
    } catch (err) {
      await logEvent(reservationId, 'INVOICE_ISSUE_FAILED', err.message);
      return { ok: false, reason: err.message };
    }
  }

  return { issueInvoiceForPayment };
};
