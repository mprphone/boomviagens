const { normalize } = require('../pricing');

const DESTINATIONS = [
  { name: 'Punta Cana', country: 'República Dominicana', iata: 'PUJ', eventCity: 'Punta Cana', lat: 18.5601, lon: -68.3725, icon: '🏝️', aliases: ['dominicana', 'republica dominicana', 'caraibas'] },
  { name: 'Riviera Maya', country: 'México', iata: 'CUN', eventCity: 'Cancún', lat: 20.6296, lon: -87.0739, icon: '🌊', aliases: ['cancun', 'playa del carmen', 'mexico'] },
  { name: 'Cancún', country: 'México', iata: 'CUN', eventCity: 'Cancún', lat: 21.1619, lon: -86.8515, icon: '🌊', aliases: ['cancun'] },
  { name: 'Sal', country: 'Cabo Verde', iata: 'SID', eventCity: 'Santa Maria', lat: 16.6000, lon: -22.9050, icon: '🏖️', aliases: ['cabo verde', 'santa maria'] },
  { name: 'Boa Vista', country: 'Cabo Verde', iata: 'BVC', eventCity: 'Sal Rei', lat: 16.1765, lon: -22.9172, icon: '🏖️', aliases: ['boavista', 'cabo verde'] },
  { name: 'Maldivas', country: 'Maldivas', iata: 'MLE', eventCity: 'Malé', lat: 4.1755, lon: 73.5093, icon: '🌴', aliases: ['male', 'maldives'] },
  { name: 'Disneyland Paris', country: 'França', iata: 'CDG', eventCity: 'Paris', lat: 48.8674, lon: 2.7836, icon: '🎢', aliases: ['disney', 'marne la vallee'] },
  { name: 'Paris', country: 'França', iata: 'CDG', eventCity: 'Paris', lat: 48.8566, lon: 2.3522, icon: '🗼', aliases: [] },
  { name: 'Madeira', country: 'Portugal', iata: 'FNC', eventCity: 'Funchal', lat: 32.6669, lon: -16.9241, icon: '🌋', aliases: ['funchal'] },
  { name: 'Gran Canaria', country: 'Espanha', iata: 'LPA', eventCity: 'Las Palmas de Gran Canaria', lat: 27.9202, lon: -15.5474, icon: '☀️', aliases: ['las palmas', 'canarias'] },
  { name: 'Tenerife', country: 'Espanha', iata: 'TFS', eventCity: 'Santa Cruz de Tenerife', lat: 28.2916, lon: -16.6291, icon: '☀️', aliases: ['canarias'] },
  { name: 'Torremolinos', country: 'Espanha', iata: 'AGP', eventCity: 'Málaga', lat: 36.6218, lon: -4.5003, icon: '🏨', aliases: ['malaga', 'costa del sol'] },
  { name: 'Maiorca', country: 'Espanha', iata: 'PMI', eventCity: 'Palma de Mallorca', lat: 39.6953, lon: 3.0176, icon: '🏖️', aliases: ['mallorca', 'palma'] },
  { name: 'Ibiza', country: 'Espanha', iata: 'IBZ', eventCity: 'Ibiza', lat: 38.9067, lon: 1.4206, icon: '🌅', aliases: [] },
  { name: 'Barcelona', country: 'Espanha', iata: 'BCN', eventCity: 'Barcelona', lat: 41.3874, lon: 2.1686, icon: '🏙️', aliases: [] },
  { name: 'Madrid', country: 'Espanha', iata: 'MAD', eventCity: 'Madrid', lat: 40.4168, lon: -3.7038, icon: '🏙️', aliases: [] },
  { name: 'Roma', country: 'Itália', iata: 'FCO', eventCity: 'Rome', lat: 41.9028, lon: 12.4964, icon: '🏛️', aliases: ['rome'] },
  { name: 'Londres', country: 'Reino Unido', iata: 'LHR', eventCity: 'London', lat: 51.5072, lon: -0.1276, icon: '🎡', aliases: ['london'] },
  { name: 'Nova Iorque', country: 'Estados Unidos', iata: 'JFK', eventCity: 'New York', lat: 40.7128, lon: -74.0060, icon: '🗽', aliases: ['new york', 'nyc'] },
  { name: 'Miami', country: 'Estados Unidos', iata: 'MIA', eventCity: 'Miami', lat: 25.7617, lon: -80.1918, icon: '🌴', aliases: [] },
  { name: 'Dubai', country: 'Emirados Árabes Unidos', iata: 'DXB', eventCity: 'Dubai', lat: 25.2048, lon: 55.2708, icon: '🌇', aliases: [] },
  { name: 'Marrakech', country: 'Marrocos', iata: 'RAK', eventCity: 'Marrakech', lat: 31.6295, lon: -7.9811, icon: '🕌', aliases: ['marraquexe'] },
  { name: 'Atenas', country: 'Grécia', iata: 'ATH', eventCity: 'Athens', lat: 37.9838, lon: 23.7275, icon: '🏛️', aliases: ['athens'] },
  { name: 'Santorini', country: 'Grécia', iata: 'JTR', eventCity: 'Santorini', lat: 36.3932, lon: 25.4615, icon: '🌅', aliases: [] },
  { name: 'São Miguel', country: 'Portugal', iata: 'PDL', eventCity: 'Ponta Delgada', lat: 37.7412, lon: -25.6756, icon: '🌿', aliases: ['acores', 'açores', 'ponta delgada'] }
];

const ORIGINS = {
  lisboa: { name: 'Lisboa', iata: 'LIS' },
  porto: { name: 'Porto', iata: 'OPO' },
  faro: { name: 'Faro', iata: 'FAO' }
};

function resolveDestination(value = '') {
  const q = normalize(value).trim();
  if (!q) return null;
  return DESTINATIONS.find(d => {
    const names = [d.name, d.country, ...(d.aliases || [])].map(normalize);
    return names.some(x => x === q) || names.some(x => x.includes(q) || q.includes(x));
  }) || null;
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
    name: d.name, country: d.country, iata: d.iata, icon: d.icon
  }));
}

module.exports = { DESTINATIONS, resolveDestination, resolveOrigin, suggestDestinations };
