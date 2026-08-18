function createOfferRevalidation({ duffel, hbx, applyMargin, env = process.env }) {
  const pricesDiffer = (a, b, tolerance = 0.02) => !Number.isFinite(Number(a)) || !Number.isFinite(Number(b)) || Math.abs(Number(a) - Number(b)) > tolerance;

  async function revalidate(inputOffer, margins, { allowPriceChange = false, forceHotelCheck = false } = {}) {
    const offer = JSON.parse(JSON.stringify(inputOffer || {}));
    const components = offer.components && typeof offer.components === 'object' ? offer.components : null;
    const destinationName = String(offer.destination || 'Viagem');
    const targetCurrency = String(env.CURRENCY || 'EUR').toUpperCase();
    const changes = [];

    if (components?.flight?.offerId) {
      if (!duffel?.isConfigured()) throw Object.assign(new Error('Não foi possível revalidar o voo neste momento.'), { code: 'SUPPLIER_REVALIDATION_UNAVAILABLE' });
      const latest = await duffel.getOffer(components.flight.offerId);
      if (String(latest.totalCurrency || '').toUpperCase() !== targetCurrency) throw Object.assign(new Error('A moeda da oferta de voo mudou.'), { code: 'SUPPLIER_PRICE_CHANGED' });
      const pricing = applyMargin(latest.totalAmount, destinationName, margins, { operator: 'Duffel', channel: 'ONLINE', productType: 'VOO' });
      if (pricesDiffer(pricing.finalPrice, components.flight.finalPrice)) {
        if (!allowPriceChange) throw Object.assign(new Error(`O preço do voo foi atualizado para ${Number(pricing.finalPrice).toFixed(2)} €.`), { code: 'SUPPLIER_PRICE_CHANGED', latestPrice: pricing.finalPrice });
        changes.push({ component: 'flight', previousPrice: Number(components.flight.finalPrice), latestPrice: Number(pricing.finalPrice) });
      }
      components.flight = { ...components.flight, costPrice: Number(pricing.costPrice), finalPrice: Number(pricing.finalPrice), offer: latest };
      offer.flight = latest;
    }

    const hotelComponent = components?.hotel || (offer.hbx?.rateKey ? {
      provider: 'HBX', hotelCode: offer.hbx.hotelCode || '', giataCode: offer.hbx.giataCode || '', rateKey: offer.hbx.rateKey,
      rateType: offer.hbx.rateType || '', roomCode: offer.hbx.roomCode || '', costPrice: Number(offer.costPrice || 0), finalPrice: Number(offer.finalPrice || 0)
    } : null);
    const hbxHotel = hotelComponent?.rateKey && (offer.hbx?.rateKey || /(?:hbx|hotelbeds)/i.test(String(hotelComponent.provider || '')));
    if (hbxHotel && (forceHotelCheck || String(hotelComponent.rateType || '').toUpperCase() === 'RECHECK')) {
      if (!hbx?.isConfigured('hotels')) throw Object.assign(new Error('Não foi possível revalidar o hotel neste momento.'), { code: 'SUPPLIER_REVALIDATION_UNAVAILABLE' });
      const latest = await hbx.checkRate(hotelComponent.rateKey);
      const pricing = applyMargin(latest.net, destinationName, margins, { operator: 'HBX Hotels', channel: 'ONLINE', productType: 'HOTEL' });
      if (pricesDiffer(pricing.finalPrice, hotelComponent.finalPrice)) {
        if (!allowPriceChange) throw Object.assign(new Error(`O preço do hotel foi atualizado para ${Number(pricing.finalPrice).toFixed(2)} €.`), { code: 'SUPPLIER_PRICE_CHANGED', latestPrice: pricing.finalPrice });
        changes.push({ component: 'hotel', previousPrice: Number(hotelComponent.finalPrice), latestPrice: Number(pricing.finalPrice) });
      }
      const updated = { ...hotelComponent, rateKey: latest.rateKey, rateType: latest.rateType || hotelComponent.rateType, roomCode: latest.roomCode || hotelComponent.roomCode, costPrice: Number(pricing.costPrice), finalPrice: Number(pricing.finalPrice) };
      if (components) components.hotel = updated;
      else { offer.costPrice = Number(pricing.costPrice); offer.finalPrice = Number(pricing.finalPrice); }
      offer.hbx = { ...(offer.hbx || {}), rateKey: updated.rateKey, rateType: updated.rateType, roomCode: updated.roomCode };
    }

    if (components) {
      const parts = [components.hotel, components.flight, components.transfer, ...(Array.isArray(components.activities) ? components.activities : [])].filter(Boolean);
      const cost = Number(parts.reduce((sum, part) => sum + Number(part.costPrice || 0), 0).toFixed(2));
      const sale = Number(parts.reduce((sum, part) => sum + Number(part.finalPrice || 0), 0).toFixed(2));
      if (!(sale > 0) || sale < cost) throw new Error('Não foi possível validar o total atual da viagem.');
      offer.costPrice = cost; offer.finalPrice = sale; offer.components = components;
    }
    return { offer, changes, checkedAt: new Date().toISOString() };
  }

  return { revalidate };
}

module.exports = createOfferRevalidation;
