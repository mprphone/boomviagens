// Helpers de dominio partilhados por varias rotas (nao dependem de
// req/res nem de nenhum backend de armazenamento especifico).

const crypto = require('crypto');

const RESERVATION_STATUSES = ['NEW_LEAD', 'PROPOSAL_SENT', 'PENDING_PAYMENT', 'PAYMENT_RECEIVED', 'IN_VALIDATION', 'HUMAN_REVIEW', 'CONFIRMED', 'CANCELLED', 'OPERATOR_ERROR'];
const LEAD_STAGES = ['NOVA', 'EM_CONSULTA', 'PROPOSTA_ENVIADA', 'RESERVADO', 'PERDIDA'];
const DOCUMENT_TYPES = ['PASSPORT', 'INSURANCE', 'OTHER'];
const CONTACT_TYPES = ['CALL', 'EMAIL', 'WHATSAPP', 'IN_PERSON', 'OTHER'];
const COMPLAINT_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED'];
// Regimes de IVA relevantes para agencias de viagem em Portugal. MARGEM e
// a regra geral para pacotes comprados a operadores e revendidos (o
// modelo de negocio deste site) - os outros ficam disponiveis para casos
// especificos que a equipa identifique. So classificacao/calculo interno;
// nao substitui software certificado para emitir a fatura real.
const VAT_REGIMES = ['MARGEM', 'NORMAL', 'ISENTO', 'REDUZIDA'];
const SUPPLIER_TYPES = ['OPERADOR', 'HOTEL', 'SEGURADORA', 'TRANSPORTE', 'OUTRO'];

function id(prefix) {
  return `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function now() { return new Date().toISOString(); }

function ensureCollections(db) {
  db.customers ||= [];
  db.leads ||= [];
  db.reservations ||= [];
  db.payments ||= [];
  db.emails ||= [];
  db.operatorLogs ||= [];
  db.auditLogs ||= [];
  db.idempotencyKeys ||= {};
  db.documents ||= [];
  db.contactLog ||= [];
  db.complaints ||= [];
  db.suppliers ||= [];
  return db;
}

function missingDocumentsFor(reservation, documents) {
  const docs = documents.filter(d => d.reservationId === reservation.id);
  const missing = [];
  const passengers = reservation.passengers?.length ? reservation.passengers : [{ name: reservation.customer?.name || 'Titular' }];
  for (const passenger of passengers) {
    const passengerName = passenger.name || 'Titular';
    const hasPassport = docs.some(d => d.type === 'PASSPORT' && d.passengerName === passengerName);
    if (!hasPassport) missing.push(`Passaporte/cartao de cidadao de ${passengerName}`);
  }
  const hasInsurance = docs.some(d => d.type === 'INSURANCE');
  if (!hasInsurance) missing.push('Seguro de viagem');
  return missing;
}

function addOperatorLog(db, type, payload) {
  db.operatorLogs.unshift({ id: id('log'), createdAt: now(), type, payload });
  db.operatorLogs = db.operatorLogs.slice(0, 100);
}

function audit(db, actor, action, payload = {}) {
  ensureCollections(db).auditLogs.unshift({ id: id('audit'), createdAt: now(), actor, action, payload });
  db.auditLogs = db.auditLogs.slice(0, 200);
}

function statusLabel(status) {
  return ({
    NEW_LEAD: 'Nova lead',
    PROPOSAL_SENT: 'Proposta enviada',
    PENDING_PAYMENT: 'Em pagamento',
    PAYMENT_RECEIVED: 'Pagamento recebido',
    IN_VALIDATION: 'Em validação',
    CONFIRMED: 'Confirmada',
    CANCELLED: 'Cancelada',
    OPERATOR_ERROR: 'Erro no operador',
    HUMAN_REVIEW: 'Pendente de intervenção humana'
  })[status] || status;
}

function leadStageLabel(stage) {
  return ({ NOVA: 'Novo interesse', EM_CONSULTA: 'Em consulta', PROPOSTA_ENVIADA: 'Proposta enviada', RESERVADO: 'Reservado', PERDIDA: 'Perdido' })[stage] || 'Novo interesse';
}

function leadStage(lead) {
  return LEAD_STAGES.includes(lead.status) ? lead.status : 'NOVA';
}

const offerImages = {
  'tdz-puj-001': 'https://images.unsplash.com/photo-1510414842594-a61c69b5ae57?auto=format&fit=crop&w=900&q=80',
  'sol-puj-002': 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=80',
  'w2m-rm-003': 'https://images.unsplash.com/photo-1512813195386-6cf811ad3542?auto=format&fit=crop&w=900&q=80',
  'tdz-cv-004': 'https://images.unsplash.com/photo-1540202404-a2f29016b523?auto=format&fit=crop&w=900&q=80',
  'tdz-mal-005': 'https://images.unsplash.com/photo-1573843981267-be1999ff37cd?auto=format&fit=crop&w=900&q=80',
  'eur-dis-006': 'https://images.unsplash.com/photo-1499856871958-5b9627545d1a?auto=format&fit=crop&w=900&q=80',
  'mad-007': 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80'
};

function publicDeals(db, baseOffers, getOfferById) {
  return baseOffers.map((offer, index) => {
    const priced = getOfferById(offer.id, db.margins) || offer;
    return {
      id: offer.id,
      title: offer.destination,
      subtitle: offer.country,
      hotel: offer.hotel,
      board: offer.board,
      nights: offer.nights,
      origin: index % 2 ? 'Porto' : 'Lisboa',
      price: priced.finalPrice || offer.base,
      operator: offer.operator,
      image: offerImages[offer.id],
      tag: index < 3 ? 'Last call' : 'Novidade'
    };
  }).sort((a, b) => a.price - b.price);
}

// Nunca enviar o hash da password para o cliente, mesmo autenticado - o
// hash nao precisa de sair do servidor para nada. Usar sempre que um
// objeto de cliente for devolvido numa resposta (site publico ou admin).
function sanitizeCustomer(customer) {
  if (!customer) return customer;
  const { passwordHash, ...rest } = customer;
  return rest;
}

module.exports = {
  RESERVATION_STATUSES,
  LEAD_STAGES,
  DOCUMENT_TYPES,
  CONTACT_TYPES,
  COMPLAINT_STATUSES,
  VAT_REGIMES,
  SUPPLIER_TYPES,
  id,
  now,
  ensureCollections,
  missingDocumentsFor,
  addOperatorLog,
  audit,
  statusLabel,
  leadStageLabel,
  leadStage,
  offerImages,
  publicDeals,
  sanitizeCustomer
};
