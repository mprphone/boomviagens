// Emissao automatica de voucher quando uma reserva HBX confirma sozinha
// (ver src/hotelbedsAdapter.js e src/paymentConfirmation.js). Mesmo padrao
// de src/invoicing.js: nunca deixa uma falha aqui reverter o que ja e um
// facto - a reserva na Hotelbeds ja existe e esta confirmada, uma falha a
// gerar/guardar o PDF fica so registada para nova tentativa manual.

const { buildVoucherPdf } = require('./voucherPdf');

module.exports = function createVoucherIssuing(ctx) {
  const { readDb, updateDb, fileStorage, domain } = ctx;
  const { id, now, ensureCollections, audit } = domain;

  async function issueVoucherForReservation(reservationId, paymentId) {
    const db = ensureCollections(await readDb());
    const reservation = db.reservations.find(r => r.id === reservationId);
    const payment = db.payments.find(p => p.id === paymentId);
    if (!reservation || !payment) return { ok: false, reason: 'Reserva ou pagamento não encontrado' };

    // Re-derivado do estado persistido (nao de um objeto passado pelo
    // chamador) - torna esta funcao seguramente reutilizavel a partir de
    // um replay de webhook ou de um futuro botao "reemitir voucher".
    if (reservation.status !== 'CONFIRMED' || !reservation.operatorLocator) {
      return { ok: false, reason: 'Reserva ainda não confirmada com localizador real.' };
    }
    if (db.documents.some(doc => doc.reservationId === reservationId && doc.type === 'VOUCHER')) {
      return { ok: true, alreadyIssued: true };
    }

    try {
      const buffer = await buildVoucherPdf({ reservation, payment, locator: reservation.operatorLocator, company: db.company || {} });
      const fileName = `voucher-${reservation.operatorLocator}.pdf`;
      const docId = id('doc');
      const storagePath = `${reservationId}/viagem/${docId}-${fileName}`;
      await fileStorage.uploadFile(storagePath, buffer, 'application/pdf');

      await updateDb(d => {
        ensureCollections(d);
        d.documents.unshift({
          id: docId, createdAt: now(),
          reservationId, paymentId,
          documentNumber: reservation.operatorLocator,
          documentDate: now().slice(0, 10),
          amount: payment.amount,
          type: 'VOUCHER',
          fileName,
          storagePath,
          uploadedBy: 'sistema (HBX)'
        });
        d.reservationEvents.unshift({ id: id('evt'), createdAt: now(), reservationId, actor: 'sistema', type: 'VOUCHER_ISSUED', description: `Voucher emitido automaticamente · localizador ${reservation.operatorLocator}` });
        audit(d, 'sistema', 'VOUCHER_ISSUED', { reservationId, paymentId, locator: reservation.operatorLocator });
      });
      return { ok: true, documentId: docId };
    } catch (err) {
      await updateDb(d => {
        ensureCollections(d);
        d.reservationEvents.unshift({ id: id('evt'), createdAt: now(), reservationId, actor: 'sistema', type: 'VOUCHER_ISSUE_FAILED', description: err.message });
      });
      return { ok: false, reason: err.message };
    }
  }

  return { issueVoucherForReservation };
};
