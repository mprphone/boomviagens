const { normalize } = require('../pricing');

const DESTINATIONS = [
  { name: 'Punta Cana', country: 'República Dominicana', countryCode: 'DO', iata: 'PUJ', hbxCode: 'PUJ', eventCity: 'Punta Cana', lat: 18.5601, lon: -68.3725, icon: '🏝️', aliases: ['dominicana', 'republica dominicana', 'caraibas', 'caribe'] },
  { name: 'Riviera Maya', country: 'México', countryCode: 'MX', iata: 'CUN', hbxCode: 'CUN', eventCity: 'Cancún', lat: 20.6296, lon: -87.0739, icon: '🌊', aliases: ['cancun', 'playa del carmen', 'mexico', 'caraibas', 'caribe'] },
  { name: 'Cancún', country: 'México', countryCode: 'MX', iata: 'CUN', hbxCode: 'CUN', eventCity: 'Cancún', lat: 21.1619, lon: -86.8515, icon: '🌊', aliases: ['cancun', 'mexico'] },
  { name: 'Sal', country: 'Cabo Verde', countryCode: 'CV', iata: 'SID', hbxCode: 'SID', eventCity: 'Santa Maria', lat: 16.6000, lon: -22.9050, icon: '🏖️', aliases: ['cabo verde', 'santa maria'] },
  { name: 'Boa Vista', country: 'Cabo Verde', countryCode: 'CV', iata: 'BVC', hbxCode: 'BVC', eventCity: 'Sal Rei', lat: 16.1765, lon: -22.9172, icon: '🏖️', aliases: ['boavista', 'cabo verde'] },
  { name: 'Maldivas', country: 'Maldivas', countryCode: 'MV', iata: 'MLE', hbxCode: 'MLE', eventCity: 'Malé', lat: 4.1755, lon: 73.5093, icon: '🌴', aliases: ['male', 'maldives'] },
  { name: 'Disneyland Paris', country: 'França', countryCode: 'FR', iata: 'CDG', hbxCode: 'PAR', eventCity: 'Paris', lat: 48.8674, lon: 2.7836, icon: '🎢', aliases: ['disney', 'marne la vallee'] },
  { name: 'Paris', country: 'França', countryCode: 'FR', iata: 'CDG', hbxCode: 'PAR', eventCity: 'Paris', lat: 48.8566, lon: 2.3522, icon: '🗼', aliases: [] },
  { name: 'Madeira', country: 'Portugal', countryCode: 'PT', iata: 'FNC', hbxCode: 'FNC', eventCity: 'Funchal', lat: 32.6669, lon: -16.9241, icon: '🌋', aliases: ['funchal'] },
  { name: 'Gran Canaria', country: 'Espanha', countryCode: 'ES', iata: 'LPA', hbxCode: 'LPA', eventCity: 'Las Palmas de Gran Canaria', lat: 27.9202, lon: -15.5474, icon: '☀️', aliases: ['las palmas', 'canarias'] },
  { name: 'Tenerife', country: 'Espanha', countryCode: 'ES', iata: 'TFS', hbxCode: 'TFS', eventCity: 'Santa Cruz de Tenerife', lat: 28.2916, lon: -16.6291, icon: '☀️', aliases: ['canarias'] },
  { name: 'Torremolinos', country: 'Espanha', countryCode: 'ES', iata: 'AGP', hbxCode: 'AGP', eventCity: 'Málaga', lat: 36.6218, lon: -4.5003, icon: '🏨', aliases: ['malaga', 'costa del sol'] },
  { name: 'Maiorca', country: 'Espanha', countryCode: 'ES', iata: 'PMI', hbxCode: 'PMI', eventCity: 'Palma de Mallorca', lat: 39.6953, lon: 3.0176, icon: '🏖️', aliases: ['mallorca', 'palma'] },
  { name: 'Ibiza', country: 'Espanha', countryCode: 'ES', iata: 'IBZ', hbxCode: 'IBZ', eventCity: 'Ibiza', lat: 38.9067, lon: 1.4206, icon: '🌅', aliases: [] },
  { name: 'Barcelona', country: 'Espanha', countryCode: 'ES', iata: 'BCN', hbxCode: 'BCN', eventCity: 'Barcelona', lat: 41.3874, lon: 2.1686, icon: '🏙️', aliases: [] },
  { name: 'Madrid', country: 'Espanha', countryCode: 'ES', iata: 'MAD', hbxCode: 'MAD', eventCity: 'Madrid', lat: 40.4168, lon: -3.7038, icon: '🏙️', aliases: [] },
  { name: 'Roma', country: 'Itália', countryCode: 'IT', iata: 'FCO', hbxCode: 'ROM', eventCity: 'Rome', lat: 41.9028, lon: 12.4964, icon: '🏛️', aliases: ['rome'] },
  { name: 'Londres', country: 'Reino Unido', countryCode: 'GB', iata: 'LHR', hbxCode: 'LON', eventCity: 'London', lat: 51.5072, lon: -0.1276, icon: '🎡', aliases: ['london'] },
  { name: 'Nova Iorque', country: 'Estados Unidos', countryCode: 'US', iata: 'JFK', hbxCode: 'NYC', eventCity: 'New York', lat: 40.7128, lon: -74.0060, icon: '🗽', aliases: ['new york', 'nyc'] },
  { name: 'Miami', country: 'Estados Unidos', countryCode: 'US', iata: 'MIA', hbxCode: 'MIA', eventCity: 'Miami', lat: 25.7617, lon: -80.1918, icon: '🌴', aliases: [] },
  { name: 'Dubai', country: 'Emirados Árabes Unidos', countryCode: 'AE', iata: 'DXB', hbxCode: 'DXB', eventCity: 'Dubai', lat: 25.2048, lon: 55.2708, icon: '🌇', aliases: [] },
  { name: 'Marrakech', country: 'Marrocos', countryCode: 'MA', iata: 'RAK', hbxCode: 'RAK', eventCity: 'Marrakech', lat: 31.6295, lon: -7.9811, icon: '🕌', aliases: ['marraquexe'] },
  { name: 'Atenas', country: 'Grécia', countryCode: 'GR', iata: 'ATH', hbxCode: 'ATH', eventCity: 'Athens', lat: 37.9838, lon: 23.7275, icon: '🏛️', aliases: ['athens'] },
  { name: 'Santorini', country: 'Grécia', countryCode: 'GR', iata: 'JTR', hbxCode: 'JTR', eventCity: 'Santorini', lat: 36.3932, lon: 25.4615, icon: '🌅', aliases: [] },
  { name: 'São Miguel', country: 'Portugal', countryCode: 'PT', iata: 'PDL', hbxCode: 'PDL', eventCity: 'Ponta Delgada', lat: 37.7412, lon: -25.6756, icon: '🌿', aliases: ['acores', 'açores', 'ponta delgada'] },
  { name: 'Lisboa', country: 'Portugal', countryCode: 'PT', iata: 'LIS', hbxCode: 'LIS', eventCity: 'Lisbon', lat: 38.7223, lon: -9.1393, icon: '🎶', aliases: ['lisbon'] },
  { name: 'Porto', country: 'Portugal', countryCode: 'PT', iata: 'OPO', hbxCode: 'OPO', eventCity: 'Porto', lat: 41.1579, lon: -8.6291, icon: '🍷', aliases: ['oporto'] }
];

const ORIGINS = {
  lisboa: { name: 'Lisboa', iata: 'LIS' },
  porto: { name: 'Porto', iata: 'OPO' },
  faro: { name: 'Faro', iata: 'FAO' }
};

function resolveDestination(value = '') {
  const q = normalize(value).trim();
  if (!q) return null;

  // Alguns termos são deliberadamente genéricos (ex.: "Cabo Verde" pode
  // significar Sal ou Boa Vista; "Canárias" pode ser Gran Canaria ou
  // Tenerife). Nunca escolhemos a primeira entrada por acaso: nesses casos
  // a UI deve mostrar sugestões e o cliente escolhe o destino concreto.
  const exactAliasMatches = DESTINATIONS.filter(d => (d.aliases || []).map(normalize).includes(q));
  const exactName = DESTINATIONS.find(d => normalize(d.name) === q);
  if (!exactName && exactAliasMatches.length > 1) return null;
  const countryMatches = DESTINATIONS.filter(d => normalize(d.country) === q);
  if (!exactName && !exactAliasMatches.length && countryMatches.length > 1) return null;

  const scored = DESTINATIONS.map((d, index) => {
    const name = normalize(d.name);
    const country = normalize(d.country);
    const aliases = (d.aliases || []).map(normalize);
    let score = 0;
    if (name === q) score = 100;
    else if (aliases.includes(q)) score = 95;
    else if (q.includes(name)) score = 90; // ex.: "quero ir para atenas"
    else if (aliases.some(a => a && q.includes(a))) score = 85;
    else if (name.startsWith(q)) score = 75;
    else if (aliases.some(a => a.startsWith(q))) score = 70;
    else if (name.includes(q)) score = 55;
    else if (aliases.some(a => a.includes(q))) score = 50;
    else if (country === q) score = 35;
    return { d, score, index };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  return scored[0]?.d || null;
}

// Comparação estrita para inventário. Nunca usar substring simples aqui:
// "Paris" é substring de "Disneyland Paris" mas são produtos/destinos
// diferentes. Quando ambos os textos são reconhecidos pelo catálogo,
// comparamos o destino canónico; caso contrário aceitamos apenas igualdade
// textual normalizada.
function destinationMatches(searched = '', found = '') {
  const a = normalize(searched).trim();
  const b = normalize(found).trim();
  if (!a || !b) return false;
  if (a === b) return true;
  const left = resolveDestination(searched);
  const right = resolveDestination(found);
  if (!left || !right) return false;
  return normalize(left.name) === normalize(right.name);
}

function resolveOrigin(value = '') {
  const q = normalize(value).trim();
  return ORIGINS[q] || (q && /^[a-z]{3}$/i.test(value) ? { name: value.toUpperCase(), iata: value.toUpperCase() } : null);
}

function suggestDestinations(query = '', limit = 10) {
  const q = normalize(query).trim();
  const scored = DESTINATIONS.map(d => {
    const hay = [d.name, d.country, ...(d.aliases || [])].map(normalize);
    let score = q ? 0 : 1;
    if (q && normalize(d.name).startsWith(q)) score = 5;
    else if (q && hay.some(x => x.startsWith(q))) score = 4;
    else if (q && hay.some(x => x.includes(q))) score = 3;
    return { d, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.d.name.localeCompare(b.d.name, 'pt'));
  return scored.slice(0, Math.max(1, Math.min(20, Number(limit) || 10))).map(({ d }) => ({
    name: d.name, country: d.country, iata: d.iata, hbxCode: d.hbxCode, icon: d.icon
  }));
}

module.exports = { DESTINATIONS, resolveDestination, resolveOrigin, suggestDestinations, destinationMatches };
