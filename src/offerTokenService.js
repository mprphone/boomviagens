const OFFER_TOKEN_TTL_MS = 30 * 60 * 1000;

function createOfferTokenService(auth) {
  function payload(offer = {}, extra = {}) {
    return {
      scope: 'offer',
      id: String(offer.id || ''), destination: String(offer.destination || ''), country: String(offer.country || ''),
      hotel: String(offer.hotel || ''), board: String(offer.mealPlanLabel || offer.board || ''), roomName: String(offer.roomName || ''),
      nights: Number(offer.nights || 0), rating: Number(offer.rating || 0), freeCancellation: Boolean(offer.freeCancellation),
      nonRefundable: Boolean(offer.nonRefundable), freeCancellationUntil: offer.freeCancellationUntil || null, image: String(offer.image || ''),
      costPrice: offer.costPrice, finalPrice: offer.finalPrice, operator: offer.operator || null, tourdiez: offer.tourdiez || null,
      hbx: offer.hbx || null, provider: offer.provider || null, productType: offer.productType || null, flight: offer.flight || null,
      components: offer.components || null, origin: offer.origin || '', checkin: offer.checkin || '', checkout: offer.checkout || '',
      adults: Number(offer.adults || 1), children: Number(offer.children || 0), infants: Number(offer.infants || 0),
      childAges: Array.isArray(offer.childAges) ? offer.childAges : [], infantAges: Array.isArray(offer.infantAges) ? offer.infantAges : [],
      resumeReservationId: extra.resumeReservationId || offer.resumeReservationId || null,
      resumeCustomerEmail: extra.resumeCustomerEmail || offer.resumeCustomerEmail || null,
      exp: Date.now() + OFFER_TOKEN_TTL_MS
    };
  }

  function sign(offer, extra) { return auth.sealToken(payload(offer, extra)); }

  function safeFlight(flight = {}) {
    if (!flight || typeof flight !== 'object') return null;
    return {
      carriers: Array.isArray(flight.carriers) ? flight.carriers.slice(0, 4) : [],
      slices: Array.isArray(flight.slices) ? flight.slices.slice(0, 6).map(slice => ({
        origin: slice.origin || '', destination: slice.destination || '', departureAt: slice.departureAt || '', arrivalAt: slice.arrivalAt || '',
        durationMinutes: Number(slice.durationMinutes || 0), stops: Number(slice.stops || 0),
        segments: Array.isArray(slice.segments) ? slice.segments.slice(0, 5).map(segment => ({
          flightNumber: segment.flightNumber || '', operatingCarrier: segment.operatingCarrier || segment.marketingCarrier || '',
          origin: segment.origin || '', destination: segment.destination || '', departureAt: segment.departureAt || '', arrivalAt: segment.arrivalAt || ''
        })) : []
      })) : [],
      conditions: flight.conditions ? { changeBeforeDeparture: flight.conditions.changeBeforeDeparture || null, refundBeforeDeparture: flight.conditions.refundBeforeDeparture || null } : null
    };
  }

  function publicOffer(offer = {}, extra = {}) {
    const safe = { ...offer };
    for (const key of ['costPrice', 'marginRule', 'marginPercent', 'marginValue', 'trace', 'operator', 'provider', 'tourdiez', 'hbx', 'components', 'operatorRefs', 'operatorData', 'targetPrice', 'minimumPrice', 'minimumMarginPercent', 'concessionAvailable', 'net', 'rateKey', 'rateType', 'resumeCustomerEmail', '_paymentSessions']) delete safe[key];
    if (safe.flight) safe.flight = safeFlight(safe.flight);
    safe.offerToken = sign(offer, extra);
    if (extra.resume) safe.resume = extra.resume;
    return safe;
  }

  return { sign, publicOffer, safeFlight, ttlMs: OFFER_TOKEN_TTL_MS };
}

module.exports = createOfferTokenService;
