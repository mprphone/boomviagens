const PDFDocument = require('pdfkit');

// Gera um voucher simples e honesto - so campos que existem mesmo na
// reserva (nunca inventa morada do hotel, telefone, etc. que a HBX nao
// devolveu). Ver src/voucherIssuing.js para onde isto e guardado.
function buildVoucherPdf({ reservation, payment, locator, company = {} }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const offer = reservation.offer || {};
    const passengers = reservation.passengers || [];

    doc.fontSize(18).text(company.brand || 'Boomviagens', { continued: false });
    doc.fontSize(9).fillColor('#666')
      .text(company.name || '')
      .text([company.nif ? `NIF ${company.nif}` : '', company.rnavt ? `RNAVT ${company.rnavt}` : ''].filter(Boolean).join(' · '))
      .text([company.email || '', company.phone || ''].filter(Boolean).join(' · '));
    doc.moveDown(1);

    doc.fillColor('#000').fontSize(16).text('Voucher de alojamento', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#333')
      .text(`Localizador: ${locator}`)
      .text(`Reserva: ${reservation.id}`)
      .text(`Data de emissão: ${new Date().toISOString().slice(0, 10)}`);
    doc.moveDown(1);

    doc.fillColor('#000').fontSize(13).text(offer.hotel || 'Alojamento');
    doc.fontSize(10).fillColor('#333')
      .text([offer.destination, offer.country].filter(Boolean).join(', '))
      .text(offer.roomName ? `Quarto: ${offer.roomName}` : '')
      .text(offer.board ? `Regime: ${offer.board}` : '');
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#333')
      .text(`Check-in: ${offer.checkin || '-'}`)
      .text(`Check-out: ${offer.checkout || '-'}`)
      .text(offer.nights ? `${offer.nights} noite(s)` : '');
    doc.moveDown(1);

    doc.fillColor('#000').fontSize(12).text('Ocupação');
    doc.fontSize(10).fillColor('#333');
    if (passengers.length) {
      passengers.forEach(p => doc.text(`${[p.name, p.surname].filter(Boolean).join(' ')}`));
    } else {
      doc.text('-');
    }
    doc.moveDown(1);

    const cancellation = offer.nonRefundable
      ? 'Tarifa não reembolsável.'
      : offer.freeCancellationUntil
        ? `Cancelamento grátis até ${offer.freeCancellationUntil}.`
        : 'Consulte as condições de cancelamento na sua reserva.';
    doc.fillColor('#000').fontSize(12).text('Política de cancelamento');
    doc.fontSize(10).fillColor('#333').text(cancellation);
    doc.moveDown(1);

    doc.fillColor('#000').fontSize(12).text('Valor pago');
    doc.fontSize(10).fillColor('#333').text(`${Number(payment.amount || 0).toFixed(2)} €`);
    doc.moveDown(2);

    doc.fontSize(8).fillColor('#888').text('Apresente este voucher (impresso ou digital) no check-in do alojamento.', { align: 'center' });

    doc.end();
  });
}

module.exports = { buildVoucherPdf };
