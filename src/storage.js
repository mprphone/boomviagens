const fs = require('fs');
const path = require('path');
const { readDbSqlite, writeDbSqlite, updateDbSqlite, SQLITE_PATH } = require('./storageSqlite');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseConfigured = Boolean(
  SUPABASE_URL && !SUPABASE_URL.includes('PROJECT_REF') &&
  SUPABASE_SERVICE_ROLE_KEY && !SUPABASE_SERVICE_ROLE_KEY.includes('colocar_')
);

const useSupabase = process.env.DB_MODE === 'supabase' && supabaseConfigured;
const useSqlite = process.env.DB_MODE === 'sqlite';

if (process.env.DB_MODE === 'supabase' && !supabaseConfigured) {
  console.warn('[storage] DB_MODE=supabase mas SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY nao estao definidos corretamente. A usar data/db.json local (nao persistente em Vercel).');
}

// ---------------------------------------------------------------------------
// Backend local: ficheiro JSON. So serve para desenvolvimento; em Vercel o
// sistema de ficheiros e efemero, por isso este backend nao deve ser usado
// em producao (usar DB_MODE=supabase).
// ---------------------------------------------------------------------------

function readDbLocal() {
  if (!fs.existsSync(DB_PATH)) throw new Error(`DB nÃ£o encontrada: ${DB_PATH}`);
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeDbLocal(db) {
  const tmp = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DB_PATH);
  return db;
}

// ---------------------------------------------------------------------------
// Backend Supabase (PostgREST). Usa apenas SUPABASE_SERVICE_ROLE_KEY, nunca
// deve correr no browser. Mapeia entre o formato em memoria (igual ao
// data/db.json) e as tabelas relacionais de docs/supabase-schema.sql.
// ---------------------------------------------------------------------------

async function supabaseFetch(table, { method = 'GET', search = '', body, prefer } = {}) {
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${table}${search}`;
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`Supabase ${table} ${method}: ${res.status} ${await res.text()}`);
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function selectAll(table, search) {
  return supabaseFetch(table, { search: `?select=*${search || ''}` });
}

async function upsertRows(table, rows, onConflict = 'id') {
  if (!rows || !rows.length) return;
  await supabaseFetch(table, {
    method: 'POST',
    search: `?on_conflict=${encodeURIComponent(onConflict)}`,
    body: rows,
    prefer: 'resolution=merge-duplicates'
  });
}

async function deleteRows(table, ids) {
  if (!ids || !ids.length) return;
  const filter = ids.map(id => encodeURIComponent(id)).join(',');
  await supabaseFetch(table, { method: 'DELETE', search: `?id=in.(${filter})` });
}

function defaultCompany() {
  return {
    name: process.env.COMPANY_NAME || 'About Destiny, Unipessoal Lda',
    brand: 'Boomviagens',
    domain: process.env.COMPANY_DOMAIN || '',
    email: process.env.COMPANY_EMAIL || '',
    phone: process.env.COMPANY_PHONE || '',
    nif: process.env.COMPANY_NIF || '',
    rnavt: process.env.COMPANY_RNAVT || '',
    address: '',
    cae: '',
    marketCountry: process.env.MARKET_COUNTRY || 'PT',
    currency: process.env.CURRENCY || 'EUR',
    priceType: process.env.PRICE_TYPE || 'PVP',
    commissionIncluded: process.env.COMMISSION_INCLUDED !== 'false',
    confirmationMode: process.env.CONFIRMATION_MODE || 'automatic',
    defaultMarginPercent: Number(process.env.DEFAULT_MARGIN_PERCENT || 5)
  };
}

function rowToCompany(row) {
  if (!row) return defaultCompany();
  return {
    name: row.name,
    brand: row.brand,
    domain: row.domain || '',
    email: row.email || '',
    phone: row.phone || '',
    nif: row.nif || '',
    rnavt: row.rnavt || '',
    address: row.address || '',
    cae: row.cae || '',
    marketCountry: row.market_country,
    currency: row.currency,
    priceType: row.price_type,
    commissionIncluded: row.commission_included,
    confirmationMode: row.confirmation_mode,
    defaultMarginPercent: Number(row.default_margin_percent)
  };
}

function companyToRow(company = {}) {
  return {
    id: 'main',
    name: company.name,
    brand: company.brand,
    domain: company.domain || null,
    email: company.email || null,
    phone: company.phone || null,
    nif: company.nif || null,
    rnavt: company.rnavt || null,
    address: company.address || null,
    cae: company.cae || null,
    market_country: company.marketCountry || 'PT',
    currency: company.currency || 'EUR',
    price_type: company.priceType || 'PVP',
    commission_included: company.commissionIncluded !== false,
    confirmation_mode: company.confirmationMode || 'automatic',
    default_margin_percent: company.defaultMarginPercent ?? 5
  };
}

function rowToMargin(row) {
  return {
    id: row.id,
    name: row.name,
    match: row.match_rule,
    percent: Number(row.percent),
    min: Number(row.min_value),
    roundTo: Number(row.round_to),
    active: row.active
  };
}

function marginToRow(m) {
  return {
    id: m.id,
    name: m.name,
    match_rule: m.match || '*',
    percent: m.percent ?? 5,
    min_value: m.min ?? 0,
    round_to: m.roundTo ?? 5,
    active: m.active !== false
  };
}

function rowToBranch(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at || undefined,
    name: row.name,
    code: row.code || '',
    address: row.address || '',
    phone: row.phone || '',
    active: row.active !== false
  };
}

function branchToRow(b) {
  return {
    id: b.id,
    created_at: b.createdAt,
    updated_at: b.updatedAt || null,
    name: b.name,
    code: b.code || null,
    address: b.address || null,
    phone: b.phone || null,
    active: b.active !== false
  };
}

function rowToCustomer(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at || undefined,
    name: row.name,
    email: row.email,
    phone: row.phone || '',
    phone2: row.phone2 || '',
    nif: row.nif || '',
    address: row.address || '',
    postalCode: row.postal_code || '',
    city: row.city || '',
    birthdate: row.birthdate || '',
    nationality: row.nationality || '',
    travelScope: row.travel_scope || '',
    notes: row.notes || '',
    passwordHash: row.password_hash || '',
    passengers: row.passengers || [],
    preferences: row.preferences || {},
    alerts: row.alerts || []
  };
}

function customerToRow(c) {
  return {
    id: c.id,
    created_at: c.createdAt,
    updated_at: c.updatedAt || null,
    name: c.name || 'Cliente',
    email: c.email,
    phone: c.phone || null,
    phone2: c.phone2 || null,
    nif: c.nif || null,
    address: c.address || null,
    postal_code: c.postalCode || null,
    city: c.city || null,
    birthdate: c.birthdate || null,
    nationality: c.nationality || null,
    travel_scope: c.travelScope || null,
    notes: c.notes || null,
    password_hash: c.passwordHash || null,
    passengers: c.passengers || [],
    preferences: c.preferences || {},
    alerts: c.alerts || []
  };
}

function rowToStaff(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at || undefined,
    name: row.name,
    email: row.email || '',
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role || 'COMERCIAL',
    color: row.color || '',
    active: row.active !== false,
    branchId: row.branch_id || undefined,
    employmentType: row.employment_type || 'INTERNO'
  };
}

function staffToRow(s) {
  return {
    id: s.id,
    created_at: s.createdAt,
    updated_at: s.updatedAt || null,
    name: s.name,
    email: s.email || null,
    username: s.username,
    password_hash: s.passwordHash,
    role: s.role || 'COMERCIAL',
    color: s.color || null,
    active: s.active !== false,
    branch_id: s.branchId || null,
    employment_type: s.employmentType || 'INTERNO'
  };
}

function rowToOpportunity(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at || undefined,
    stage: row.stage || 'NOVO_INTERESSE',
    customerName: row.customer_name || '',
    customerEmail: row.customer_email || '',
    customerPhone: row.customer_phone || '',
    destination: row.destination || '',
    dateStart: row.date_start || '',
    dateEnd: row.date_end || '',
    paxAdults: Number(row.pax_adults ?? 0),
    paxChildren: Number(row.pax_children ?? 0),
    estimatedValue: row.estimated_value ?? undefined,
    probability: row.probability ?? undefined,
    origin: row.origin || '',
    temperature: row.temperature || 'MORNO',
    tags: row.tags || [],
    commercialStaffId: row.commercial_staff_id || undefined,
    nextActionType: row.next_action_type || '',
    nextActionDate: row.next_action_date || '',
    nextActionNotes: row.next_action_notes || '',
    lossReason: row.loss_reason || '',
    lossNotes: row.loss_notes || '',
    notes: row.notes || '',
    reservationId: row.reservation_id || undefined,
    branchId: row.branch_id || undefined
  };
}

function opportunityToRow(o) {
  return {
    id: o.id,
    created_at: o.createdAt,
    updated_at: o.updatedAt || null,
    stage: o.stage || 'NOVO_INTERESSE',
    customer_name: o.customerName || null,
    customer_email: o.customerEmail || null,
    customer_phone: o.customerPhone || null,
    destination: o.destination || null,
    date_start: o.dateStart || null,
    date_end: o.dateEnd || null,
    pax_adults: o.paxAdults ?? 0,
    pax_children: o.paxChildren ?? 0,
    estimated_value: o.estimatedValue ?? null,
    probability: o.probability ?? null,
    origin: o.origin || null,
    temperature: o.temperature || 'MORNO',
    tags: o.tags || [],
    commercial_staff_id: o.commercialStaffId || null,
    next_action_type: o.nextActionType || null,
    next_action_date: o.nextActionDate || null,
    next_action_notes: o.nextActionNotes || null,
    loss_reason: o.lossReason || null,
    loss_notes: o.lossNotes || null,
    notes: o.notes || null,
    reservation_id: o.reservationId || null,
    branch_id: o.branchId || null
  };
}

function rowToOpportunityEvent(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    opportunityId: row.opportunity_id,
    actor: row.actor || undefined,
    type: row.type,
    description: row.description || ''
  };
}

function opportunityEventToRow(e) {
  return {
    id: e.id,
    created_at: e.createdAt,
    opportunity_id: e.opportunityId,
    actor: e.actor || null,
    type: e.type,
    description: e.description || null
  };
}

function rowToProposal(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at || undefined,
    opportunityId: row.opportunity_id,
    version: Number(row.version ?? 1),
    status: row.status || 'RASCUNHO',
    services: row.services || '',
    costValue: row.cost_value ?? undefined,
    saleValue: row.sale_value ?? undefined,
    notes: row.notes || ''
  };
}

function proposalToRow(p) {
  return {
    id: p.id,
    created_at: p.createdAt,
    updated_at: p.updatedAt || null,
    opportunity_id: p.opportunityId,
    version: p.version ?? 1,
    status: p.status || 'RASCUNHO',
    services: p.services || null,
    cost_value: p.costValue ?? null,
    sale_value: p.saleValue ?? null,
    notes: p.notes || null
  };
}

function rowToLead(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    source: row.source,
    status: row.status,
    search: row.search || {},
    topResult: row.top_result || undefined
  };
}

function leadToRow(l) {
  return {
    id: l.id,
    created_at: l.createdAt,
    source: l.source || 'site',
    status: l.status,
    search: l.search || {},
    top_result: l.topResult || null
  };
}

function rowToReservation(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at || undefined,
    status: row.status,
    customer: row.customer || {},
    passengers: row.passengers || [],
    offer: row.offer || {},
    operator: row.operator || undefined,
    source: row.source,
    notes: row.notes || undefined,
    paymentReceivedAt: row.payment_received_at || undefined,
    operatorValidation: row.operator_validation || undefined,
    operatorValidationAt: row.operator_validation_at || undefined,
    operatorConfirmation: row.operator_confirmation || undefined,
    operatorLocator: row.operator_locator || undefined,
    confirmedAt: row.confirmed_at || undefined,
    vatRegime: row.vat_regime || 'MARGEM',
    invoiceNumber: row.invoice_number || undefined,
    invoiceDate: row.invoice_date || undefined,
    invoiceSystem: row.invoice_system || undefined,
    postTripOk: row.post_trip_ok ?? undefined,
    postTripNotes: row.post_trip_notes || undefined,
    commercialStaffId: row.commercial_staff_id || undefined,
    operationalStaffId: row.operational_staff_id || undefined,
    financialStaffId: row.financial_staff_id || undefined,
    branchId: row.branch_id || undefined,
    origin: row.origin || undefined,
    marginConfirmed: row.margin_confirmed ?? undefined,
    marginConfirmedAt: row.margin_confirmed_at || undefined,
    marginFinal: row.margin_final ?? undefined,
    marginFinalAt: row.margin_final_at || undefined
  };
}

function reservationToRow(r) {
  return {
    id: r.id,
    created_at: r.createdAt,
    updated_at: r.updatedAt || null,
    status: r.status,
    customer: r.customer || {},
    passengers: r.passengers || [],
    offer: r.offer || {},
    operator: r.operator || null,
    source: r.source || 'site',
    notes: r.notes || null,
    payment_received_at: r.paymentReceivedAt || null,
    operator_validation: r.operatorValidation || null,
    operator_validation_at: r.operatorValidationAt || null,
    operator_confirmation: r.operatorConfirmation || null,
    operator_locator: r.operatorLocator || null,
    confirmed_at: r.confirmedAt || null,
    vat_regime: r.vatRegime || 'MARGEM',
    invoice_number: r.invoiceNumber || null,
    invoice_date: r.invoiceDate || null,
    invoice_system: r.invoiceSystem || null,
    post_trip_ok: r.postTripOk ?? null,
    post_trip_notes: r.postTripNotes || null,
    commercial_staff_id: r.commercialStaffId || null,
    operational_staff_id: r.operationalStaffId || null,
    financial_staff_id: r.financialStaffId || null,
    branch_id: r.branchId || null,
    origin: r.origin || null,
    margin_confirmed: r.marginConfirmed ?? null,
    margin_confirmed_at: r.marginConfirmedAt || null,
    margin_final: r.marginFinal ?? null,
    margin_final_at: r.marginFinalAt || null
  };
}

function rowToPayment(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    reservationId: row.reservation_id,
    method: row.method,
    amount: Number(row.amount),
    status: row.status,
    reference: row.reference || undefined,
    paidAt: row.paid_at || undefined,
    expiresAt: row.expires_at || undefined
  };
}

function paymentToRow(p) {
  return {
    id: p.id,
    created_at: p.createdAt,
    reservation_id: p.reservationId,
    method: p.method,
    amount: p.amount,
    status: p.status,
    reference: p.reference || null,
    paid_at: p.paidAt || null,
    expires_at: p.expiresAt || null
  };
}

function rowToEmail(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    to: row.recipient,
    subject: row.subject,
    body: row.body || '',
    status: row.status
  };
}

function emailToRow(e) {
  return {
    id: e.id,
    created_at: e.createdAt,
    recipient: e.to || e.recipient || 'cliente@exemplo.pt',
    subject: e.subject || 'Email Boomviagens',
    body: e.body || '',
    status: e.status || 'GERADO_DEMO'
  };
}

function rowToOperatorLog(row) {
  return { id: row.id, createdAt: row.created_at, type: row.type, payload: row.payload || {} };
}

function operatorLogToRow(l) {
  return { id: l.id, created_at: l.createdAt, type: l.type, payload: l.payload || {} };
}

function rowToAuditLog(row) {
  return { id: row.id, createdAt: row.created_at, actor: row.actor || undefined, action: row.action, payload: row.payload || {} };
}

function auditLogToRow(l) {
  return { id: l.id, created_at: l.createdAt, actor: l.actor || null, action: l.action, payload: l.payload || {} };
}

function rowToDocument(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    reservationId: row.reservation_id || undefined,
    customerEmail: row.customer_email || undefined,
    supplierId: row.supplier_id || undefined,
    serviceLineId: row.service_line_id || undefined,
    eventId: row.event_id || undefined,
    complaintId: row.complaint_id || undefined,
    paymentId: row.payment_id || undefined,
    type: row.type,
    passengerName: row.passenger_name || undefined,
    fileName: row.file_name,
    storagePath: row.storage_path,
    uploadedBy: row.uploaded_by || undefined,
    documentNumber: row.document_number || undefined,
    documentDate: row.document_date || undefined,
    amount: row.amount ?? undefined,
    expiryDate: row.expiry_date || undefined,
    issuingCountry: row.issuing_country || undefined
  };
}

function documentToRow(d) {
  return {
    id: d.id,
    created_at: d.createdAt,
    reservation_id: d.reservationId || null,
    customer_email: d.customerEmail || null,
    supplier_id: d.supplierId || null,
    service_line_id: d.serviceLineId || null,
    event_id: d.eventId || null,
    complaint_id: d.complaintId || null,
    payment_id: d.paymentId || null,
    type: d.type,
    passenger_name: d.passengerName || null,
    file_name: d.fileName,
    storage_path: d.storagePath,
    uploaded_by: d.uploadedBy || null,
    document_number: d.documentNumber || null,
    document_date: d.documentDate || null,
    amount: d.amount ?? null,
    expiry_date: d.expiryDate || null,
    issuing_country: d.issuingCountry || null
  };
}

function rowToServiceLine(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at || undefined,
    reservationId: row.reservation_id,
    type: row.type,
    description: row.description,
    supplierName: row.supplier_name || '',
    reference: row.reference || '',
    locator: row.locator || '',
    quantity: Number(row.quantity ?? 1),
    dateStart: row.date_start || '',
    dateEnd: row.date_end || '',
    status: row.status || 'NAO_CONFIRMADO',
    netValue: Number(row.net_value ?? 0),
    pvpValue: Number(row.pvp_value ?? 0),
    discountPercent: Number(row.discount_percent ?? 0),
    optionDeadline: row.option_deadline || '',
    cancellationTerms: row.cancellation_terms || '',
    paid: row.paid || false,
    paidAt: row.paid_at || undefined,
    cancelReason: row.cancel_reason || '',
    refundableAmount: row.refundable_amount ?? undefined,
    refundedAmount: row.refunded_amount ?? undefined,
    refundedAt: row.refunded_at || undefined,
    vatRegime: row.vat_regime || undefined,
    notes: row.notes || ''
  };
}

function serviceLineToRow(s) {
  return {
    id: s.id,
    created_at: s.createdAt,
    updated_at: s.updatedAt || null,
    reservation_id: s.reservationId,
    type: s.type,
    description: s.description,
    supplier_name: s.supplierName || null,
    reference: s.reference || null,
    locator: s.locator || null,
    quantity: s.quantity ?? 1,
    date_start: s.dateStart || null,
    date_end: s.dateEnd || null,
    status: s.status || 'NAO_CONFIRMADO',
    net_value: s.netValue ?? 0,
    pvp_value: s.pvpValue ?? 0,
    discount_percent: s.discountPercent ?? 0,
    option_deadline: s.optionDeadline || null,
    cancellation_terms: s.cancellationTerms || null,
    paid: s.paid || false,
    paid_at: s.paidAt || null,
    cancel_reason: s.cancelReason || null,
    refundable_amount: s.refundableAmount ?? null,
    refunded_amount: s.refundedAmount ?? null,
    refunded_at: s.refundedAt || null,
    vat_regime: s.vatRegime || null,
    notes: s.notes || null
  };
}

function rowToServiceLinePayment(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    serviceLineId: row.service_line_id,
    amount: Number(row.amount),
    paidAt: row.paid_at,
    method: row.method || '',
    reference: row.reference || '',
    notes: row.notes || ''
  };
}

function serviceLinePaymentToRow(p) {
  return {
    id: p.id,
    created_at: p.createdAt,
    service_line_id: p.serviceLineId,
    amount: p.amount,
    paid_at: p.paidAt,
    method: p.method || null,
    reference: p.reference || null,
    notes: p.notes || null
  };
}

function rowToRefund(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    reservationId: row.reservation_id,
    serviceLineId: row.service_line_id || undefined,
    direction: row.direction,
    amount: Number(row.amount),
    reason: row.reason || '',
    notes: row.notes || '',
    createdBy: row.created_by || undefined
  };
}

function refundToRow(r) {
  return {
    id: r.id,
    created_at: r.createdAt,
    reservation_id: r.reservationId,
    service_line_id: r.serviceLineId || null,
    direction: r.direction,
    amount: r.amount,
    reason: r.reason || null,
    notes: r.notes || null,
    created_by: r.createdBy || null
  };
}

function rowToReservationEvent(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    reservationId: row.reservation_id,
    actor: row.actor || undefined,
    type: row.type,
    description: row.description || '',
    resolved: row.resolved || false,
    resolution: row.resolution || ''
  };
}

function reservationEventToRow(e) {
  return {
    id: e.id,
    created_at: e.createdAt,
    reservation_id: e.reservationId,
    actor: e.actor || null,
    type: e.type,
    description: e.description || null,
    resolved: e.resolved || false,
    resolution: e.resolution || null
  };
}

function rowToSupplier(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at || undefined,
    name: row.name,
    type: row.type || 'OUTRO',
    email: row.email || '',
    phone: row.phone || '',
    nif: row.nif || '',
    notes: row.notes || ''
  };
}

function supplierToRow(s) {
  return {
    id: s.id,
    created_at: s.createdAt,
    updated_at: s.updatedAt || null,
    name: s.name,
    type: s.type || 'OUTRO',
    email: s.email || null,
    phone: s.phone || null,
    nif: s.nif || null,
    notes: s.notes || null
  };
}

function rowToContactEntry(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    customerEmail: row.customer_email,
    reservationId: row.reservation_id || undefined,
    opportunityId: row.opportunity_id || undefined,
    actor: row.actor || undefined,
    type: row.type,
    summary: row.summary || '',
    direction: row.direction || 'OUTBOUND',
    externalId: row.external_id || undefined,
    deliveryStatus: row.delivery_status || undefined
  };
}

function contactEntryToRow(c) {
  return {
    id: c.id,
    created_at: c.createdAt,
    customer_email: c.customerEmail,
    reservation_id: c.reservationId || null,
    opportunity_id: c.opportunityId || null,
    actor: c.actor || null,
    type: c.type,
    summary: c.summary || '',
    direction: c.direction || 'OUTBOUND',
    external_id: c.externalId || null,
    delivery_status: c.deliveryStatus || null
  };
}

function rowToComplaint(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at || undefined,
    customerEmail: row.customer_email,
    reservationId: row.reservation_id || undefined,
    direction: row.direction || 'CUSTOMER_TO_AGENCY',
    supplierId: row.supplier_id || undefined,
    status: row.status,
    subject: row.subject,
    description: row.description || '',
    claimedAmount: row.claimed_amount ?? undefined,
    receivedAmount: row.received_amount ?? undefined,
    paidToCustomer: row.paid_to_customer ?? undefined,
    resolution: row.resolution || '',
    resolvedAt: row.resolved_at || undefined
  };
}

function complaintToRow(c) {
  return {
    id: c.id,
    created_at: c.createdAt,
    updated_at: c.updatedAt || null,
    customer_email: c.customerEmail,
    reservation_id: c.reservationId || null,
    direction: c.direction || 'CUSTOMER_TO_AGENCY',
    supplier_id: c.supplierId || null,
    status: c.status,
    subject: c.subject,
    description: c.description || null,
    claimed_amount: c.claimedAmount ?? null,
    received_amount: c.receivedAmount ?? null,
    paid_to_customer: c.paidToCustomer ?? null,
    resolution: c.resolution || null,
    resolved_at: c.resolvedAt || null
  };
}

function rowToTask(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at || undefined,
    reservationId: row.reservation_id || undefined,
    opportunityId: row.opportunity_id || undefined,
    description: row.description,
    assignee: row.assignee || '',
    assigneeStaffId: row.assignee_staff_id || undefined,
    dueDate: row.due_date || '',
    priority: row.priority || 'NORMAL',
    status: row.status || 'TODO',
    completedAt: row.completed_at || undefined,
    notes: row.notes || ''
  };
}

function taskToRow(t) {
  return {
    id: t.id,
    created_at: t.createdAt,
    updated_at: t.updatedAt || null,
    reservation_id: t.reservationId || null,
    opportunity_id: t.opportunityId || null,
    description: t.description,
    assignee: t.assignee || null,
    assignee_staff_id: t.assigneeStaffId || null,
    due_date: t.dueDate || null,
    priority: t.priority || 'NORMAL',
    status: t.status || 'TODO',
    completed_at: t.completedAt || null,
    notes: t.notes || null
  };
}

function idemRowsToMap(rows) {
  const map = {};
  for (const row of rows || []) {
    map[row.idempotency_key] = { reservationId: row.reservation_id, paymentId: row.payment_id, createdAt: row.created_at };
  }
  return map;
}

function idemEntryToRow([key, value]) {
  return {
    idempotency_key: key,
    reservation_id: value.reservationId,
    payment_id: value.paymentId,
    created_at: value.createdAt || new Date().toISOString()
  };
}

async function readDbSupabase() {
  const [companyRows, marginRows, branchRows, staffRows, customerRows, leadRows, opportunityRows, opportunityEventRows, proposalRows, reservationRows, paymentRows, emailRows, operatorLogRows, auditLogRows, idemRows, documentRows, contactRows, complaintRows, supplierRows, serviceLineRows, serviceLinePaymentRows, refundRows, eventRows, taskRows] = await Promise.all([
    selectAll('company_settings', '&id=eq.main'),
    selectAll('margins', '&order=created_at.asc'),
    selectAll('branches', '&order=created_at.asc'),
    selectAll('staff', '&order=created_at.asc'),
    selectAll('customers', '&order=created_at.desc'),
    selectAll('leads', '&order=created_at.desc'),
    selectAll('opportunities', '&order=created_at.desc'),
    selectAll('opportunity_events', '&order=created_at.desc'),
    selectAll('proposals', '&order=created_at.desc'),
    selectAll('reservations', '&order=created_at.desc'),
    selectAll('payments', '&order=created_at.desc'),
    selectAll('emails', '&order=created_at.desc'),
    selectAll('operator_logs', '&order=created_at.desc&limit=100'),
    selectAll('audit_logs', '&order=created_at.desc&limit=200'),
    selectAll('idempotency_keys', ''),
    selectAll('documents', '&order=created_at.desc'),
    selectAll('contact_log', '&order=created_at.desc'),
    selectAll('complaints', '&order=created_at.desc'),
    selectAll('suppliers', '&order=name.asc'),
    selectAll('reservation_service_lines', '&order=created_at.asc'),
    selectAll('service_line_payments', '&order=paid_at.asc'),
    selectAll('refunds', '&order=created_at.desc'),
    selectAll('reservation_events', '&order=created_at.desc'),
    selectAll('tasks', '&order=due_date.asc')
  ]);

  return {
    company: rowToCompany((companyRows || [])[0]),
    margins: (marginRows || []).map(rowToMargin),
    branches: (branchRows || []).map(rowToBranch),
    staff: (staffRows || []).map(rowToStaff),
    customers: (customerRows || []).map(rowToCustomer),
    leads: (leadRows || []).map(rowToLead),
    opportunities: (opportunityRows || []).map(rowToOpportunity),
    opportunityEvents: (opportunityEventRows || []).map(rowToOpportunityEvent),
    proposals: (proposalRows || []).map(rowToProposal),
    reservations: (reservationRows || []).map(rowToReservation),
    payments: (paymentRows || []).map(rowToPayment),
    emails: (emailRows || []).map(rowToEmail),
    operatorLogs: (operatorLogRows || []).map(rowToOperatorLog),
    auditLogs: (auditLogRows || []).map(rowToAuditLog),
    idempotencyKeys: idemRowsToMap(idemRows),
    documents: (documentRows || []).map(rowToDocument),
    contactLog: (contactRows || []).map(rowToContactEntry),
    complaints: (complaintRows || []).map(rowToComplaint),
    suppliers: (supplierRows || []).map(rowToSupplier),
    serviceLines: (serviceLineRows || []).map(rowToServiceLine),
    serviceLinePayments: (serviceLinePaymentRows || []).map(rowToServiceLinePayment),
    refunds: (refundRows || []).map(rowToRefund),
    reservationEvents: (eventRows || []).map(rowToReservationEvent),
    tasks: (taskRows || []).map(rowToTask)
  };
}

async function writeDbSupabase(db) {
  await upsertRows('company_settings', [companyToRow(db.company)]);
  await upsertRows('margins', (db.margins || []).map(marginToRow));
  await upsertRows('branches', (db.branches || []).map(branchToRow));
  await upsertRows('staff', (db.staff || []).map(staffToRow));
  await upsertRows('customers', (db.customers || []).map(customerToRow));
  await upsertRows('leads', (db.leads || []).map(leadToRow));
  await upsertRows('reservations', (db.reservations || []).map(reservationToRow));
  await upsertRows('payments', (db.payments || []).map(paymentToRow));
  // opportunities.reservation_id referencia reservations - so pode ser
  // gravada depois de a reserva (se existir) ja ter aterrado.
  await upsertRows('opportunities', (db.opportunities || []).map(opportunityToRow));
  await Promise.all([
    upsertRows('opportunity_events', (db.opportunityEvents || []).map(opportunityEventToRow)),
    upsertRows('proposals', (db.proposals || []).map(proposalToRow)),
    upsertRows('emails', (db.emails || []).map(emailToRow)),
    upsertRows('operator_logs', (db.operatorLogs || []).map(operatorLogToRow)),
    upsertRows('audit_logs', (db.auditLogs || []).map(auditLogToRow)),
    upsertRows('documents', (db.documents || []).map(documentToRow)),
    upsertRows('contact_log', (db.contactLog || []).map(contactEntryToRow)),
    upsertRows('complaints', (db.complaints || []).map(complaintToRow)),
    upsertRows('suppliers', (db.suppliers || []).map(supplierToRow)),
    upsertRows('reservation_service_lines', (db.serviceLines || []).map(serviceLineToRow)),
    upsertRows('reservation_events', (db.reservationEvents || []).map(reservationEventToRow)),
    upsertRows('tasks', (db.tasks || []).map(taskToRow))
  ]);
  await Promise.all([
    upsertRows('service_line_payments', (db.serviceLinePayments || []).map(serviceLinePaymentToRow)),
    upsertRows('refunds', (db.refunds || []).map(refundToRow))
  ]);
  await upsertRows('idempotency_keys', Object.entries(db.idempotencyKeys || {}).map(idemEntryToRow), 'idempotency_key');
  return db;
}

// Compara o estado antes/depois do mutator e grava so as linhas que mudaram,
// para nao reenviar todo o historico (leads, reservas, emails...) a cada
// pedido. As tabelas so recebem upsert: nada e apagado do Supabase aqui.
function diffById(beforeArr = [], afterArr = []) {
  const beforeMap = new Map(beforeArr.map(item => [item.id, item]));
  return afterArr.filter(item => {
    const prev = beforeMap.get(item.id);
    return !prev || JSON.stringify(prev) !== JSON.stringify(item);
  });
}

function diffMapEntries(beforeMap = {}, afterMap = {}) {
  return Object.entries(afterMap).filter(([key, value]) => {
    const prev = beforeMap[key];
    return !prev || JSON.stringify(prev) !== JSON.stringify(value);
  });
}

async function updateDbSupabase(mutator) {
  const db = await readDbSupabase();
  const before = JSON.parse(JSON.stringify(db));
  const result = mutator(db) || db;

  const marginRows = diffById(before.margins, db.margins).map(marginToRow);
  const branchRows = diffById(before.branches, db.branches).map(branchToRow);
  const staffRows = diffById(before.staff, db.staff).map(staffToRow);
  const customerRows = diffById(before.customers, db.customers).map(customerToRow);
  const leadRows = diffById(before.leads, db.leads).map(leadToRow);
  const opportunityRows = diffById(before.opportunities, db.opportunities).map(opportunityToRow);
  const opportunityEventRows = diffById(before.opportunityEvents, db.opportunityEvents).map(opportunityEventToRow);
  const proposalRows = diffById(before.proposals, db.proposals).map(proposalToRow);
  const reservationRows = diffById(before.reservations, db.reservations).map(reservationToRow);
  const paymentRows = diffById(before.payments, db.payments).map(paymentToRow);
  const emailRows = diffById(before.emails, db.emails).map(emailToRow);
  const operatorLogRows = diffById(before.operatorLogs, db.operatorLogs).map(operatorLogToRow);
  const auditLogRows = diffById(before.auditLogs, db.auditLogs).map(auditLogToRow);
  const documentRows = diffById(before.documents, db.documents).map(documentToRow);
  const contactRows = diffById(before.contactLog, db.contactLog).map(contactEntryToRow);
  const complaintRows = diffById(before.complaints, db.complaints).map(complaintToRow);
  const supplierRows = diffById(before.suppliers, db.suppliers).map(supplierToRow);
  const serviceLineRows = diffById(before.serviceLines, db.serviceLines).map(serviceLineToRow);
  const serviceLinePaymentRows = diffById(before.serviceLinePayments, db.serviceLinePayments).map(serviceLinePaymentToRow);
  const refundRows = diffById(before.refunds, db.refunds).map(refundToRow);
  const eventRows = diffById(before.reservationEvents, db.reservationEvents).map(reservationEventToRow);
  const taskRows = diffById(before.tasks, db.tasks).map(taskToRow);
  const idemRows = diffMapEntries(before.idempotencyKeys, db.idempotencyKeys).map(idemEntryToRow);

  const firstTasks = [];
  if (JSON.stringify(before.company) !== JSON.stringify(db.company)) {
    firstTasks.push(upsertRows('company_settings', [companyToRow(db.company)]));
  }
  firstTasks.push(upsertRows('margins', marginRows));
  // branches e escrito antes de staff/reservations/opportunities (todos
  // referenciam branch_id) - mesmo principio do comentario abaixo sobre
  // reservations ter de aterrar antes de opportunities.
  firstTasks.push(upsertRows('branches', branchRows));
  firstTasks.push(upsertRows('staff', staffRows));
  firstTasks.push(upsertRows('customers', customerRows));
  firstTasks.push(upsertRows('leads', leadRows));
  firstTasks.push(upsertRows('reservations', reservationRows));

  const beforeDocIds = new Set((before.documents || []).map(d => d.id));
  const afterDocIds = new Set((db.documents || []).map(d => d.id));
  const removedDocIds = [...beforeDocIds].filter(docId => !afterDocIds.has(docId));
  const beforeServiceLineIds = new Set((before.serviceLines || []).map(s => s.id));
  const afterServiceLineIds = new Set((db.serviceLines || []).map(s => s.id));
  const removedServiceLineIds = [...beforeServiceLineIds].filter(lineId => !afterServiceLineIds.has(lineId));
  await Promise.all(firstTasks);
  await upsertRows('payments', paymentRows);
  // opportunities.reservation_id pode apontar para uma reserva criada na
  // mesma mutacao (conversao Ganho -> processo) - so pode ser gravada
  // depois de reservations (fase anterior) ja ter aterrado.
  await upsertRows('opportunities', opportunityRows);
  // Linhas de servico removidas tem de ser apagadas antes dos documentos
  // (que podem referenciar service_line_id) para nao violar a FK.
  if (removedServiceLineIds.length) await deleteRows('reservation_service_lines', removedServiceLineIds);
  const thirdTasks = [
    upsertRows('opportunity_events', opportunityEventRows),
    upsertRows('proposals', proposalRows),
    upsertRows('emails', emailRows),
    upsertRows('operator_logs', operatorLogRows),
    upsertRows('audit_logs', auditLogRows),
    upsertRows('documents', documentRows),
    upsertRows('contact_log', contactRows),
    upsertRows('complaints', complaintRows),
    upsertRows('suppliers', supplierRows),
    upsertRows('reservation_service_lines', serviceLineRows),
    upsertRows('reservation_events', eventRows),
    upsertRows('tasks', taskRows)
  ];
  if (removedDocIds.length) thirdTasks.push(deleteRows('documents', removedDocIds));
  await Promise.all(thirdTasks);
  // service_line_payments/refunds referenciam reservation_service_lines
  // (e refunds tambem reservations) - so podem ser gravados depois de
  // ambas ja terem aterrado, por isso ficam de fora do thirdTasks.
  await Promise.all([
    upsertRows('service_line_payments', serviceLinePaymentRows),
    upsertRows('refunds', refundRows)
  ]);
  await upsertRows('idempotency_keys', idemRows, 'idempotency_key');
  return result;
}

// ---------------------------------------------------------------------------
// API publica do modulo. readDb/writeDb/updateDb sao sempre assincronas
// (precisam de await), mesmo no backend local, para que o chamador nao
// precise de saber qual o backend ativo.
// ---------------------------------------------------------------------------

async function readDb() {
  if (useSupabase) return readDbSupabase();
  if (useSqlite) return readDbSqlite();
  return readDbLocal();
}

async function writeDb(db) {
  if (useSupabase) return writeDbSupabase(db);
  if (useSqlite) return writeDbSqlite(db);
  return writeDbLocal(db);
}

async function updateDb(mutator) {
  if (useSupabase) return updateDbSupabase(mutator);
  if (useSqlite) return updateDbSqlite(mutator);
  const db = readDbLocal();
  const result = mutator(db) || db;
  writeDbLocal(db);
  return result;
}

const mode = useSupabase ? 'supabase' : useSqlite ? 'sqlite' : 'local';
module.exports = { readDb, writeDb, updateDb, DB_PATH, SQLITE_PATH, mode };
