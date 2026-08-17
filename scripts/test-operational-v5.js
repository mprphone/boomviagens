const fs = require('fs');
const path = require('path');

function assert(condition, message) { if (!condition) throw new Error(message); }
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const hero = fs.readFileSync(path.join(root, 'public/js/heroSearch.js'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'src/routes/publicRoutes.js'), 'utf8');
const duffel = fs.readFileSync(path.join(root, 'src/integrations/duffelClient.js'), 'utf8');

assert(html.includes('data-trip-type="MULTI_CITY"'), 'UI multi-cidade em falta');
assert(html.includes('flightOriginIata') && html.includes('flightDestinationIata'), 'Campos IATA globais em falta');
assert(html.includes('multiCitySlicesInput'), 'Payload multi-cidade em falta');
assert(hero.includes('/api/airports/suggest'), 'Autocomplete mundial não ligado');
assert(hero.includes('readMultiCityRows'), 'Leitura multi-cidade em falta');
assert(routes.includes("router.get('/api/airports/suggest'"), 'Endpoint de aeroportos em falta');
assert(routes.includes("tripType === 'MULTI_CITY'"), 'Backend multi-cidade em falta');
assert(routes.includes('rawDestinationIata'), 'Destino dinâmico global para hotel/pacote em falta');
assert(duffel.includes('async suggestPlaces'), 'Duffel Places em falta');
assert(duffel.includes('async searchFlightsMulti'), 'Duffel multi-cidade em falta');
assert(!html.includes('✈️ + 🏨 Pacotes'), 'UI antiga com emojis grandes ainda presente');
console.log('OK - V5 global: aeroportos mundiais, só ida/ida-volta/multi-cidade e pesquisa compacta');
