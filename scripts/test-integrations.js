/* Testes rápidos sem consumir quotas externas. */
const assert = require('assert');
const crypto = require('crypto');
const { resolveDestination, resolveOrigin, suggestDestinations } = require('../src/integrations/destinations');
const { signature } = require('../src/integrations/hbxClient');
const { normalizeOffer } = require('../src/integrations/duffelClient');
const { applyMargin, findMarginRule } = require('../src/pricing');
const { searchPayload, validatePassengerForTrip } = require('../src/validation');
const { TravelIntelligenceService } = require('../src/integrations/travelIntelligence');

function testDestinations() {
  assert.equal(resolveDestination('cancun').iata, 'CUN');
  assert.equal(resolveDestination('Punta Cana').iata, 'PUJ');
  assert.equal(resolveOrigin('Porto').iata, 'OPO');
  assert(suggestDestinations('made').some(x => x.name === 'Madeira'));
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


async function testTravelIntelligenceLazyGoogle() {
  const calls = { duffel: 0, weather: 0, events: 0, google: 0 };
  const service = new TravelIntelligenceService({
    duffel: { isConfigured: () => true, mode: () => 'test', searchFlights: async () => { calls.duffel++; return { offers: [] }; } },
    weather: { isConfigured: () => true, currentForDestination: async () => { calls.weather++; return { temperature: 25 }; } },
    ticketmaster: { isConfigured: () => true, searchEvents: async () => { calls.events++; return { events: [] }; } },
    hbx: { configuredSuites: () => ({ hotels: false, activities: false, transfers: false }), mode: 'test' },
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
  await testTravelIntelligenceLazyGoogle();
  console.log('OK - integrações, pricing, passageiros e controlo de custos');
}

run().catch(err => { console.error(err); process.exit(1); });
