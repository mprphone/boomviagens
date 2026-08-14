// Backend SQLite (node:sqlite, nativo do Node - sem dependencia externa nem
// compilacao nativa). Fica num ficheiro local (data/boomviagens.sqlite),
// mas ao contrario do JSON local e SQL a serio: tabelas, indices, e da para
// abrir com qualquer cliente SQLite para inspecionar os dados.
//
// node:sqlite ainda esta marcado "experimental" no Node (o aviso aparece no
// arranque) - a API pode mudar em versoes futuras do Node. Exige Node 22.5+
// (este projeto testado em Node 24).
//
// Nao resolve por si so o deploy em serverless (Vercel): o sistema de
// ficheiros e efemero la, o mesmo problema que o JSON local ja tinha. Serve
// para desenvolvimento/testes locais reais sem depender do Supabase estar
// provisionado.

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const SQLITE_PATH = path.join(__dirname, '..', 'data', 'boomviagens.sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS company_settings (
  id TEXT PRIMARY KEY,
  name TEXT, brand TEXT, domain TEXT, email TEXT, phone TEXT, nif TEXT, rnavt TEXT,
  address TEXT, cae TEXT, market_country TEXT, currency TEXT, price_type TEXT,
  commission_included INTEGER, confirmation_mode TEXT, default_margin_percent REAL
);
CREATE TABLE IF NOT EXISTS margins (
  id TEXT PRIMARY KEY, name TEXT, match_rule TEXT, percent REAL, min_value REAL,
  round_to REAL, active INTEGER
);
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, name TEXT, email TEXT,
  phone TEXT, phone2 TEXT, nif TEXT, address TEXT, postal_code TEXT, city TEXT,
  birthdate TEXT, travel_scope TEXT, passengers TEXT, notes TEXT, password_hash TEXT
);
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, source TEXT, status TEXT,
  search TEXT, top_result TEXT
);
CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, status TEXT, customer TEXT,
  passengers TEXT, offer TEXT, operator TEXT, source TEXT, notes TEXT,
  payment_received_at TEXT, operator_validation TEXT, operator_validation_at TEXT,
  operator_confirmation TEXT, operator_locator TEXT, confirmed_at TEXT,
  vat_regime TEXT, invoice_number TEXT, invoice_date TEXT, invoice_system TEXT
);
CREATE INDEX IF NOT EXISTS reservations_status_idx ON reservations(status);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY, created_at TEXT, reservation_id TEXT, method TEXT, amount REAL,
  status TEXT, reference TEXT, paid_at TEXT, expires_at TEXT
);
CREATE INDEX IF NOT EXISTS payments_reservation_idx ON payments(reservation_id);
CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY, created_at TEXT, recipient TEXT, subject TEXT, body TEXT, status TEXT
);
CREATE TABLE IF NOT EXISTS operator_logs (
  id TEXT PRIMARY KEY, created_at TEXT, type TEXT, payload TEXT
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, created_at TEXT, actor TEXT, action TEXT, payload TEXT
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  idempotency_key TEXT PRIMARY KEY, reservation_id TEXT, payment_id TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS reservation_service_lines (
  id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, reservation_id TEXT, type TEXT, description TEXT,
  supplier_name TEXT, reference TEXT, quantity REAL, date_start TEXT, date_end TEXT, status TEXT,
  net_value REAL, pvp_value REAL, discount_percent REAL, notes TEXT
);
CREATE INDEX IF NOT EXISTS reservation_service_lines_reservation_idx ON reservation_service_lines(reservation_id);
CREATE TABLE IF NOT EXISTS reservation_events (
  id TEXT PRIMARY KEY, created_at TEXT, reservation_id TEXT, actor TEXT, type TEXT, description TEXT
);
CREATE INDEX IF NOT EXISTS reservation_events_reservation_idx ON reservation_events(reservation_id);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, created_at TEXT, reservation_id TEXT, customer_email TEXT, supplier_id TEXT, service_line_id TEXT,
  type TEXT, passenger_name TEXT, file_name TEXT, storage_path TEXT, uploaded_by TEXT
);
CREATE INDEX IF NOT EXISTS documents_reservation_idx ON documents(reservation_id);
CREATE INDEX IF NOT EXISTS documents_customer_idx ON documents(customer_email);
CREATE INDEX IF NOT EXISTS documents_supplier_idx ON documents(supplier_id);
CREATE INDEX IF NOT EXISTS documents_service_line_idx ON documents(service_line_id);
CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, name TEXT, type TEXT,
  email TEXT, phone TEXT, nif TEXT, notes TEXT
);
CREATE TABLE IF NOT EXISTS contact_log (
  id TEXT PRIMARY KEY, created_at TEXT, customer_email TEXT, actor TEXT, type TEXT, summary TEXT
);
CREATE INDEX IF NOT EXISTS contact_log_customer_idx ON contact_log(customer_email);
CREATE TABLE IF NOT EXISTS complaints (
  id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, customer_email TEXT, reservation_id TEXT,
  status TEXT, subject TEXT, description TEXT, resolution TEXT, resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS complaints_customer_idx ON complaints(customer_email);
`;

const DEFAULT_COMPANY = () => ({
  id: 'main',
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
});

// Margens e dados de empresa por omissao - as mesmas que ja existiam em
// data/db.json, para o SQLite nao arrancar vazio (sem margens, os precos
// caem todos na regra geral fixa do pricing.js, o que funciona mas nao
// reflete a configuracao real do negocio).
const DEFAULT_MARGINS = [
  { id: 'm-caribe', name: 'Caraíbas', match: 'caraibas,punta cana,riviera maya,cancun,mexico,república dominicana', percent: 5, min: 0, roundTo: 5, active: true },
  { id: 'm-europa', name: 'Europa', match: 'paris,disney,espanha,ilhas,europa,madeira,açores', percent: 5, min: 0, roundTo: 5, active: true },
  { id: 'm-luxo', name: 'Longo curso / luxo', match: 'maldivas,bali,dubai,mauricias,zanzibar', percent: 5, min: 0, roundTo: 10, active: true },
  { id: 'm-default', name: 'Regra geral', match: '*', percent: 5, min: 0, roundTo: 5, active: true }
];

let db = null;

function seedIfEmpty(conn) {
  const { count } = conn.prepare('SELECT COUNT(*) AS count FROM margins').get();
  if (count > 0) return;
  const insMargin = conn.prepare('INSERT INTO margins (id, name, match_rule, percent, min_value, round_to, active) VALUES (?,?,?,?,?,?,?)');
  for (const m of DEFAULT_MARGINS) insMargin.run(m.id, m.name, m.match, m.percent, m.min, m.roundTo, m.active ? 1 : 0);
  const c = DEFAULT_COMPANY();
  conn.prepare(`INSERT INTO company_settings (id, name, brand, domain, email, phone, nif, rnavt, address, cae, market_country, currency, price_type, commission_included, confirmation_mode, default_margin_percent)
    VALUES ('main', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(c.name, c.brand, c.domain || null, c.email || null, c.phone || null, c.nif || null, c.rnavt || null, c.address || null, c.cae || null, c.marketCountry, c.currency, c.priceType, c.commissionIncluded ? 1 : 0, c.confirmationMode, c.defaultMarginPercent);
}

function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(SQLITE_PATH), { recursive: true });
  db = new DatabaseSync(SQLITE_PATH);
  db.exec(SCHEMA);
  seedIfEmpty(db);
  return db;
}

const j = value => JSON.stringify(value ?? null);
const parseJ = (text, fallback) => { try { return text ? JSON.parse(text) : fallback; } catch { return fallback; } };

function rowToCompany(row) {
  if (!row) return DEFAULT_COMPANY();
  return {
    name: row.name, brand: row.brand, domain: row.domain || '', email: row.email || '',
    phone: row.phone || '', nif: row.nif || '', rnavt: row.rnavt || '', address: row.address || '',
    cae: row.cae || '', marketCountry: row.market_country, currency: row.currency, priceType: row.price_type,
    commissionIncluded: Boolean(row.commission_included), confirmationMode: row.confirmation_mode,
    defaultMarginPercent: Number(row.default_margin_percent)
  };
}

function rowToMargin(row) {
  return { id: row.id, name: row.name, match: row.match_rule, percent: Number(row.percent), min: Number(row.min_value), roundTo: Number(row.round_to), active: Boolean(row.active) };
}

function rowToCustomer(row) {
  return {
    id: row.id, createdAt: row.created_at, updatedAt: row.updated_at || undefined, name: row.name, email: row.email,
    phone: row.phone || '', phone2: row.phone2 || '', nif: row.nif || '', address: row.address || '',
    postalCode: row.postal_code || '', city: row.city || '', birthdate: row.birthdate || '', travelScope: row.travel_scope || '',
    passengers: parseJ(row.passengers, []), notes: row.notes || undefined, passwordHash: row.password_hash || ''
  };
}

function rowToLead(row) {
  return { id: row.id, createdAt: row.created_at, updatedAt: row.updated_at || undefined, source: row.source, status: row.status, search: parseJ(row.search, {}), topResult: parseJ(row.top_result, undefined) };
}

function rowToReservation(row) {
  return {
    id: row.id, createdAt: row.created_at, updatedAt: row.updated_at || undefined, status: row.status,
    customer: parseJ(row.customer, {}), passengers: parseJ(row.passengers, []), offer: parseJ(row.offer, {}),
    operator: row.operator || undefined, source: row.source, notes: row.notes || undefined,
    paymentReceivedAt: row.payment_received_at || undefined, operatorValidation: row.operator_validation || undefined,
    operatorValidationAt: row.operator_validation_at || undefined, operatorConfirmation: row.operator_confirmation || undefined,
    operatorLocator: row.operator_locator || undefined, confirmedAt: row.confirmed_at || undefined,
    vatRegime: row.vat_regime || 'MARGEM', invoiceNumber: row.invoice_number || undefined,
    invoiceDate: row.invoice_date || undefined, invoiceSystem: row.invoice_system || undefined
  };
}

function rowToPayment(row) {
  return { id: row.id, createdAt: row.created_at, reservationId: row.reservation_id, method: row.method, amount: Number(row.amount), status: row.status, reference: row.reference || undefined, paidAt: row.paid_at || undefined, expiresAt: row.expires_at || undefined };
}

function rowToEmail(row) {
  return { id: row.id, createdAt: row.created_at, to: row.recipient, subject: row.subject, body: row.body || '', status: row.status };
}

function rowToOperatorLog(row) {
  return { id: row.id, createdAt: row.created_at, type: row.type, payload: parseJ(row.payload, {}) };
}

function rowToAuditLog(row) {
  return { id: row.id, createdAt: row.created_at, actor: row.actor || undefined, action: row.action, payload: parseJ(row.payload, {}) };
}

function rowToDocument(row) {
  return { id: row.id, createdAt: row.created_at, reservationId: row.reservation_id || undefined, customerEmail: row.customer_email || undefined, supplierId: row.supplier_id || undefined, serviceLineId: row.service_line_id || undefined, type: row.type, passengerName: row.passenger_name || undefined, fileName: row.file_name, storagePath: row.storage_path, uploadedBy: row.uploaded_by || undefined };
}

function rowToServiceLine(row) {
  return {
    id: row.id, createdAt: row.created_at, updatedAt: row.updated_at || undefined, reservationId: row.reservation_id,
    type: row.type, description: row.description, supplierName: row.supplier_name || '', reference: row.reference || '',
    quantity: Number(row.quantity ?? 1), dateStart: row.date_start || '', dateEnd: row.date_end || '',
    status: row.status || 'PENDENTE', netValue: Number(row.net_value ?? 0), pvpValue: Number(row.pvp_value ?? 0),
    discountPercent: Number(row.discount_percent ?? 0), notes: row.notes || ''
  };
}

function rowToReservationEvent(row) {
  return { id: row.id, createdAt: row.created_at, reservationId: row.reservation_id, actor: row.actor || undefined, type: row.type, description: row.description || '' };
}

function rowToSupplier(row) {
  return { id: row.id, createdAt: row.created_at, updatedAt: row.updated_at || undefined, name: row.name, type: row.type || 'OUTRO', email: row.email || '', phone: row.phone || '', nif: row.nif || '', notes: row.notes || '' };
}

function rowToContactEntry(row) {
  return { id: row.id, createdAt: row.created_at, customerEmail: row.customer_email, actor: row.actor || undefined, type: row.type, summary: row.summary || '' };
}

function rowToComplaint(row) {
  return {
    id: row.id, createdAt: row.created_at, updatedAt: row.updated_at || undefined, customerEmail: row.customer_email,
    reservationId: row.reservation_id || undefined, status: row.status, subject: row.subject,
    description: row.description || '', resolution: row.resolution || '', resolvedAt: row.resolved_at || undefined
  };
}

function readDbSqlite() {
  const conn = getDb();
  const all = table => conn.prepare(`SELECT * FROM ${table}`).all();
  const companyRow = conn.prepare('SELECT * FROM company_settings WHERE id = ?').get('main');
  const idemRows = all('idempotency_keys');
  const idempotencyKeys = {};
  for (const row of idemRows) idempotencyKeys[row.idempotency_key] = { reservationId: row.reservation_id, paymentId: row.payment_id, createdAt: row.created_at };

  return {
    company: rowToCompany(companyRow),
    margins: all('margins').map(rowToMargin),
    customers: conn.prepare('SELECT * FROM customers ORDER BY created_at DESC').all().map(rowToCustomer),
    leads: conn.prepare('SELECT * FROM leads ORDER BY created_at DESC').all().map(rowToLead),
    reservations: conn.prepare('SELECT * FROM reservations ORDER BY created_at DESC').all().map(rowToReservation),
    payments: conn.prepare('SELECT * FROM payments ORDER BY created_at DESC').all().map(rowToPayment),
    emails: conn.prepare('SELECT * FROM emails ORDER BY created_at DESC').all().map(rowToEmail),
    operatorLogs: conn.prepare('SELECT * FROM operator_logs ORDER BY created_at DESC LIMIT 100').all().map(rowToOperatorLog),
    auditLogs: conn.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200').all().map(rowToAuditLog),
    idempotencyKeys,
    documents: conn.prepare('SELECT * FROM documents ORDER BY created_at DESC').all().map(rowToDocument),
    contactLog: conn.prepare('SELECT * FROM contact_log ORDER BY created_at DESC').all().map(rowToContactEntry),
    complaints: conn.prepare('SELECT * FROM complaints ORDER BY created_at DESC').all().map(rowToComplaint),
    suppliers: conn.prepare('SELECT * FROM suppliers ORDER BY name ASC').all().map(rowToSupplier),
    serviceLines: conn.prepare('SELECT * FROM reservation_service_lines ORDER BY created_at ASC').all().map(rowToServiceLine),
    reservationEvents: conn.prepare('SELECT * FROM reservation_events ORDER BY created_at DESC').all().map(rowToReservationEvent)
  };
}

// Reescreve tudo dentro de uma transacao: mais simples e correto do que
// comparar antes/depois (como o backend Supabase faz para poupar pedidos de
// rede) - aqui e um ficheiro local, o custo de reescrever e insignificante.
function writeDbSqlite(dbState) {
  const conn = getDb();
  conn.exec('BEGIN');
  try {
    const c = dbState.company || DEFAULT_COMPANY();
    conn.prepare(`INSERT INTO company_settings (id, name, brand, domain, email, phone, nif, rnavt, address, cae, market_country, currency, price_type, commission_included, confirmation_mode, default_margin_percent)
      VALUES ('main', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, brand=excluded.brand, domain=excluded.domain, email=excluded.email, phone=excluded.phone, nif=excluded.nif, rnavt=excluded.rnavt, address=excluded.address, cae=excluded.cae, market_country=excluded.market_country, currency=excluded.currency, price_type=excluded.price_type, commission_included=excluded.commission_included, confirmation_mode=excluded.confirmation_mode, default_margin_percent=excluded.default_margin_percent`)
      .run(c.name, c.brand, c.domain || null, c.email || null, c.phone || null, c.nif || null, c.rnavt || null, c.address || null, c.cae || null, c.marketCountry || 'PT', c.currency || 'EUR', c.priceType || 'PVP', c.commissionIncluded !== false ? 1 : 0, c.confirmationMode || 'automatic', c.defaultMarginPercent ?? 5);

    const tables = ['margins', 'customers', 'leads', 'reservations', 'payments', 'emails', 'operator_logs', 'audit_logs', 'idempotency_keys', 'documents', 'contact_log', 'complaints', 'suppliers', 'reservation_service_lines', 'reservation_events'];
    for (const t of tables) conn.exec(`DELETE FROM ${t}`);

    const insMargin = conn.prepare('INSERT INTO margins (id, name, match_rule, percent, min_value, round_to, active) VALUES (?,?,?,?,?,?,?)');
    for (const m of dbState.margins || []) insMargin.run(m.id, m.name, m.match || '*', m.percent ?? 5, m.min ?? 0, m.roundTo ?? 5, m.active !== false ? 1 : 0);

    const insCustomer = conn.prepare('INSERT INTO customers (id, created_at, updated_at, name, email, phone, phone2, nif, address, postal_code, city, birthdate, travel_scope, passengers, notes, password_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const c2 of dbState.customers || []) insCustomer.run(c2.id, c2.createdAt, c2.updatedAt || null, c2.name || 'Cliente', c2.email, c2.phone || null, c2.phone2 || null, c2.nif || null, c2.address || null, c2.postalCode || null, c2.city || null, c2.birthdate || null, c2.travelScope || null, j(c2.passengers || []), c2.notes || null, c2.passwordHash || null);

    const insLead = conn.prepare('INSERT INTO leads (id, created_at, updated_at, source, status, search, top_result) VALUES (?,?,?,?,?,?,?)');
    for (const l of dbState.leads || []) insLead.run(l.id, l.createdAt, l.updatedAt || null, l.source || 'site', l.status, j(l.search || {}), j(l.topResult));

    const insRes = conn.prepare(`INSERT INTO reservations (id, created_at, updated_at, status, customer, passengers, offer, operator, source, notes, payment_received_at, operator_validation, operator_validation_at, operator_confirmation, operator_locator, confirmed_at, vat_regime, invoice_number, invoice_date, invoice_system) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const r of dbState.reservations || []) insRes.run(r.id, r.createdAt, r.updatedAt || null, r.status, j(r.customer || {}), j(r.passengers || []), j(r.offer || {}), r.operator || null, r.source || 'site', r.notes || null, r.paymentReceivedAt || null, r.operatorValidation || null, r.operatorValidationAt || null, r.operatorConfirmation || null, r.operatorLocator || null, r.confirmedAt || null, r.vatRegime || 'MARGEM', r.invoiceNumber || null, r.invoiceDate || null, r.invoiceSystem || null);

    const insPay = conn.prepare('INSERT INTO payments (id, created_at, reservation_id, method, amount, status, reference, paid_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?)');
    for (const p of dbState.payments || []) insPay.run(p.id, p.createdAt, p.reservationId, p.method, p.amount, p.status, p.reference || null, p.paidAt || null, p.expiresAt || null);

    const insEmail = conn.prepare('INSERT INTO emails (id, created_at, recipient, subject, body, status) VALUES (?,?,?,?,?,?)');
    for (const e of dbState.emails || []) insEmail.run(e.id, e.createdAt, e.to || e.recipient || 'cliente@exemplo.pt', e.subject || 'Email Boomviagens', e.body || '', e.status || 'GERADO_DEMO');

    const insLog = conn.prepare('INSERT INTO operator_logs (id, created_at, type, payload) VALUES (?,?,?,?)');
    for (const l of dbState.operatorLogs || []) insLog.run(l.id, l.createdAt, l.type, j(l.payload || {}));

    const insAudit = conn.prepare('INSERT INTO audit_logs (id, created_at, actor, action, payload) VALUES (?,?,?,?,?)');
    for (const a of dbState.auditLogs || []) insAudit.run(a.id, a.createdAt, a.actor || null, a.action, j(a.payload || {}));

    const insIdem = conn.prepare('INSERT INTO idempotency_keys (idempotency_key, reservation_id, payment_id, created_at) VALUES (?,?,?,?)');
    for (const [key, value] of Object.entries(dbState.idempotencyKeys || {})) insIdem.run(key, value.reservationId, value.paymentId, value.createdAt || new Date().toISOString());

    const insServiceLine = conn.prepare('INSERT INTO reservation_service_lines (id, created_at, updated_at, reservation_id, type, description, supplier_name, reference, quantity, date_start, date_end, status, net_value, pvp_value, discount_percent, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const s of dbState.serviceLines || []) insServiceLine.run(s.id, s.createdAt, s.updatedAt || null, s.reservationId, s.type, s.description, s.supplierName || null, s.reference || null, s.quantity ?? 1, s.dateStart || null, s.dateEnd || null, s.status || 'PENDENTE', s.netValue ?? 0, s.pvpValue ?? 0, s.discountPercent ?? 0, s.notes || null);

    const insEvent = conn.prepare('INSERT INTO reservation_events (id, created_at, reservation_id, actor, type, description) VALUES (?,?,?,?,?,?)');
    for (const e of dbState.reservationEvents || []) insEvent.run(e.id, e.createdAt, e.reservationId, e.actor || null, e.type, e.description || null);

    const insDoc = conn.prepare('INSERT INTO documents (id, created_at, reservation_id, customer_email, supplier_id, service_line_id, type, passenger_name, file_name, storage_path, uploaded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    for (const d of dbState.documents || []) insDoc.run(d.id, d.createdAt, d.reservationId || null, d.customerEmail || null, d.supplierId || null, d.serviceLineId || null, d.type, d.passengerName || null, d.fileName, d.storagePath, d.uploadedBy || null);

    const insSupplier = conn.prepare('INSERT INTO suppliers (id, created_at, updated_at, name, type, email, phone, nif, notes) VALUES (?,?,?,?,?,?,?,?,?)');
    for (const s of dbState.suppliers || []) insSupplier.run(s.id, s.createdAt, s.updatedAt || null, s.name, s.type || 'OUTRO', s.email || null, s.phone || null, s.nif || null, s.notes || null);

    const insContact = conn.prepare('INSERT INTO contact_log (id, created_at, customer_email, actor, type, summary) VALUES (?,?,?,?,?,?)');
    for (const c3 of dbState.contactLog || []) insContact.run(c3.id, c3.createdAt, c3.customerEmail, c3.actor || null, c3.type, c3.summary || '');

    const insComplaint = conn.prepare('INSERT INTO complaints (id, created_at, updated_at, customer_email, reservation_id, status, subject, description, resolution, resolved_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
    for (const co of dbState.complaints || []) insComplaint.run(co.id, co.createdAt, co.updatedAt || null, co.customerEmail, co.reservationId || null, co.status, co.subject, co.description || null, co.resolution || null, co.resolvedAt || null);

    conn.exec('COMMIT');
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
  return dbState;
}

function updateDbSqlite(mutator) {
  const current = readDbSqlite();
  const result = mutator(current) || current;
  writeDbSqlite(current);
  return result;
}

module.exports = { readDbSqlite, writeDbSqlite, updateDbSqlite, SQLITE_PATH };
