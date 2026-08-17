function cleanText(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function optionalText(value, max = 500) {
  const cleaned = cleanText(value, max);
  return cleaned || '';
}

function requiredText(value, field, max = 500) {
  const cleaned = cleanText(value, max);
  if (!cleaned) throw new Error(`${field} obrigatorio`);
  return cleaned;
}

function numberInRange(value, field, min, max, fallback) {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${field} invalido`);
  return n;
}

function email(value, required = true) {
  const cleaned = cleanText(value, 254).toLowerCase();
  if (!cleaned && !required) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) throw new Error('Email invalido');
  return cleaned;
}

function phone(value) {
  const cleaned = optionalText(value, 40);
  if (cleaned && !/^[+\d\s().-]{6,40}$/.test(cleaned)) throw new Error('Telefone invalido');
  return cleaned;
}

// Digito de controlo do NIF portugues: soma ponderada dos primeiros 8
// digitos (peso 9..2), resto da divisao por 11 - resto<2 da digito 0,
// caso contrario digito = 11-resto. So aceita o formato PT (9 digitos);
// NIFs estrangeiros nao tem este algoritmo e ficam de fora por agora.
function isValidNif(digits) {
  if (!/^\d{9}$/.test(digits)) return false;
  const d = digits.split('').map(Number);
  const sum = d.slice(0, 8).reduce((acc, digit, i) => acc + digit * (9 - i), 0);
  const remainder = sum % 11;
  const expected = remainder < 2 ? 0 : 11 - remainder;
  return expected === d[8];
}

function nif(value) {
  const cleaned = optionalText(value, 9).replace(/\D/g, '');
  if (cleaned && !isValidNif(cleaned)) throw new Error('NIF invalido');
  return cleaned;
}

function parseAgeList(value, count, min, max, fallback) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  const parsed = raw.map(Number).filter(Number.isFinite).map(v => Math.max(min, Math.min(max, Math.round(v))));
  return Array.from({ length: count }, (_, i) => Number.isFinite(parsed[i]) ? parsed[i] : fallback);
}

function searchPayload(body = {}) {
  const adults = numberInRange(body.adults, 'Adultos', 1, 12, 2);
  const children = numberInRange(body.children, 'Criancas', 0, 12, 0);
  const infants = numberInRange(body.infants, 'Bebes', 0, 8, 0);
  return {
    prompt: optionalText(body.prompt, 1000),
    destination: optionalText(body.destination, 120),
    origin: optionalText(body.origin, 80),
    checkin: optionalText(body.checkin, 30),
    checkout: optionalText(body.checkout, 30),
    searchType: ['PACKAGE','HOTEL','FLIGHT','EXPERIENCE','CRUISE'].includes(String(body.searchType || '').toUpperCase()) ? String(body.searchType).toUpperCase() : 'PACKAGE',
    nights: numberInRange(body.nights, 'Noites', 1, 60, 7),
    adults,
    children,
    infants,
    childAges: parseAgeList(body.childAges, children, 2, 11, 8),
    infantAges: parseAgeList(body.infantAges, infants, 0, 1, 1),
    budget: numberInRange(body.budget, 'Orcamento', 1, 100000, 2500),
    name: optionalText(body.name, 120),
    email: email(body.email || 'cliente@exemplo.pt', false),
    source: optionalText(body.source || 'site', 80)
  };
}

const TRAVEL_SCOPES = ['LAZER', 'NEGOCIOS', 'AMBOS'];

function customerPayload(body = {}) {
  return {
    name: requiredText(body.name || 'Cliente', 'Nome', 120),
    email: email(body.email),
    phone: phone(body.phone),
    phone2: phone(body.phone2),
    nif: nif(body.nif),
    address: optionalText(body.address, 200),
    postalCode: optionalText(body.postalCode, 20),
    city: optionalText(body.city, 100),
    birthdate: optionalText(body.birthdate, 30),
    travelScope: TRAVEL_SCOPES.includes(body.travelScope) ? body.travelScope : '',
    passengers: Array.isArray(body.passengers) ? body.passengers.slice(0, 12).map(passengerPayload) : []
  };
}

function passengerPayload(body = {}) {
  return {
    name: requiredText(body.name, 'Nome do passageiro', 120),
    surname: optionalText(body.surname, 120),
    type: ['ADT', 'CHD', 'INF'].includes(body.type) ? body.type : 'ADT',
    birthdate: optionalText(body.birthdate, 30),
    gender: ['M', 'F'].includes(body.gender) ? body.gender : '',
    nationality: optionalText(body.nationality, 60),
    documentType: ['CC', 'PASSPORT'].includes(body.documentType) ? body.documentType : '',
    documentNumber: optionalText(body.documentNumber, 80),
    documentCountry: optionalText(body.documentCountry, 60),
    documentExpiry: optionalText(body.documentExpiry, 30)
  };
}


function ageOnDate(birthdate, isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(birthdate || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ''))) return null;
  const b = new Date(`${birthdate}T00:00:00Z`);
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(b.getTime()) || Number.isNaN(d.getTime()) || b > d) return null;
  let age = d.getUTCFullYear() - b.getUTCFullYear();
  if (d.getUTCMonth() < b.getUTCMonth() || (d.getUTCMonth() === b.getUTCMonth() && d.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

function validatePassengerForTrip(body = {}, expectedType = 'ADT', returnDate = '') {
  const p = passengerPayload(body);
  p.surname = requiredText(body.surname, 'Apelido do passageiro', 120);
  p.birthdate = requiredText(body.birthdate, 'Data de nascimento', 30);
  p.nationality = requiredText(body.nationality, 'Nacionalidade', 60);
  p.documentType = ['CC', 'PASSPORT'].includes(body.documentType) ? body.documentType : (() => { throw new Error('Tipo de documento obrigatorio'); })();
  p.documentNumber = requiredText(body.documentNumber, 'Numero do documento', 80);
  p.documentCountry = requiredText(body.documentCountry, 'Pais emissor do documento', 60);
  p.documentExpiry = requiredText(body.documentExpiry, 'Validade do documento', 30);
  p.type = expectedType;
  const age = ageOnDate(p.birthdate, returnDate);
  if (age === null || age > 110) throw new Error('Data de nascimento do passageiro invalida');
  if (expectedType === 'ADT' && age < 12) throw new Error('Passageiro adulto com idade inferior a 12 anos na data da viagem');
  if (expectedType === 'CHD' && age >= 12) throw new Error('Passageiro crianca tera 12 ou mais anos na data da viagem');
  if (expectedType === 'CHD' && age < 2) throw new Error('Passageiro com menos de 2 anos deve ser pesquisado como bebe');
  if (expectedType === 'INF' && age >= 2) throw new Error('Passageiro bebe tera 2 ou mais anos na data da viagem e deve ser pesquisado como crianca');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.documentExpiry)) throw new Error('Validade do documento invalida');
  const expiry = new Date(`${p.documentExpiry}T00:00:00Z`);
  const ret = new Date(`${returnDate}T00:00:00Z`);
  if (Number.isNaN(expiry.getTime()) || expiry < ret) throw new Error('Documento caduca antes do regresso da viagem');
  return p;
}

function password(value) {
  const cleaned = String(value || '');
  if (cleaned.length < 8) throw new Error('Password deve ter pelo menos 8 caracteres');
  return cleaned;
}

function paymentMethod(value) {
  const allowed = ['MB WAY', 'Referencia Multibanco', 'Referência Multibanco', 'Cartao', 'Cartão'];
  const cleaned = cleanText(value || 'MB WAY', 60);
  if (!allowed.includes(cleaned)) throw new Error('Metodo de pagamento invalido');
  return cleaned;
}

module.exports = {
  cleanText,
  optionalText,
  requiredText,
  numberInRange,
  email,
  phone,
  password,
  searchPayload,
  customerPayload,
  passengerPayload,
  validatePassengerForTrip,
  ageOnDate,
  paymentMethod
};
