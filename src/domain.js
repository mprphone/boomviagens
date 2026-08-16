// Helpers de dominio partilhados por varias rotas (nao dependem de
// req/res nem de nenhum backend de armazenamento especifico).

const crypto = require('crypto');

// Ciclo de vida completo do processo, incluindo os estados pos-confirmacao
// (documentacao, preparacao final, viagem em curso, pos-viagem, encerramento)
// que nao existiam antes - o site vende diretamente (sem proposta manual em
// papel, ja coberta pelo funil de "Interesses"/LEAD_STAGES), por isso a
// numeracao adapta o processo classico de agencia ao fluxo de venda online.
const RESERVATION_STATUSES = [
  'NEW_LEAD', 'PROPOSAL_SENT', 'PENDING_PAYMENT', 'PAYMENT_RECEIVED', 'IN_VALIDATION', 'HUMAN_REVIEW', 'CONFIRMED',
  'AWAITING_DOCUMENTS', 'READY', 'CHECKIN', 'IN_TRIP', 'POST_TRIP', 'WITH_COMPLAINT', 'CONCLUDED',
  'CANCELLED', 'OPERATOR_ERROR'
];
// Legado: nada cria registos em "leads" - ver OPPORTUNITY_STAGES (pipeline
// comercial "Oportunidades", que substitui o antigo separador "Interesses").
const LEAD_STAGES = ['NOVA', 'EM_CONSULTA', 'PROPOSTA_ENVIADA', 'RESERVADO', 'PERDIDA'];

// Perfil de cada colaborador (separador "Equipa") - ADMIN ve/faz tudo,
// SUPERVISOR ve toda a equipa e pode redistribuir, os outros tres
// correspondem aos tres "responsaveis" possiveis de um processo (ver
// reservations.commercial_staff_id/operational_staff_id/financial_staff_id).
const STAFF_ROLES = ['COMERCIAL', 'OPERACIONAL', 'FINANCEIRO', 'SUPERVISOR', 'ADMIN'];
// Distingue colaborador interno de freelancer (separador "Equipa") - por
// agora so isto; um freelancer trabalhar para varias agencias ao mesmo
// tempo ou ter regras de comissao proprias fica para pedir depois.
const EMPLOYMENT_TYPES = ['INTERNO', 'FREELANCER'];

// Fases do Pipeline comercial (quadro por arrasto, ver separador
// "Pipeline"). Fixas no codigo por agora (nao editaveis pelo
// administrador ainda). GANHO/PERDIDO sao fases terminais: GANHO oferece
// converter a oportunidade num processo de viagem; PERDIDO exige motivo
// (ver LOSS_REASONS).
const OPPORTUNITY_STAGES = ['NOVO_INTERESSE', 'CONTACTADO', 'A_PREPARAR_PROPOSTA', 'PROPOSTA_ENVIADA', 'FOLLOW_UP', 'NEGOCIACAO', 'GANHO', 'PERDIDO'];
const OPPORTUNITY_TEMPERATURES = ['QUENTE', 'MORNO', 'FRIO'];
const OPPORTUNITY_TAGS = ['VIP', 'FAMILIA', 'LUA_DE_MEL', 'GRUPO', 'URGENTE'];
const OPPORTUNITY_ORIGINS = ['WEBSITE', 'TELEFONE', 'EMAIL', 'WHATSAPP', 'BALCAO', 'FACEBOOK', 'INSTAGRAM', 'RECOMENDACAO', 'CLIENTE_ANTIGO', 'CAMPANHA', 'OUTRO'];
const NEXT_ACTION_TYPES = ['TELEFONAR', 'ENVIAR_EMAIL', 'ENVIAR_WHATSAPP', 'ENVIAR_PROPOSTA', 'CONFIRMAR_DECISAO', 'AGUARDAR_CLIENTE', 'OUTRO'];
const LOSS_REASONS = ['PRECO', 'CLIENTE_DESISTIU', 'CONCORRENCIA', 'DATAS', 'DESTINO', 'SEM_DISPONIBILIDADE', 'SEM_RESPOSTA', 'OUTRO'];
const PROPOSAL_STATUSES = ['RASCUNHO', 'ENVIADA', 'VISTA', 'ACEITE', 'REJEITADA', 'EXPIRADA'];
// Categorias documentais (separador "Documentos") - agrupam-se visualmente
// por area (cliente, reserva, financeiro, viagem, ocorrencias) na UI.
const DOCUMENT_TYPES = ['PASSPORT', 'VISA', 'INSURANCE', 'VOUCHER', 'TICKET', 'INVOICE_PURCHASE', 'INVOICE_SALE', 'RECEIPT', 'CREDIT_NOTE', 'ITINERARY', 'OCCURRENCE_PHOTO', 'OTHER'];
// Tipos de documento financeiro (separador Financeiro > Faturas e
// Documentos) - so estes tres usam document_number/document_date/amount.
const CUSTOMER_FINANCIAL_DOC_TYPES = ['INVOICE_SALE', 'RECEIPT', 'CREDIT_NOTE'];
// Tipos que a Area de Cliente pode mostrar (ver auditoria) - so documentos
// de viagem, nunca financeiros/internos (faturas de compra, recibos,
// notas de credito, fotos de ocorrencia, "outro"). Por defeito fechado:
// um tipo novo em DOCUMENT_TYPES so fica visivel ao cliente se for
// explicitamente acrescentado aqui.
const CUSTOMER_VISIBLE_DOCUMENT_TYPES = ['PASSPORT', 'VISA', 'INSURANCE', 'VOUCHER', 'TICKET', 'ITINERARY'];
const CONTACT_TYPES = ['CALL', 'EMAIL', 'WHATSAPP', 'IN_PERSON', 'OTHER'];
const COMPLAINT_STATUSES = ['OPEN', 'ANALYZING', 'SENT_TO_SUPPLIER', 'AWAITING_RESPONSE', 'RESPONSE_RECEIVED', 'NEGOTIATING', 'APPROVED', 'REJECTED', 'RESOLVED', 'CLOSED'];
// Uma reclamacao pode ser do cliente contra a agencia, ou da agencia contra
// um fornecedor/operador (separador "Reclamacoes").
const COMPLAINT_DIRECTIONS = ['CUSTOMER_TO_AGENCY', 'AGENCY_TO_SUPPLIER'];
const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'AWAITING_CUSTOMER', 'AWAITING_SUPPLIER', 'DONE', 'CANCELLED'];
const TASK_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
// Regimes de IVA relevantes para agencias de viagem em Portugal. MARGEM e
// a regra geral para pacotes comprados a operadores e revendidos (o
// modelo de negocio deste site) - os outros ficam disponiveis para casos
// especificos que a equipa identifique. So classificacao/calculo interno;
// nao substitui software certificado para emitir a fatura real.
const VAT_REGIMES = ['MARGEM', 'NORMAL', 'ISENTO', 'REDUZIDA'];
const SUPPLIER_TYPES = ['OPERADOR', 'HOTEL', 'SEGURADORA', 'TRANSPORTE', 'OUTRO'];
// Sentido de um reembolso/nota de credito (separador Financeiro > Conta do
// Processo) - CUSTOMER_REFUND e dinheiro que a agencia devolve ao cliente
// (movimento negativo), SUPPLIER_CREDIT e uma nota de credito que um
// fornecedor emite a agencia por um servico cancelado (movimento positivo).
const REFUND_DIRECTIONS = ['CUSTOMER_REFUND', 'SUPPLIER_CREDIT'];
// Fases da margem do processo (separador Financeiro > Conta do Processo) -
// "prevista" ja existe (reservation.offer.marginValue, congelada na
// criacao), estas duas sao instantaneos manuais que a equipa regista
// quando a compra fica fechada com os fornecedores e quando o processo e
// encerrado, para comparar com a margem "ao vivo" das linhas de servico.
const MARGIN_SNAPSHOT_STAGES = ['confirmed', 'final'];
// Linhas de servico (compras/vendas) dentro de uma reserva - separador
// "Servicos" da Ficha de Reserva. Cada linha e um item comprado a um
// fornecedor e revendido ao cliente (voo, hotel, seguro...), com o seu
// proprio custo/venda - a soma destas linhas da os "Valores Reais" da
// reserva, em contraste com os "Valores Estimados" da proposta original.
const SERVICE_TYPES = ['VOO', 'ALOJAMENTO', 'TRANSFER', 'CRUZEIRO', 'RENT_A_CAR', 'SEGURO', 'VISTO', 'RESTAURACAO', 'TOUR', 'DIVERSOS'];
// Estado de cada reserva individual (nao um estado operacional generico) -
// o percurso real varia por tipo de servico (um voo tem emissao de
// bilhete e check-in; um hotel so tem confirmacao e pagamento), por isso
// cada tipo tem o seu proprio subconjunto de estados validos - ver
// SERVICE_STATUS_FLOW_BY_TYPE/serviceStatusesForType. Cancelado esta
// sempre disponivel, para qualquer tipo. Atrasos e outros problemas ficam
// no separador Ocorrencias (tipo DELAY), nao aqui - sao um acontecimento,
// nao um estado do processo de compra. "Pago" aqui e o estado que o
// proprio fornecedor reporta (ex.: hotel confirma saldo liquidado); o
// registo interno de pagamento ao fornecedor (separador Financeiro >
// Pagamentos) e um campo à parte (paid/paidAt), propositadamente
// independente para nao depender do tipo de servico.
const SERVICE_STATUSES = ['NAO_CONFIRMADO', 'CONFIRMADO', 'EMITIDO', 'PAGO', 'CHECKIN_FEITO', 'CANCELADO'];
const SERVICE_STATUS_FLOW_BY_TYPE = {
  VOO: ['NAO_CONFIRMADO', 'CONFIRMADO', 'EMITIDO', 'CHECKIN_FEITO'],
  CRUZEIRO: ['NAO_CONFIRMADO', 'CONFIRMADO', 'EMITIDO', 'CHECKIN_FEITO'],
  ALOJAMENTO: ['NAO_CONFIRMADO', 'CONFIRMADO', 'PAGO'],
  TRANSFER: ['NAO_CONFIRMADO', 'CONFIRMADO', 'PAGO'],
  RENT_A_CAR: ['NAO_CONFIRMADO', 'CONFIRMADO', 'PAGO'],
  SEGURO: ['NAO_CONFIRMADO', 'CONFIRMADO', 'EMITIDO'],
  VISTO: ['NAO_CONFIRMADO', 'CONFIRMADO', 'EMITIDO'],
  RESTAURACAO: ['NAO_CONFIRMADO', 'CONFIRMADO', 'PAGO'],
  TOUR: ['NAO_CONFIRMADO', 'CONFIRMADO', 'PAGO'],
  DIVERSOS: ['NAO_CONFIRMADO', 'CONFIRMADO', 'PAGO']
};
function serviceStatusesForType(type) {
  return [...(SERVICE_STATUS_FLOW_BY_TYPE[type] || SERVICE_STATUS_FLOW_BY_TYPE.DIVERSOS), 'CANCELADO'];
}
// Historico/timeline da reserva (separador "Historico") - regista tudo,
// automatico e manual, e nunca e editado/apagado. O separador "Ocorrencias"
// e uma leitura filtrada deste mesmo registo (so os tipos "de ocorrencia"),
// com um estado de resolucao proprio (ver reservationEventToRow).
const AUTO_EVENT_TYPES = ['STATUS_CHANGE', 'SERVICE_ADDED', 'SERVICE_UPDATED', 'SERVICE_REMOVED', 'DOCUMENT_UPLOADED'];
const OCCURRENCE_EVENT_TYPES = ['INFO', 'CHANGE', 'PROBLEM', 'INCIDENT', 'DELAY', 'SERVICE_NOT_RENDERED', 'SUPPLIER_ERROR', 'INTERNAL_ERROR', 'CUSTOMER_REQUEST', 'OTHER'];
const MANUAL_EVENT_TYPES = [...OCCURRENCE_EVENT_TYPES, 'CONTACT', 'NOTE'];
const EVENT_TYPES = [...AUTO_EVENT_TYPES, ...MANUAL_EVENT_TYPES];

function id(prefix) {
  return `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function now() { return new Date().toISOString(); }

function ensureCollections(db) {
  db.staff ||= [];
  db.branches ||= [];
  db.customers ||= [];
  db.leads ||= [];
  db.opportunities ||= [];
  db.opportunityEvents ||= [];
  db.proposals ||= [];
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
  db.serviceLines ||= [];
  db.serviceLinePayments ||= [];
  db.refunds ||= [];
  db.reservationEvents ||= [];
  db.tasks ||= [];
  return db;
}

// Alertas calculados a partir dos dados existentes (nunca guardados) -
// mostrados no dashboard do Resumo. Cada alerta tem um tipo e uma
// severidade (warning = atencao, critical = urgente).
function computeAlerts(reservation, { serviceLines = [], documents = [], payments = [], tasks = [] } = {}) {
  const alerts = [];
  const today = new Date();
  const inDays = n => new Date(today.getTime() + n * 24 * 60 * 60 * 1000);
  const checkin = reservation.offer?.checkin ? new Date(`${reservation.offer.checkin}T00:00:00`) : null;

  for (const line of serviceLines) {
    if (line.optionDeadline && line.status === 'NAO_CONFIRMADO') {
      const deadline = new Date(`${line.optionDeadline}T00:00:00`);
      if (deadline <= inDays(2) && deadline >= today) alerts.push({ type: 'OPTION_EXPIRING', severity: 'critical', message: `Opção de "${line.description}" termina em breve (${line.optionDeadline})` });
      else if (deadline < today) alerts.push({ type: 'OPTION_EXPIRED', severity: 'critical', message: `Opção de "${line.description}" já expirou (${line.optionDeadline})` });
    }
    if (line.status === 'NAO_CONFIRMADO' && checkin && checkin <= inDays(7)) {
      alerts.push({ type: 'SERVICE_UNCONFIRMED', severity: 'warning', message: `"${line.description}" ainda não está confirmado e a viagem é em menos de 7 dias` });
    }
    if (!line.paid && line.netValue > 0 && line.status !== 'CANCELADO') {
      alerts.push({ type: 'SUPPLIER_PAYMENT_PENDING', severity: 'warning', message: `Pagamento a "${line.supplierName || 'fornecedor'}" (${line.description}) ainda pendente` });
    }
  }

  const missingDocs = missingDocumentsFor(reservation, documents);
  if (missingDocs.length) alerts.push({ type: 'MISSING_DOCUMENTS', severity: 'warning', message: `Documentação em falta: ${missingDocs.join(', ')}` });

  const pendingPayment = payments.find(p => p.status === 'PENDING');
  if (pendingPayment) alerts.push({ type: 'CUSTOMER_PAYMENT_PENDING', severity: 'warning', message: `Pagamento do cliente pendente (${pendingPayment.amount} €)` });

  if (checkin) {
    if (checkin <= inDays(2) && checkin >= today) alerts.push({ type: 'DEPARTURE_SOON', severity: 'critical', message: 'Partida em menos de 48 horas' });
    else if (checkin <= inDays(7) && checkin >= today) alerts.push({ type: 'DEPARTURE_NEAR', severity: 'warning', message: 'Partida dentro de 7 dias' });
  }

  const overdueTasks = tasks.filter(t => t.status !== 'DONE' && t.status !== 'CANCELLED' && t.dueDate && new Date(`${t.dueDate}T00:00:00`) < today);
  if (overdueTasks.length) alerts.push({ type: 'TASKS_OVERDUE', severity: 'critical', message: `${overdueTasks.length} tarefa(s) em atraso` });

  return alerts;
}

// Soma as linhas de servico de uma reserva para obter os valores reais
// (custo/venda/margem), a comparar com os valores estimados da proposta
// original (offer.costPrice/finalPrice/marginValue). Cada linha pode ter
// desconto (%) sobre o valor de venda.
function computeServiceTotals(lines = []) {
  let netTotal = 0;
  let pvpTotal = 0;
  for (const line of lines) {
    const quantity = Number(line.quantity) || 1;
    const net = (Number(line.netValue) || 0) * quantity;
    const gross = (Number(line.pvpValue) || 0) * quantity;
    const discount = gross * (Number(line.discountPercent) || 0) / 100;
    netTotal += net;
    pvpTotal += gross - discount;
  }
  netTotal = Number(netTotal.toFixed(2));
  pvpTotal = Number(pvpTotal.toFixed(2));
  return { netTotal, pvpTotal, margin: Number((pvpTotal - netTotal).toFixed(2)) };
}

// Pagamentos a fornecedores em tranches (separador Financeiro > Serviços e
// Reservas): substitui o antigo paid/paidAt booleano por um ledger real
// (service_line_payments, varios pagamentos por linha). Devolve as linhas
// com paid/paidAt/paidAmount calculados a partir da soma dos pagamentos,
// para todo o codigo que ja lia line.paid (alertas, extrato de Movimentos)
// continuar a funcionar sem alteracoes - so a origem do valor muda.
function enrichServiceLinesWithPayments(lines = [], payments = []) {
  return lines.map(line => {
    const linePayments = payments
      .filter(p => p.serviceLineId === line.id)
      .sort((a, b) => new Date(a.paidAt) - new Date(b.paidAt));
    const paidAmount = Number(linePayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0).toFixed(2));
    const dueAmount = (Number(line.netValue) || 0) * (Number(line.quantity) || 1);
    const paid = paidAmount > 0 && paidAmount >= dueAmount - 0.005;
    return {
      ...line,
      payments: linePayments,
      paidAmount,
      paid,
      paidAt: paid ? linePayments[linePayments.length - 1]?.paidAt : undefined
    };
  });
}

function serviceTypeLabel(type) {
  return ({
    VOO: 'Voo', ALOJAMENTO: 'Alojamento', TRANSFER: 'Transfer', CRUZEIRO: 'Cruzeiro',
    RENT_A_CAR: 'Aluguer de carro', SEGURO: 'Seguro de viagem', VISTO: 'Visto',
    RESTAURACAO: 'Restauração', TOUR: 'Tour/Excursão', DIVERSOS: 'Diversos'
  })[type] || type;
}

function serviceStatusLabel(status) {
  return ({
    NAO_CONFIRMADO: 'Não confirmado', CONFIRMADO: 'Confirmado', EMITIDO: 'Emitido',
    PAGO: 'Pago', CHECKIN_FEITO: 'Check-in feito', CANCELADO: 'Cancelado'
  })[status] || status;
}

function eventTypeLabel(type) {
  return ({
    STATUS_CHANGE: 'Mudança de estado', SERVICE_ADDED: 'Serviço adicionado',
    SERVICE_UPDATED: 'Serviço atualizado', SERVICE_REMOVED: 'Serviço removido',
    DOCUMENT_UPLOADED: 'Documento anexado',
    INFO: 'Informação', CHANGE: 'Alteração', PROBLEM: 'Problema', INCIDENT: 'Incidente',
    DELAY: 'Atraso', SERVICE_NOT_RENDERED: 'Serviço não prestado', SUPPLIER_ERROR: 'Erro do fornecedor',
    INTERNAL_ERROR: 'Erro interno', CUSTOMER_REQUEST: 'Pedido do cliente', OTHER: 'Outro',
    CONTACT: 'Contacto', NOTE: 'Nota'
  })[type] || type;
}

function taskStatusLabel(status) {
  return ({ TODO: 'Por fazer', IN_PROGRESS: 'Em curso', AWAITING_CUSTOMER: 'A aguardar cliente', AWAITING_SUPPLIER: 'A aguardar fornecedor', DONE: 'Concluída', CANCELLED: 'Cancelada' })[status] || status;
}

function taskPriorityLabel(priority) {
  return ({ LOW: 'Baixa', NORMAL: 'Normal', HIGH: 'Alta', URGENT: 'Urgente' })[priority] || priority;
}

function complaintStatusLabel(status) {
  return ({
    OPEN: 'Aberta', ANALYZING: 'Em análise', SENT_TO_SUPPLIER: 'Enviada ao fornecedor',
    AWAITING_RESPONSE: 'A aguardar resposta', RESPONSE_RECEIVED: 'Resposta recebida', NEGOTIATING: 'Em negociação',
    APPROVED: 'Indemnização aprovada', REJECTED: 'Recusada', RESOLVED: 'Resolvida', CLOSED: 'Encerrada',
    IN_PROGRESS: 'Em análise'
  })[status] || status;
}

function documentTypeLabel(type) {
  return ({
    PASSPORT: 'Passaporte/CC', VISA: 'Visto', INSURANCE: 'Seguro de viagem', VOUCHER: 'Voucher',
    TICKET: 'Bilhete', INVOICE_PURCHASE: 'Fatura de compra', INVOICE_SALE: 'Fatura de venda',
    RECEIPT: 'Recibo/comprovativo', CREDIT_NOTE: 'Nota de crédito', ITINERARY: 'Itinerário/programa',
    OCCURRENCE_PHOTO: 'Foto de ocorrência', OTHER: 'Outro'
  })[type] || type;
}

// Numero de processo apresentavel ao utilizador (ex.: PV-2026-1C322A),
// derivado do id interno (ja unico) em vez de um contador incremental a
// serio - evitaria condicoes de corrida entre pedidos concorrentes sem uma
// sequencia atomica no Supabase, que este projeto nao tem.
function processNumber(reservation) {
  const year = (reservation.createdAt || '').slice(0, 4) || String(new Date().getFullYear());
  const suffix = String(reservation.id || '').split('-').pop() || '000000';
  return `PV-${year}-${suffix}`;
}

// Mesma logica do processNumber, mas para oportunidades (OP-). Quando uma
// oportunidade e convertida em reserva, o id da reserva reaproveita este
// mesmo sufixo (ver opportunitiesRoutes.js), pelo que OP-2026-1C322A e
// PV-2026-1C322A identificam o mesmo processo comercial em duas fases.
function opportunityNumber(opportunity) {
  const year = (opportunity.createdAt || '').slice(0, 4) || String(new Date().getFullYear());
  const suffix = String(opportunity.id || '').split('-').pop() || '000000';
  return `OP-${year}-${suffix}`;
}

// O proprio cliente ve sempre o que ele mesmo anexou (qualquer tipo) - a
// restricao de tipo e so para documentos que a equipa anexou do lado do
// backoffice. Documentos de ocorrencia/reclamacao ficam sempre de fora,
// seja qual for o tipo ou quem anexou - sao registos internos de um
// incidente, nao documentos de viagem do cliente.
function isCustomerVisibleDocument(doc, customerEmail) {
  if (doc.eventId || doc.complaintId) return false;
  if (doc.uploadedBy === customerEmail) return true;
  return CUSTOMER_VISIBLE_DOCUMENT_TYPES.includes(doc.type);
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
    AWAITING_DOCUMENTS: 'A aguardar documentação',
    READY: 'Processo completo',
    CHECKIN: 'Check-in / preparação final',
    IN_TRIP: 'Em viagem',
    POST_TRIP: 'Pós-viagem',
    WITH_COMPLAINT: 'Com reclamação',
    CONCLUDED: 'Concluído',
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

function staffRoleLabel(role) {
  return ({ COMERCIAL: 'Comercial', OPERACIONAL: 'Operacional', FINANCEIRO: 'Financeiro', SUPERVISOR: 'Supervisor', ADMIN: 'Administrador' })[role] || role;
}

function employmentTypeLabel(type) {
  return ({ INTERNO: 'Interno', FREELANCER: 'Freelancer' })[type] || type;
}

function opportunityStageLabel(stage) {
  return ({
    NOVO_INTERESSE: 'Novo interesse', CONTACTADO: 'Contactado', A_PREPARAR_PROPOSTA: 'A preparar proposta',
    PROPOSTA_ENVIADA: 'Proposta enviada', FOLLOW_UP: 'Follow-up', NEGOCIACAO: 'Negociação',
    GANHO: 'Ganho', PERDIDO: 'Perdido'
  })[stage] || stage;
}

function opportunityTemperatureLabel(temperature) {
  return ({ QUENTE: 'Quente', MORNO: 'Morno', FRIO: 'Frio' })[temperature] || temperature;
}

function opportunityTagLabel(tag) {
  return ({ VIP: 'VIP', FAMILIA: 'Família', LUA_DE_MEL: 'Lua de mel', GRUPO: 'Grupo', URGENTE: 'Urgente' })[tag] || tag;
}

function opportunityOriginLabel(origin) {
  return ({
    WEBSITE: 'Website', TELEFONE: 'Telefone', EMAIL: 'Email', WHATSAPP: 'WhatsApp', BALCAO: 'Balcão',
    FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram', RECOMENDACAO: 'Recomendação', CLIENTE_ANTIGO: 'Cliente antigo',
    CAMPANHA: 'Campanha', OUTRO: 'Outro'
  })[origin] || origin;
}

function nextActionTypeLabel(type) {
  return ({
    TELEFONAR: 'Telefonar', ENVIAR_EMAIL: 'Enviar email', ENVIAR_WHATSAPP: 'Enviar WhatsApp',
    ENVIAR_PROPOSTA: 'Enviar nova proposta', CONFIRMAR_DECISAO: 'Confirmar decisão',
    AGUARDAR_CLIENTE: 'Aguardar cliente', OUTRO: 'Outro'
  })[type] || type;
}

function lossReasonLabel(reason) {
  return ({
    PRECO: 'Preço', CLIENTE_DESISTIU: 'Cliente desistiu', CONCORRENCIA: 'Escolheu concorrência',
    DATAS: 'Datas', DESTINO: 'Destino', SEM_DISPONIBILIDADE: 'Falta de disponibilidade',
    SEM_RESPOSTA: 'Sem resposta', OUTRO: 'Outro'
  })[reason] || reason;
}

function proposalStatusLabel(status) {
  return ({ RASCUNHO: 'Rascunho', ENVIADA: 'Enviada', VISTA: 'Vista', ACEITE: 'Aceite', REJEITADA: 'Rejeitada', EXPIRADA: 'Expirada' })[status] || status;
}

// Cor/estado do cartao no Pipeline (secao "Cor do cartao") + deteção de
// oportunidades paradas (secao "Oportunidades sem atividade"). Nunca
// guardado - calculado a partir da propria oportunidade + eventos.
function opportunityHealth(opportunity, { lastEventAt } = {}) {
  if (opportunity.stage === 'GANHO' || opportunity.stage === 'PERDIDO') return { color: 'grey', warnings: [] };
  const today = new Date();
  const daysSince = dateStr => dateStr ? Math.floor((today - new Date(dateStr)) / (24 * 60 * 60 * 1000)) : null;
  const warnings = [];

  const sinceContact = daysSince(lastEventAt || opportunity.updatedAt || opportunity.createdAt);
  if (sinceContact !== null && sinceContact >= 5) warnings.push(`Sem contacto há ${sinceContact} dias`);

  if (opportunity.stage === 'PROPOSTA_ENVIADA') {
    const sinceUpdate = daysSince(opportunity.updatedAt || opportunity.createdAt);
    if (sinceUpdate !== null && sinceUpdate >= 7) warnings.push(`Proposta enviada há ${sinceUpdate} dias sem follow-up`);
  }

  if (opportunity.temperature === 'QUENTE' && !opportunity.nextActionDate) warnings.push('Cliente quente sem próxima ação');

  const nextActionOverdue = Boolean(opportunity.nextActionDate && new Date(`${opportunity.nextActionDate}T00:00:00`) < today);

  let color = 'blue';
  if (nextActionOverdue) color = 'red';
  else if (warnings.length) color = 'yellow';
  else if (sinceContact === null || sinceContact >= 10) color = 'grey';
  else color = 'green';

  return { color, warnings, nextActionOverdue };
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
      tag: index < 3 ? 'Últimos lugares' : 'Novidade',
      rating: offer.rating,
      freeCancellation: offer.freeCancellation
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

function sanitizeStaff(staff) {
  if (!staff) return staff;
  const { passwordHash, ...rest } = staff;
  return rest;
}

// So os campos que a Area de Cliente mesmo usa (ver auditoria) - antes
// devolvia a reserva inteira, incluindo offer.costPrice/margem, notas
// internas, responsaveis internos e o estado da validacao com o operador.
// Ao adicionar aqui um campo novo, confirmar primeiro que o frontend de
// public/conta/ precisa mesmo dele.
function customerReservationView(reservation, { missingDocuments = [], payment } = {}) {
  const offer = reservation.offer || {};
  return {
    id: reservation.id,
    status: reservation.status,
    offer: {
      hotel: offer.hotel,
      destination: offer.destination,
      country: offer.country,
      checkin: offer.checkin,
      checkout: offer.checkout,
      nights: offer.nights,
      board: offer.board,
      finalPrice: offer.finalPrice
    },
    missingDocuments,
    payment: payment ? {
      id: payment.id,
      status: payment.status,
      method: payment.method,
      reference: payment.reference,
      amount: payment.amount
    } : null
  };
}

// Vista da pagina propria do processo (separador "As minhas viagens" >
// uma viagem) - mais rica que customerReservationView (que serve as
// listas), mas com o mesmo cuidado: cada linha de servico e pagamento so
// leva os campos que o cliente pode ver. Nunca netValue/pvpValue/
// discountPercent (custo e margem) nem notas internas.
function customerReservationDetailView(reservation, { serviceLines = [], payments = [], missingDocuments = [] } = {}) {
  const offer = reservation.offer || {};
  return {
    id: reservation.id,
    processNumber: processNumber(reservation),
    status: reservation.status,
    passengers: reservation.passengers || [],
    offer: {
      hotel: offer.hotel,
      destination: offer.destination,
      country: offer.country,
      checkin: offer.checkin,
      checkout: offer.checkout,
      nights: offer.nights,
      board: offer.board,
      finalPrice: offer.finalPrice
    },
    missingDocuments,
    serviceLines: serviceLines
      .filter(l => l.status !== 'CANCELADO')
      .map(l => ({
        id: l.id, type: l.type, description: l.description, supplierName: l.supplierName,
        locator: l.locator, dateStart: l.dateStart, dateEnd: l.dateEnd, status: l.status
      })),
    payments: payments.map(p => ({
      id: p.id, method: p.method, reference: p.reference, amount: p.amount, status: p.status, paidAt: p.paidAt
    }))
  };
}

module.exports = {
  RESERVATION_STATUSES,
  LEAD_STAGES,
  STAFF_ROLES,
  EMPLOYMENT_TYPES,
  OPPORTUNITY_STAGES,
  OPPORTUNITY_TEMPERATURES,
  OPPORTUNITY_TAGS,
  OPPORTUNITY_ORIGINS,
  NEXT_ACTION_TYPES,
  LOSS_REASONS,
  PROPOSAL_STATUSES,
  DOCUMENT_TYPES,
  CUSTOMER_FINANCIAL_DOC_TYPES,
  CONTACT_TYPES,
  COMPLAINT_STATUSES,
  COMPLAINT_DIRECTIONS,
  VAT_REGIMES,
  SUPPLIER_TYPES,
  REFUND_DIRECTIONS,
  MARGIN_SNAPSHOT_STAGES,
  SERVICE_TYPES,
  SERVICE_STATUSES,
  SERVICE_STATUS_FLOW_BY_TYPE,
  serviceStatusesForType,
  EVENT_TYPES,
  AUTO_EVENT_TYPES,
  OCCURRENCE_EVENT_TYPES,
  MANUAL_EVENT_TYPES,
  TASK_STATUSES,
  TASK_PRIORITIES,
  id,
  now,
  ensureCollections,
  missingDocumentsFor,
  addOperatorLog,
  audit,
  statusLabel,
  leadStageLabel,
  leadStage,
  staffRoleLabel,
  employmentTypeLabel,
  opportunityStageLabel,
  opportunityTemperatureLabel,
  opportunityTagLabel,
  opportunityOriginLabel,
  nextActionTypeLabel,
  lossReasonLabel,
  proposalStatusLabel,
  opportunityHealth,
  offerImages,
  publicDeals,
  sanitizeCustomer,
  sanitizeStaff,
  customerReservationView,
  customerReservationDetailView,
  isCustomerVisibleDocument,
  computeServiceTotals,
  enrichServiceLinesWithPayments,
  serviceTypeLabel,
  serviceStatusLabel,
  eventTypeLabel,
  taskStatusLabel,
  taskPriorityLabel,
  complaintStatusLabel,
  documentTypeLabel,
  processNumber,
  opportunityNumber,
  computeAlerts
};
