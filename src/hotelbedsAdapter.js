const { OperatorAdapter } = require('./operatorAdapters');
const { ageOnDate } = require('./validation');

const PRICE_TOLERANCE = 0.02;
const pricesDiffer = (a, b, tolerance = PRICE_TOLERANCE) =>
  !Number.isFinite(Number(a)) || !Number.isFinite(Number(b)) || Math.abs(Number(a) - Number(b)) > tolerance;

/**
 * Adapter para hoteis HBX (Hotelbeds) puros - unico fornecedor com uma
 * integracao de pesquisa/tarifas real (src/integrations/hbxClient.js), mas
 * que nunca teve confirm() automatico ate agora (ver docs/OPERATOR_ADAPTERS.md
 * e src/paymentConfirmation.js). Segue a mesma filosofia de seguranca da
 * TourDiezAdapter: nunca inventa um localizador, so needsHumanReview:false
 * quando a Hotelbeds confirma mesmo a reserva.
 */
class HotelbedsAdapter extends OperatorAdapter {
  constructor(hbx) {
    super('HBX Hotels');
    this.hbx = hbx;
  }

  isConfigured() {
    return Boolean(this.hbx?.isConfigured?.('hotels'));
  }

  // So ofertas 100% hotel HBX (sem voo/transfer/atividade anexados) sao
  // elegiveis para confirmacao automatica - o trip-builder pode anexar um
  // transfer/atividade a uma oferta HOTEL sem mudar offer.operator, por
  // isso este portao nunca pode depender so do nome do operador.
  hotelBookingContext(offer = {}) {
    const components = offer.components;
    if (components) {
      if (components.flight || components.transfer || (Array.isArray(components.activities) && components.activities.length)) {
        return { ok: false, reason: 'Oferta inclui outros componentes (voo/transfer/atividade) além do hotel; confirmação automática não suportada.' };
      }
      const hotel = components.hotel;
      if (!hotel?.rateKey) return { ok: false, reason: 'Oferta sem componente de hotel HBX.' };
      return { ok: true, rateKey: hotel.rateKey, expectedNet: Number(hotel.costPrice || 0) };
    }
    if (!offer.hbx?.rateKey) return { ok: false, reason: 'Oferta sem rateKey HBX.' };
    return { ok: true, rateKey: offer.hbx.rateKey, expectedNet: Number(offer.costPrice || 0) };
  }

  holderFromReservation(reservation) {
    const first = reservation.passengers?.[0];
    return { name: first?.name || reservation.customer?.name || 'Cliente', surname: first?.surname || '' };
  }

  paxesFromPassengers(passengers = [], checkin) {
    return passengers.map(p => ({
      type: p.type === 'ADT' ? 'AD' : 'CH',
      age: p.type === 'ADT' ? undefined : ageOnDate(p.birthdate, checkin) ?? undefined,
      name: p.name,
      surname: p.surname
    }));
  }

  async value({ offer, reservation }) {
    const context = this.hotelBookingContext(offer);
    if (!context.ok) {
      return {
        ok: true, operator: this.name, offerId: offer?.id,
        priceStillValid: true, availabilityStillValid: true, needsHumanReview: true,
        raw: { skipped: true, reason: context.reason }
      };
    }
    let fresh;
    try {
      fresh = await this.hbx.checkRate(context.rateKey);
    } catch (err) {
      return {
        ok: false, operator: this.name, offerId: offer?.id,
        priceStillValid: false, availabilityStillValid: false, needsHumanReview: true,
        raw: { reason: err.message, code: err.code }
      };
    }
    const priceStillValid = !pricesDiffer(fresh.net, context.expectedNet);
    return {
      ok: true, operator: this.name, offerId: offer?.id,
      priceStillValid, availabilityStillValid: true,
      needsHumanReview: !priceStillValid,
      raw: fresh
    };
  }

  async confirm({ reservation, payment }) {
    // Idempotente - protege contra reprocessamento do mesmo webhook e
    // contra um clique manual de "aprovar" depois de ja ter confirmado
    // sozinho.
    if (reservation.operatorLocator) {
      return { ok: true, operator: this.name, locator: reservation.operatorLocator, needsHumanReview: false, raw: { idempotent: true } };
    }
    const offer = reservation.offer || {};
    const context = this.hotelBookingContext(offer);
    if (!context.ok) {
      return { ok: false, operator: this.name, locator: null, needsHumanReview: true, raw: { reason: context.reason } };
    }
    let fresh;
    try {
      fresh = await this.hbx.checkRate(context.rateKey);
    } catch (err) {
      return { ok: false, operator: this.name, locator: null, needsHumanReview: true, raw: { reason: err.message, code: err.code } };
    }
    if (pricesDiffer(fresh.net, context.expectedNet)) {
      return { ok: false, operator: this.name, locator: null, needsHumanReview: true, raw: { reason: 'Preço HBX mudou entre o pagamento e a confirmação.', latestNet: fresh.net, expectedNet: context.expectedNet } };
    }

    const holder = this.holderFromReservation(reservation);
    const paxes = this.paxesFromPassengers(reservation.passengers, offer.checkin);
    let raw;
    try {
      raw = await this.hbx.createBooking({ rateKey: fresh.rateKey, holder, paxes, clientReference: reservation.id });
    } catch (err) {
      if (err.code === 'UPSTREAM_TIMEOUT') {
        return {
          ok: false, operator: this.name, locator: null, needsHumanReview: true,
          raw: { reason: 'TIMEOUT_AMBIGUOUS', clientReference: reservation.id, note: 'Verificar manualmente no HBX (por clientReference) se a reserva foi criada antes de qualquer nova tentativa.' }
        };
      }
      return { ok: false, operator: this.name, locator: null, needsHumanReview: true, raw: { reason: err.message, status: err.status } };
    }

    const status = String(raw?.booking?.status || '').toUpperCase();
    const locator = raw?.booking?.reference || '';
    if (locator && status === 'CONFIRMED') {
      return { ok: true, operator: this.name, locator, needsHumanReview: false, raw };
    }
    // A Hotelbeds aceitou o pedido mas nao garantiu o quarto (ex.: "ON
    // REQUEST"), ou devolveu algo inesperado - guarda o localizador se
    // existir (pode ja haver uma reserva real do lado deles) mas nunca
    // afirma "confirmado" sem ser mesmo verdade.
    return { ok: true, operator: this.name, locator: locator || null, needsHumanReview: true, raw };
  }

  async cancel(params = {}) {
    return this.hbx.cancelBooking(params.reference);
  }
}

module.exports = { HotelbedsAdapter };
