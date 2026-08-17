const assert = require('assert');
const { resolveDestination, destinationMatches } = require('../src/integrations/destinations');
const { smartParse } = require('../src/mockOperators');
const domain = require('../src/domain');

assert.equal(resolveDestination('Gran Canaria')?.name, 'Gran Canaria');
assert.equal(resolveDestination('Atenas')?.name, 'Atenas');
assert.equal(resolveDestination('Paris')?.name, 'Paris');
assert.equal(resolveDestination('Disneyland Paris')?.name, 'Disneyland Paris');
assert.equal(destinationMatches('Gran Canaria', 'Disneyland Paris'), false);
assert.equal(destinationMatches('Paris', 'Disneyland Paris'), false);
assert.equal(destinationMatches('Atenas', 'Athens'), true);

const hotel = smartParse({ searchType:'HOTEL', destination:'Atenas', origin:'Porto', checkin:'2026-10-18', checkout:'2026-10-25', adults:2, children:0, infants:0, nights:7 });
assert.equal(hotel.searchType, 'HOTEL');
assert.equal(hotel.nights, 7);
const flight = smartParse({ searchType:'FLIGHT', destination:'Gran Canaria', origin:'Lisboa', checkin:'2026-09-27', checkout:'2026-10-04', adults:2, children:0, infants:0, nights:7 });
assert.equal(flight.searchType, 'FLIGHT');
assert.equal(flight.checkout, '2026-10-04');
assert(domain.SERVICE_TYPES.includes('VOO'));
assert(domain.SERVICE_TYPES.includes('TOUR'));
assert(domain.SERVICE_TYPES.includes('TRANSFER'));
assert(!domain.SERVICE_TYPES.includes('ATIVIDADE'));

console.log('OK - V4 operacional: destinos estritos, modos de pesquisa, datas e tipos de serviço');
