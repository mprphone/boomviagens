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

function searchPayload(body = {}) {
  return {
    prompt: optionalText(body.prompt, 1000),
    destination: optionalText(body.destination, 120),
    origin: optionalText(body.origin, 80),
    checkin: optionalText(body.checkin, 30),
    nights: numberInRange(body.nights, 'Noites', 1, 60, 7),
    adults: numberInRange(body.adults, 'Adultos', 1, 12, 2),
    children: numberInRange(body.children, 'Criancas', 0, 12, 0),
    budget: numberInRange(body.budget, 'Orcamento', 1, 100000, 2500),
    name: optionalText(body.name, 120),
    email: email(body.email || 'cliente@exemplo.pt', false),
    source: optionalText(body.source || 'site', 80)
  };
}

function customerPayload(body = {}) {
  return {
    name: requiredText(body.name || 'Cliente', 'Nome', 120),
    email: email(body.email),
    phone: phone(body.phone),
    nif: nif(body.nif),
    address: optionalText(body.address, 200),
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
  searchPayload,
  customerPayload,
  passengerPayload,
  paymentMethod
};
