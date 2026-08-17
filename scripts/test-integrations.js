/* Testes rápidos sem consumir quotas externas. */
const assert = require('assert');
const crypto = require('crypto');
const { resolveDestination, resolveOrigin, suggestDestinations, destinationMatches } = require('../src/integrations/destinations');
const { HbxClient, signature } = require('../src/integrations/hbxClient');
const { normalizeOffer } = require('../src/integrations/duffelClient');
const { applyMargin, findMarginRule } = require('../src/pricing');
const { searchPayload, validatePassengerForTrip } = require('../src/validation');
const { TravelIntelligenceService } = require('../src/integrations/travelIntelligence');
const { searchOffers } = require('../src/mockOperators');
const { sealToken, openToken } = require('../src/auth');
const { paymentsMode, mockPaymentsAllowed } = require('../src/runtimeConfig');
const { safeStaticPath } = require('../src/staticServer');
const { StripeGatewayAdapter } = require('../src/paymentGatewayAdapters');

function testDestinations() {
  assert.equal(resolveDestination('cancun').iata, 'CUN');
  assert.equal(resolveDestination('Punta Cana').iata, 'PUJ');
  assert.equal(resolveOrigin('Porto').iata, 'OPO');
  assert(suggestDestinations('made').some(x => x.name === 'Madeira'));
  assert.equal(destinationMatches('Paris', 'Disneyland Paris'), false);
  assert.equal(destinationMatches('Atenas', 'Athens'), true);
  assert.equal(resolveDestination('Cabo Verde'), null, 'Destino genérico com várias ilhas deve pedir escolha');
  assert.equal(resolveDestination('Canárias'), null, 'Destino genérico com várias ilhas deve pedir escolha');
  assert.equal(resolveDestination('Caraíbas'), null, 'Região genérica deve mostrar vários destinos, não escolher Punta Cana ao acaso');
  assert(suggestDestinations('caraibas').some(x => x.name === 'Punta Cana'));
  assert(suggestDestinations('caraibas').some(x => x.name === 'Riviera Maya'));
}

function testHbxSignature() {
  const key = 'abc'; const secret = 'xyz'; const ts = 1700000000;
  const expected = crypto.createHash('sha256').update(`${key}${secret}${ts}`).digest('hex');
  assert.equal(signature(key, secret, ts), expected);
}

function testDuffelNormalization() {
  const normalized = normalizeOffer({
    id: 'off_1', total_amount: '123.45', total_currency: 'EUR', live_mode: false,
    slices: [{ duration: 'PT2H10M', segments: [{ marketing_carrier: { iata_code: 'ZZ', name: 'Duffel Airways' }, operating_carrier: { name: 'Duffel Airways' }, marketing_carrier_flight_number: '100', origin: { iata_code: 'LIS' }, destination: { iata_code: 'LHR' }, departing_at: '2026-09-01T08:00:00Z', arriving_at: '2026-09-01T10:10:00Z' }] }]
  });
  assert.equal(normalized.totalAmount, 123.45);
  assert.equal(normalized.slices[0].stops, 0);
  assert.equal(normalized.slices[0].durationMinutes, 130);
  assert(normalized.carriers.includes('Duffel Airways'));
}

function testPricingV2() {
  const rules = [
    { id: 'all', name: 'Geral', match: '*', percent: 12, minimumPercent: 6, min: 0, roundTo: 1, active: true },
    { id: 'hbx', name: 'HBX online', match: '*', operator: 'HBX', channel: 'ONLINE', percent: 15, minimumPercent: 8, min: 0, roundTo: 1, active: true }
  ];
  assert.equal(findMarginRule('Punta Cana', rules, { operator: 'HBX', channel: 'ONLINE' }).id, 'hbx');
  const full = applyMargin(1000, 'Punta Cana', rules, { operator: 'HBX', channel: 'ONLINE' });
  assert.equal(full.finalPrice, 1150);
  assert.equal(full.minimumPrice, 1080);
  const conceded = applyMargin(1000, 'Punta Cana', rules, { operator: 'HBX', channel: 'ONLINE', concessionPercent: 5 });
  assert.equal(conceded.finalPrice, 1100);
  const floored = applyMargin(1000, 'Punta Cana', rules, { operator: 'HBX', channel: 'ONLINE', concessionPercent: 99 });
  assert.equal(floored.finalPrice, 1080);

  const withRebate = applyMargin(1000, 'Punta Cana', [{ ...rules[1], rebatePercent: 2 }], { operator: 'HBX', channel: 'ONLINE', concessionPercent: 7 });
  assert.equal(withRebate.finalPrice, 1080); // mínimo direto continua a mandar
  assert.equal(withRebate.expectedRebateValue, 20);
  assert.equal(withRebate.expectedEconomicMargin, 100);
}

function testPassengerSearchAndValidation() {
  const parsed = searchPayload({ adults: 2, children: 2, childAges: '4,10', infants: 1, infantAges: '1' });
  assert.deepEqual(parsed.childAges, [4, 10]);
  assert.deepEqual(parsed.infantAges, [1]);
  assert.equal(parsed.infants, 1);
  const infant = validatePassengerForTrip({ name:'Bebé', surname:'Teste', birthdate:'2026-01-01', nationality:'Portuguesa', documentType:'PASSPORT', documentNumber:'X1', documentCountry:'Portugal', documentExpiry:'2030-01-01' }, 'INF', '2026-10-01');
  assert.equal(infant.type, 'INF');
}



function testNoCrossDestinationFallback() {
  const athens = searchOffers({ destination: 'Atenas', origin: 'Porto', adults: 2, nights: 7, checkin: '2026-10-18' }, []);
  assert.equal(athens.parsed.destination, 'Atenas');
  assert.equal(athens.results.length, 0, 'Atenas nunca pode cair em Disneyland/Maldivas/Punta Cana demo');
  const athensPrompt = searchOffers({ prompt: 'Quero ir para Atenas em outubro', origin: 'Porto', adults: 2, nights: 7 }, []);
  assert.equal(athensPrompt.parsed.destination, 'Atenas', 'Texto livre também deve resolver Atenas');
  const paris = searchOffers({ destination: 'Paris', origin: 'Porto', adults: 2, nights: 3 }, []);
  assert.equal(paris.parsed.destination, 'Paris', 'Paris não pode ser convertido automaticamente em Disneyland Paris');
  assert.equal(paris.results.length, 0, 'Disneyland Paris demo não pode entrar numa pesquisa de Paris');
}

function testOpaqueBusinessTokens() {
  const sentinel = { scope: 'offer', costPrice: 1234.56, rateKey: 'RATEKEY-SUPER-SECRETA', exp: Date.now() + 60000 };
  const token = sealToken(sentinel);
  assert(token.startsWith('v1.'));
  assert(!token.includes('1234.56'));
  assert(!token.includes('RATEKEY-SUPER-SECRETA'));
  const decodedChunks = token.split('.').slice(1).map(part => {
    try { return Buffer.from(part, 'base64url').toString('utf8'); } catch { return ''; }
  }).join('|');
  assert(!decodedChunks.includes('RATEKEY-SUPER-SECRETA'), 'Token selado não pode revelar rateKey por simples base64');
  assert.deepEqual(openToken(token), sentinel);
  const tokenParts = token.split('.');
  const cipher = tokenParts[2];
  const pos = Math.max(0, Math.floor(cipher.length / 2));
  tokenParts[2] = cipher.slice(0, pos) + (cipher[pos] === 'A' ? 'B' : 'A') + cipher.slice(pos + 1);
  const tampered = tokenParts.join('.');
  assert.equal(openToken(tampered), null, 'Token alterado tem de ser rejeitado');
}


function testStaticPathTraversal() {
  const path = require('path');
  const root = path.resolve('/tmp/boom-public');
  assert.equal(safeStaticPath(root, '/'), path.join(root, 'index.html'));
  assert.equal(safeStaticPath(root, '/css/app.css'), path.join(root, 'css', 'app.css'));
  assert.equal(safeStaticPath(root, '/../public-secret/secret.txt'), null);
  assert.equal(safeStaticPath(root, '/%2e%2e/public-secret/secret.txt'), null);
  assert.equal(safeStaticPath(root, '/%00evil'), null);
}

function testProductionPaymentsFailClosed() {
  const prod = { VERCEL_ENV: 'production', PAYMENTS_MODE: 'mock' };
  assert.equal(paymentsMode(prod), 'disabled');
  assert.equal(mockPaymentsAllowed(prod), false);
  const preview = { VERCEL_ENV: 'preview', PAYMENTS_MODE: 'mock' };
  assert.equal(paymentsMode(preview), 'mock');
  assert.equal(mockPaymentsAllowed(preview), true);
}

async function testHbxOccupancyIncludesInfants() {
  const client = new HbxClient({ HBX_MODE: 'test', HBX_HOTELS_API_KEY: 'key', HBX_HOTELS_SECRET: 'secret' });
  let sentBody = null;
  client.request = async (_suite, _path, options) => { sentBody = options.json; return { data: { hotels: { hotels: [] } } }; };
  await client.availabilityByHotelCodes({ hotelCodes: [123], checkIn: '2026-10-10', checkOut: '2026-10-17', adults: 2, children: 1, infants: 1, childAges: [8], infantAges: [1] });
  assert.equal(sentBody.occupancies[0].children, 2);
  assert.deepEqual(sentBody.occupancies[0].paxes.map(p => p.age), [1, 8]);
  await assert.rejects(() => client.availabilityByHotelCodes({ hotelCodes: [123], checkIn: '2026-10-10', checkOut: '2026-10-17', adults: 2, children: 1, infants: 1, childAges: [8], infantAges: [] }), /idades/i);
}

async function testHbxCheckRateParsing() {
  const client = new HbxClient({ HBX_MODE: 'test', HBX_HOTELS_API_KEY: 'key', HBX_HOTELS_SECRET: 'secret' });
  client.request = async () => ({ data: { hotel: { code: 123, rooms: [{ code: 'DBL', name: 'Double', rates: [{ rateKey: 'new-key', rateType: 'BOOKABLE', net: '501.25', boardCode: 'BB' }] }] } } });
  const rate = await client.checkRate('old-key');
  assert.equal(rate.rateKey, 'new-key');
  assert.equal(rate.net, 501.25);
  assert.equal(rate.hotelCode, '123');
}


async function testStripeDelayedPaymentSafety() {
  const secret = 'whsec_test_audit';
  const adapter = new StripeGatewayAdapter({ STRIPE_WEBHOOK_SECRET: secret });
  const sign = raw => {
    const t = Math.floor(Date.now() / 1000);
    const v1 = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
    return `t=${t},v1=${v1}`;
  };
  const pending = JSON.stringify({ id: 'evt_pending', type: 'checkout.session.completed', livemode: false, data: { object: { payment_status: 'unpaid', amount_total: 10000, currency: 'eur', metadata: { paymentId: 'pay_1' } } } });
  const ignored = await adapter.handleWebhook(pending, { 'stripe-signature': sign(pending) });
  assert.equal(ignored.paymentId, null, 'Checkout completed mas ainda unpaid não pode confirmar pagamento');
  const paid = JSON.stringify({ id: 'evt_async', type: 'checkout.session.async_payment_succeeded', livemode: false, data: { object: { payment_status: 'paid', amount_total: 10000, currency: 'eur', metadata: { paymentId: 'pay_1' } } } });
  const accepted = await adapter.handleWebhook(paid, { 'stripe-signature': sign(paid) });
  assert.equal(accepted.paymentId, 'pay_1');
  assert.equal(accepted.amountMinor, 10000);
}

async function testTravelIntelligenceLazyGoogle() {
  const calls = { duffel: 0, weather: 0, events: 0, google: 0 };
  const service = new TravelIntelligenceService({
    duffel: { isConfigured: () => true, mode: () => 'test', searchFlights: async () => { calls.duffel++; return { offers: [] }; } },
    weather: { isConfigured: () => true, currentForDestination: async () => { calls.weather++; return { temperature: 25 }; } },
    ticketmaster: { isConfigured: () => true, searchEvents: async () => { calls.events++; return { events: [] }; } },
    hbx: { configuredSuites: () => ({ hotels: false, activities: false, transfers: false }), isConfigured: () => false, mode: 'test' },
    googlePlaces: { isConfigured: () => true, isEnabled: () => true, textSearch: async () => { calls.google++; return { places: [] }; } }
  });
  await service.enrichTrip({ destination: 'Punta Cana', origin: 'Porto', checkin: '2026-10-10', checkout: '2026-10-17', adults: 2 }, { exploreGoogle: false });
  assert.equal(calls.duffel, 1);
  assert.equal(calls.weather, 1);
  assert.equal(calls.events, 1);
  assert.equal(calls.google, 0, 'Google não pode correr no enriquecimento normal');
  await service.exploreZone('Punta Cana');
  assert.equal(calls.google, 1, 'Google só corre após ação explícita');
}

async function run() {
  testDestinations();
  testHbxSignature();
  testDuffelNormalization();
  testPricingV2();
  testPassengerSearchAndValidation();
  testNoCrossDestinationFallback();
  testOpaqueBusinessTokens();
  testProductionPaymentsFailClosed();
  testStaticPathTraversal();
  await testHbxOccupancyIncludesInfants();
  await testHbxCheckRateParsing();
  await testStripeDelayedPaymentSafety();
  await testTravelIntelligenceLazyGoogle();
  console.log('OK - integrações, pricing, passageiros e controlo de custos');
}

run().catch(err => { console.error(err); process.exit(1); });
