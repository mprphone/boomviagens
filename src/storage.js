const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseConfigured = Boolean(
  SUPABASE_URL && !SUPABASE_URL.includes('PROJECT_REF') &&
  SUPABASE_SERVICE_ROLE_KEY && !SUPABASE_SERVICE_ROLE_KEY.includes('colocar_')
);

const useSupabase = process.env.DB_MODE === 'supabase' && supabaseConfigured;

if (process.env.DB_MODE === 'supabase' && !supabaseConfigured) {
  console.warn('[storage] DB_MODE=supabase mas SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY nao estao definidos corretamente. A usar data/db.json local (nao persistente em Vercel).');
}

// ---------------------------------------------------------------------------
// Backend local: ficheiro JSON. So serve para desenvolvimento; em Vercel o
// sistema de ficheiros e efemero, por isso este backend nao deve ser usado
// em producao (usar DB_MODE=supabase).
// ---------------------------------------------------------------------------

function readDbLocal() {
  if (!fs.existsSync(DB_PATH)) throw new Error(`DB não encontrada: ${DB_PATH}`);
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

function rowToCustomer(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at || undefined,
    name: row.name,
    email: row.email,
    phone: row.phone || '',
    passengers: row.passengers || []
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
    passengers: c.passengers || []
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
    confirmedAt: row.confirmed_at || undefined
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
    confirmed_at: r.confirmedAt || null
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
    reservationId: row.reservation_id,
    type: row.type,
    passengerName: row.passenger_name || undefined,
    fileName: row.file_name,
    storagePath: row.storage_path,
    uploadedBy: row.uploaded_by || undefined
  };
}

function documentToRow(d) {
  return {
    id: d.id,
    created_at: d.createdAt,
    reservation_id: d.reservationId,
    type: d.type,
    passenger_name: d.passengerName || null,
    file_name: d.fileName,
    storage_path: d.storagePath,
    uploaded_by: d.uploadedBy || null
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
  const [companyRows, marginRows, customerRows, leadRows, reservationRows, paymentRows, emailRows, operatorLogRows, auditLogRows, idemRows, documentRows] = await Promise.all([
    selectAll('company_settings', '&id=eq.main'),
    selectAll('margins', '&order=created_at.asc'),
    selectAll('customers', '&order=created_at.desc'),
    selectAll('leads', '&order=created_at.desc'),
    selectAll('reservations', '&order=created_at.desc'),
    selectAll('payments', '&order=created_at.desc'),
    selectAll('emails', '&order=created_at.desc'),
    selectAll('operator_logs', '&order=created_at.desc&limit=100'),
    selectAll('audit_logs', '&order=created_at.desc&limit=200'),
    selectAll('idempotency_keys', ''),
    selectAll('documents', '&order=created_at.desc')
  ]);

  return {
    company: rowToCompany((companyRows || [])[0]),
    margins: (marginRows || []).map(rowToMargin),
    customers: (customerRows || []).map(rowToCustomer),
    leads: (leadRows || []).map(rowToLead),
    reservations: (reservationRows || []).map(rowToReservation),
    payments: (paymentRows || []).map(rowToPayment),
    emails: (emailRows || []).map(rowToEmail),
    operatorLogs: (operatorLogRows || []).map(rowToOperatorLog),
    auditLogs: (auditLogRows || []).map(rowToAuditLog),
    idempotencyKeys: idemRowsToMap(idemRows),
    documents: (documentRows || []).map(rowToDocument)
  };
}

async function writeDbSupabase(db) {
  await Promise.all([
    upsertRows('company_settings', [companyToRow(db.company)]),
    upsertRows('margins', (db.margins || []).map(marginToRow)),
    upsertRows('customers', (db.customers || []).map(customerToRow)),
    upsertRows('leads', (db.leads || []).map(leadToRow)),
    upsertRows('reservations', (db.reservations || []).map(reservationToRow)),
    upsertRows('payments', (db.payments || []).map(paymentToRow)),
    upsertRows('emails', (db.emails || []).map(emailToRow)),
    upsertRows('operator_logs', (db.operatorLogs || []).map(operatorLogToRow)),
    upsertRows('audit_logs', (db.auditLogs || []).map(auditLogToRow)),
    upsertRows('idempotency_keys', Object.entries(db.idempotencyKeys || {}).map(idemEntryToRow), 'idempotency_key'),
    upsertRows('documents', (db.documents || []).map(documentToRow))
  ]);
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

  const tasks = [];
  if (JSON.stringify(before.company) !== JSON.stringify(db.company)) {
    tasks.push(upsertRows('company_settings', [companyToRow(db.company)]));
  }
  tasks.push(upsertRows('margins', diffById(before.margins, db.margins).map(marginToRow)));
  tasks.push(upsertRows('customers', diffById(before.customers, db.customers).map(customerToRow)));
  tasks.push(upsertRows('leads', diffById(before.leads, db.leads).map(leadToRow)));
  tasks.push(upsertRows('reservations', diffById(before.reservations, db.reservations).map(reservationToRow)));
  tasks.push(upsertRows('payments', diffById(before.payments, db.payments).map(paymentToRow)));
  tasks.push(upsertRows('emails', diffById(before.emails, db.emails).map(emailToRow)));
  tasks.push(upsertRows('operator_logs', diffById(before.operatorLogs, db.operatorLogs).map(operatorLogToRow)));
  tasks.push(upsertRows('audit_logs', diffById(before.auditLogs, db.auditLogs).map(auditLogToRow)));
  tasks.push(upsertRows('idempotency_keys', diffMapEntries(before.idempotencyKeys, db.idempotencyKeys).map(idemEntryToRow), 'idempotency_key'));
  tasks.push(upsertRows('documents', diffById(before.documents, db.documents).map(documentToRow)));

  const beforeDocIds = new Set((before.documents || []).map(d => d.id));
  const afterDocIds = new Set((db.documents || []).map(d => d.id));
  const removedDocIds = [...beforeDocIds].filter(docId => !afterDocIds.has(docId));
  if (removedDocIds.length) tasks.push(deleteRows('documents', removedDocIds));

  await Promise.all(tasks);
  return result;
}

// ---------------------------------------------------------------------------
// API publica do modulo. readDb/writeDb/updateDb sao sempre assincronas
// (precisam de await), mesmo no backend local, para que o chamador nao
// precise de saber qual o backend ativo.
// ---------------------------------------------------------------------------

async function readDb() {
  return useSupabase ? readDbSupabase() : readDbLocal();
}

async function writeDb(db) {
  return useSupabase ? writeDbSupabase(db) : writeDbLocal(db);
}

async function updateDb(mutator) {
  if (useSupabase) return updateDbSupabase(mutator);
  const db = readDbLocal();
  const result = mutator(db) || db;
  writeDbLocal(db);
  return result;
}

module.exports = { readDb, writeDb, updateDb, DB_PATH, mode: useSupabase ? 'supabase' : 'local' };
