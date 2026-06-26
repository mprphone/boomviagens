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
    passengers: Array.isArray(body.passengers) ? body.passengers.slice(0, 12).map(passengerPayload) : []
  };
}

function passengerPayload(body = {}) {
  return {
    name: requiredText(body.name, 'Nome do passageiro', 120),
    surname: optionalText(body.surname, 120),
    type: ['ADT', 'CHD', 'INF'].includes(body.type) ? body.type : 'ADT',
    birthdate: optionalText(body.birthdate, 30),
    documentNumber: optionalText(body.documentNumber, 80)
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
