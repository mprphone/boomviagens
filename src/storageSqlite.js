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
  id TEXT PRIMARY KEY, name TEXT, match_rule TEXT,
  operator_name TEXT NOT NULL DEFAULT '*', channel TEXT NOT NULL DEFAULT '*', product_type TEXT NOT NULL DEFAULT '*',
  percent REAL, minimum_percent REAL NOT NULL DEFAULT 0, rebate_percent REAL NOT NULL DEFAULT 0, min_value REAL,
  round_to REAL, active INTEGER
);
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, name TEXT, email TEXT,
  phone TEXT, phone2 TEXT, nif TEXT, address TEXT, postal_code TEXT, city TEXT,
  birthdate TEXT, nationality TEXT, travel_scope TEXT, passengers TEXT, notes TEXT, password_hash TEXT,
  preferences TEXT, alerts TEXT
);
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, source TEXT, status TEXT,
  search TEXT, top_result TEXT
);
CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, name TEXT, code TEXT,
  address TEXT, phone TEXT, active INTEGER
);
CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, name TEXT, email TEXT,
  username TEXT, password_hash TEXT, role TEXT, color TEXT, active INTEGER,
  branch_id TEXT, employment_type TEXT
);
CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, stage TEXT,
  customer_name TEXT, customer_email TEXT, customer_phone TEXT, destination TEXT,
  date_start TEXT, date_end TEXT, pax_adults INTEGER, pax_children INTEGER,
  estimated_value REAL, probability INTEGER, origin TEXT, temperature TEXT, tags TEXT,
  commercial_staff_id TEXT, next_action_type TEXT, next_action_date TEXT, next_action_notes TEXT,
  loss_reason TEXT, loss_notes TEXT, notes TEXT, reservation_id TEXT, branch_id TEXT
);
CREATE INDEX IF NOT EXISTS opportunities_stage_idx ON opportunities(stage);
CREATE TABLE IF NOT EXISTS opportunity_events (
  id TEXT PRIMARY KEY, created_at TEXT, opportunity_id TEXT, actor TEXT, type TEXT, description TEXT
);
CREATE INDEX IF NOT EXISTS opportunity_events_opportunity_idx ON opportunity_events(opportunity_id);
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, opportunity_id TEXT, version INTEGER,
  status TEXT, services TEXT, cost_value REAL, sale_value REAL, notes TEXT
);
CREATE INDEX IF NOT EXISTS proposals_opportunity_idx ON proposals(opportunity_id);
CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, status TEXT, customer TEXT,
  passengers TEXT, offer TEXT, operator TEXT, source TEXT, notes TEXT,
  payment_received_at TEXT, operator_validation TEXT, operator_validation_at TEXT,
  operator_confirmation TEXT, operator_locator TEXT, confirmed_at TEXT,
  vat_regime TEXT, invoice_number TEXT, invoice_date TEXT, invoice_system TEXT,
  post_trip_ok INTEGER, post_trip_notes TEXT,
  commercial_staff_id TEXT, operational_staff_id TEXT, financial_staff_id TEXT,
  branch_id TEXT, origin TEXT,
  margin_confirmed REAL, margin_confirmed_at TEXT, margin_final REAL, margin_final_at TEXT
);
CREATE INDEX IF NOT EXISTS reservations_status_idx ON reservations(status);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, reservation_id TEXT, method TEXT, amount REAL,
  status TEXT, reference TEXT, paid_at TEXT, expires_at TEXT, gateway TEXT,
  gateway_session_id TEXT, gateway_session TEXT
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
  supplier_name TEXT, reference TEXT, locator TEXT, quantity REAL, date_start TEXT, date_end TEXT, status TEXT,
  net_value REAL, pvp_value REAL, discount_percent REAL, option_deadline TEXT, cancellation_terms TEXT,
  paid INTEGER, paid_at TEXT, cancel_reason TEXT, refundable_amount REAL, refunded_amount REAL, refunded_at TEXT, vat_regime TEXT, notes TEXT
);
CREATE INDEX IF NOT EXISTS reservation_service_lines_reservation_idx ON reservation_service_lines(reservation_id);
CREATE TABLE IF NOT EXISTS service_line_payments (
  id TEXT PRIMARY KEY, created_at TEXT, service_line_id TEXT, amount REAL, paid_at TEXT, method TEXT, reference TEXT, notes TEXT
);
CREATE INDEX IF NOT EXISTS service_line_payments_line_idx ON service_line_payments(service_line_id);
CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY, created_at TEXT, reservation_id TEXT, service_line_id TEXT, direction TEXT, amount REAL, reason TEXT, notes TEXT, created_by TEXT
);
CREATE INDEX IF NOT EXISTS refunds_reservation_idx ON refunds(reservation_id);
CREATE TABLE IF NOT EXISTS reservation_events (
  id TEXT PRIMARY KEY, created_at TEXT, reservation_id TEXT, actor TEXT, type TEXT, description TEXT,
  resolved INTEGER, resolution TEXT
);
CREATE INDEX IF NOT EXISTS reservation_events_reservation_idx ON reservation_events(reservation_id);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, reservation_id TEXT, opportunity_id TEXT, description TEXT,
  assignee TEXT, assignee_staff_id TEXT, due_date TEXT, priority TEXT, status TEXT, completed_at TEXT, notes TEXT
);
CREATE INDEX IF NOT EXISTS tasks_reservation_idx ON tasks(reservation_id);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, created_at TEXT, reservation_id TEXT, customer_email TEXT, supplier_id TEXT, service_line_id TEXT,
  event_id TEXT, complaint_id TEXT, payment_id TEXT,
  type TEXT, passenger_id TEXT, passenger_name TEXT, file_name TEXT, storage_path TEXT, uploaded_by TEXT,
  document_number TEXT, document_date TEXT, amount REAL,
  expiry_date TEXT, issuing_country TEXT
);
CREATE INDEX IF NOT EXISTS documents_reservation_idx ON documents(reservation_id);
CREATE INDEX IF NOT EXISTS documents_customer_idx ON documents(customer_email);
CREATE INDEX IF NOT EXISTS documents_supplier_idx ON documents(supplier_id);
CREATE INDEX IF NOT EXISTS documents_service_line_idx ON documents(service_line_id);
CREATE INDEX IF NOT EXISTS documents_event_idx ON documents(event_id);
CREATE INDEX IF NOT EXISTS documents_complaint_idx ON documents(complaint_id);
CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, name TEXT, type TEXT,
  email TEXT, phone TEXT, nif TEXT, notes TEXT
);
CREATE TABLE IF NOT EXISTS contact_log (
  id TEXT PRIMARY KEY, created_at TEXT, customer_email TEXT, reservation_id TEXT, opportunity_id TEXT, actor TEXT, type TEXT, summary TEXT,
  direction TEXT, external_id TEXT, delivery_status TEXT
);
CREATE INDEX IF NOT EXISTS contact_log_customer_idx ON contact_log(customer_email);
CREATE INDEX IF NOT EXISTS contact_log_reservation_idx ON contact_log(reservation_id);
CREATE TABLE IF NOT EXISTS complaints (
  id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, customer_email TEXT, reservation_id TEXT,
  direction TEXT, supplier_id TEXT, status TEXT, subject TEXT, description TEXT,
  claimed_amount REAL, received_amount REAL, paid_to_customer REAL, resolution TEXT, resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS complaints_customer_idx ON complaints(customer_email);
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY, count INTEGER, reset_at INTEGER
);
CREATE TABLE IF NOT EXISTS used_login_challenges (
  challenge_id TEXT PRIMARY KEY, created_at TEXT
);
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

function ensureLegacyColumnsBeforeIndexes(conn) {
  // Versões antigas do ficheiro SQLite podem já ter uma tabela mas não as
  // colunas que os CREATE INDEX atuais usam. CREATE TABLE IF NOT EXISTS não
  // faz migrations; acrescentamos primeiro as colunas compatíveis e só depois
  // executamos o SCHEMA completo. Tudo é idempotente.
  const upgrades = {
    margins: {
      operator_name: "TEXT NOT NULL DEFAULT '*'",
      channel: "TEXT NOT NULL DEFAULT '*'",
      product_type: "TEXT NOT NULL DEFAULT '*'",
      minimum_percent: 'REAL NOT NULL DEFAULT 0',
      rebate_percent: 'REAL NOT NULL DEFAULT 0'
    },
    customers: {
      phone2: 'TEXT', nif: 'TEXT', address: 'TEXT', postal_code: 'TEXT', city: 'TEXT',
      birthdate: 'TEXT', nationality: 'TEXT', travel_scope: 'TEXT', password_hash: 'TEXT',
      preferences: 'TEXT', alerts: 'TEXT'
    },
    reservations: {
      vat_regime: 'TEXT', invoice_number: 'TEXT', invoice_date: 'TEXT', invoice_system: 'TEXT',
      post_trip_ok: 'INTEGER', post_trip_notes: 'TEXT', commercial_staff_id: 'TEXT',
      operational_staff_id: 'TEXT', financial_staff_id: 'TEXT', branch_id: 'TEXT', origin: 'TEXT',
      margin_confirmed: 'REAL', margin_confirmed_at: 'TEXT', margin_final: 'REAL', margin_final_at: 'TEXT'
    },
    payments: {
      updated_at: 'TEXT', gateway: 'TEXT', gateway_session_id: 'TEXT', gateway_session: 'TEXT'
    },
    documents: {
      customer_email: 'TEXT', supplier_id: 'TEXT', service_line_id: 'TEXT', event_id: 'TEXT',
      complaint_id: 'TEXT', payment_id: 'TEXT', document_number: 'TEXT', document_date: 'TEXT',
      amount: 'REAL', expiry_date: 'TEXT', issuing_country: 'TEXT', passenger_id: 'TEXT'
    }
  };

  const tableExists = name => Boolean(conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));
  for (const [table, columns] of Object.entries(upgrades)) {
    if (!tableExists(table)) continue;
    const existing = new Set(conn.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
    for (const [column, type] of Object.entries(columns)) {
      if (!existing.has(column)) conn.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  }
}

function ensureSchemaUpgrades(conn) {
  // CREATE TABLE IF NOT EXISTS não acrescenta colunas a bases SQLite já
  // existentes. Mantemos upgrades pequenos/idempotentes para Pricing V2.
  const columns = new Set(conn.prepare('PRAGMA table_info(margins)').all().map(row => row.name));
  const additions = [
    ['operator_name', "TEXT NOT NULL DEFAULT '*'"],
    ['channel', "TEXT NOT NULL DEFAULT '*'"],
    ['product_type', "TEXT NOT NULL DEFAULT '*'"],
    ['minimum_percent', 'REAL NOT NULL DEFAULT 0'],
    ['rebate_percent', 'REAL NOT NULL DEFAULT 0']
  ];
  for (const [name, type] of additions) {
    if (!columns.has(name)) conn.exec(`ALTER TABLE margins ADD COLUMN ${name} ${type}`);
  }
}

function seedIfEmpty(conn) {
  const { count } = conn.prepare('SELECT COUNT(*) AS count FROM margins').get();
  if (count > 0) return;
  const insMargin = conn.prepare('INSERT INTO margins (id, name, match_rule, operator_name, channel, product_type, percent, minimum_percent, rebate_percent, min_value, round_to, active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  for (const m of DEFAULT_MARGINS) insMargin.run(m.id, m.name, m.match, m.operator || '*', m.channel || '*', m.productType || '*', m.percent, m.minimumPercent || 0, m.rebatePercent || 0, m.min, m.roundTo, m.active ? 1 : 0);
  // Agencia por omissao (ver auditoria/multiagencia) - mesmo id fixo usado
  // na migracao Supabase (branch-sede), para dados sem agencia ficarem
  // sempre atribuidos a ela.
  conn.prepare('INSERT INTO branches (id, created_at, updated_at, name, code, active) VALUES (?,?,?,?,?,?)')
    .run('branch-sede', new Date().toISOString(), null, 'Sede/Online', 'SEDE', 1);
  const c = DEFAULT_COMPANY();
  conn.prepare(`INSERT INTO company_settings (id, name, brand, domain, email, phone, nif, rnavt, address, cae, market_country, currency, price_type, commission_included, confirmation_mode, default_margin_percent)
    VALUES ('main', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(c.name, c.brand, c.domain || null, c.email || null, c.phone || null, c.nif || null, c.rnavt || null, c.address || null, c.cae || null, c.marketCountry, c.currency, c.priceType, c.commissionIncluded ? 1 : 0, c.confirmationMode, c.defaultMarginPercent);
}

function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(SQLITE_PATH), { recursive: true });
  db = new DatabaseSync(SQLITE_PATH);
  ensureLegacyColumnsBeforeIndexes(db);
  db.exec(SCHEMA);
  ensureSchemaUpgrades(db);
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
  return {
    id: row.id, name: row.name, match: row.match_rule,
    operator: row.operator_name || '*', channel: row.channel || '*', productType: row.product_type || '*',
    percent: Number(row.percent), minimumPercent: Number(row.minimum_percent || 0), rebatePercent: Number(row.rebate_percent || 0),
    min: Number(row.min_value), roundTo: Number(row.round_to), active: Boolean(row.active)
  };
}

function rowToCustomer(row) {
  return {
    id: row.id, createdAt: row.created_at, updatedAt: row.updated_at || undefined, name: row.name, email: row.email,
    phone: row.phone || '', phone2: row.phone2 || '', nif: row.nif || '', address: row.address || '',
    postalCode: row.postal_code || '', city: row.city || '', birthdate: row.birthdate || '', nationality: row.nationality || '', travelScope: row.travel_scope || '',
    passengers: parseJ(row.passengers, []), notes: row.notes || undefined, passwordHash: row.password_hash || '',
    preferences: parseJ(row.preferences, {}), alerts: parseJ(row.alerts, [])
  };
}

function rowToLead(row) {
  return { id: row.id, createdAt: row.created_at, updatedAt: row.updated_at || undefined, source: row.source, status: row.status, search: parseJ(row.search, {}), topResult: parseJ(row.top_result, undefined) };
}

function rowToBranch(row) {
  return { id: row.id, createdAt: row.created_at, updatedAt: row.updated_at || undefined, name: row.name, code: row.code || '', address: row.address || '', phone: row.phone || '', active: Boolean(row.active) };
}

function rowToStaff(row) {
  return {
    id: row.id, createdAt: row.created_at, updatedAt: row.updated_at || undefined, name: row.name, email: row.email || '',
    username: row.username, passwordHash: row.password_hash, role: row.role || 'COMERCIAL', color: row.color || '', active: Boolean(row.active),
    branchId: row.branch_id || undefined, employmentType: row.employment_type || 'INTERNO'
  };
}

function rowToOpportunity(row) {
  return {
    id: row.id, createdAt: row.created_at, updatedAt: row.updated_at || undefined, stage: row.stage || 'NOVO_INTERESSE',
    customerName: row.customer_name || '', customerEmail: row.customer_email || '', customerPhone: row.customer_phone || '',
    destination: row.destination || '', dateStart: row.date_start || '', dateEnd: row.date_end || '',
    paxAdults: Number(row.pax_adults ?? 0), paxChildren: Number(row.pax_children ?? 0),
    estimatedValue: row.estimated_value ?? undefined, probability: row.probability ?? undefined, origin: row.origin || '',
    temperature: row.temperature || 'MORNO', tags: parseJ(row.tags, []), commercialStaffId: row.commercial_staff_id || undefined,
    nextActionType: row.next_action_type || '', nextActionDate: row.next_action_date || '', nextActionNotes: row.next_action_notes || '',
    lossReason: row.loss_reason || '', lossNotes: row.loss_notes || '', notes: row.notes || '', reservationId: row.reservation_id || undefined,
    branchId: row.branch_id || undefined
  };
}

function rowToOpportunityEvent(row) {
  return { id: row.id, createdAt: row.created_at, opportunityId: row.opportunity_id, actor: row.actor || undefined, type: row.type, description: row.description || '' };
}

function rowToProposal(row) {
  return {
    id: row.id, createdAt: row.created_at, updatedAt: row.updated_at || undefined, opportunityId: row.opportunity_id,
    version: Number(row.version ?? 1), status: row.status || 'RASCUNHO', services: row.services || '',
    costValue: row.cost_value ?? undefined, saleValue: row.sale_value ?? undefined, notes: row.notes || ''
  };
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
    invoiceDate: row.invoice_date || undefined, invoiceSystem: row.invoice_system || undefined,
    postTripOk: row.post_trip_ok === null || row.post_trip_ok === undefined ? undefined : Boolean(row.post_trip_ok),
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

function rowToPayment(row) {
  return { id: row.id, createdAt: row.created_at, updatedAt: row.updated_at || undefined, reservationId: row.reservation_id, method: row.method, amount: Number(row.amount), status: row.status, reference: row.reference || undefined, paidAt: row.paid_at || undefined, expiresAt: row.expires_at || undefined, gateway: row.gateway || undefined, gatewaySessionId: row.gateway_session_id || undefined, gatewaySession: parseJ(row.gateway_session, undefined) };
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
  return { id: row.id, createdAt: row.created_at, reservationId: row.reservation_id || undefined, customerEmail: row.customer_email || undefined, supplierId: row.supplier_id || undefined, serviceLineId: row.service_line_id || undefined, eventId: row.event_id || undefined, complaintId: row.complaint_id || undefined, paymentId: row.payment_id || undefined, type: row.type, passengerId: row.passenger_id || undefined, passengerName: row.passenger_name || undefined, fileName: row.file_name, storagePath: row.storage_path, uploadedBy: row.uploaded_by || undefined, documentNumber: row.document_number || undefined, documentDate: row.document_date || undefined, amount: row.amount ?? undefined, expiryDate: row.expiry_date || undefined, issuingCountry: row.issuing_country || undefined };
}

function rowToServiceLine(row) {
  return {
    id: row.id, createdAt: row.created_at, updatedAt: row.updated_at || undefined, reservationId: row.reservation_id,
    type: row.type, description: row.description, supplierName: row.supplier_name || '', reference: row.reference || '',
    locator: row.locator || '', quantity: Number(row.quantity ?? 1), dateStart: row.date_start || '', dateEnd: row.date_end || '',
    status: row.status || 'NAO_CONFIRMADO', netValue: Number(row.net_value ?? 0), pvpValue: Number(row.pvp_value ?? 0),
    discountPercent: Number(row.discount_percent ?? 0), optionDeadline: row.option_deadline || '',
    cancellationTerms: row.cancellation_terms || '', paid: Boolean(row.paid), paidAt: row.paid_at || undefined,
    cancelReason: row.cancel_reason || '', refundableAmount: row.refundable_amount ?? undefined,
    refundedAmount: row.refunded_amount ?? undefined, refundedAt: row.refunded_at || undefined,
    vatRegime: row.vat_regime || undefined, notes: row.notes || ''
  };
}

function rowToServiceLinePayment(row) {
  return { id: row.id, createdAt: row.created_at, serviceLineId: row.service_line_id, amount: Number(row.amount), paidAt: row.paid_at, method: row.method || '', reference: row.reference || '', notes: row.notes || '' };
}

function rowToRefund(row) {
  return { id: row.id, createdAt: row.created_at, reservationId: row.reservation_id, serviceLineId: row.service_line_id || undefined, direction: row.direction, amount: Number(row.amount), reason: row.reason || '', notes: row.notes || '', createdBy: row.created_by || undefined };
}

function rowToReservationEvent(row) {
  return { id: row.id, createdAt: row.created_at, reservationId: row.reservation_id, actor: row.actor || undefined, type: row.type, description: row.description || '', resolved: Boolean(row.resolved), resolution: row.resolution || '' };
}

function rowToSupplier(row) {
  return { id: row.id, createdAt: row.created_at, updatedAt: row.updated_at || undefined, name: row.name, type: row.type || 'OUTRO', email: row.email || '', phone: row.phone || '', nif: row.nif || '', notes: row.notes || '' };
}

function rowToContactEntry(row) {
  return {
    id: row.id, createdAt: row.created_at, customerEmail: row.customer_email, reservationId: row.reservation_id || undefined,
    opportunityId: row.opportunity_id || undefined, actor: row.actor || undefined, type: row.type, summary: row.summary || '',
    direction: row.direction || 'OUTBOUND', externalId: row.external_id || undefined, deliveryStatus: row.delivery_status || undefined
  };
}

function rowToComplaint(row) {
  return {
    id: row.id, createdAt: row.created_at, updatedAt: row.updated_at || undefined, customerEmail: row.customer_email,
    reservationId: row.reservation_id || undefined, direction: row.direction || 'CUSTOMER_TO_AGENCY', supplierId: row.supplier_id || undefined,
    status: row.status, subject: row.subject, description: row.description || '',
    claimedAmount: row.claimed_amount ?? undefined, receivedAmount: row.received_amount ?? undefined, paidToCustomer: row.paid_to_customer ?? undefined,
    resolution: row.resolution || '', resolvedAt: row.resolved_at || undefined
  };
}

function rowToTask(row) {
  return {
    id: row.id, createdAt: row.created_at, updatedAt: row.updated_at || undefined, reservationId: row.reservation_id || undefined,
    opportunityId: row.opportunity_id || undefined, description: row.description, assignee: row.assignee || '',
    assigneeStaffId: row.assignee_staff_id || undefined, dueDate: row.due_date || '', priority: row.priority || 'NORMAL',
    status: row.status || 'TODO', completedAt: row.completed_at || undefined, notes: row.notes || ''
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
    branches: conn.prepare('SELECT * FROM branches ORDER BY created_at ASC').all().map(rowToBranch),
    staff: conn.prepare('SELECT * FROM staff ORDER BY created_at ASC').all().map(rowToStaff),
    customers: conn.prepare('SELECT * FROM customers ORDER BY created_at DESC').all().map(rowToCustomer),
    leads: conn.prepare('SELECT * FROM leads ORDER BY created_at DESC').all().map(rowToLead),
    opportunities: conn.prepare('SELECT * FROM opportunities ORDER BY created_at DESC').all().map(rowToOpportunity),
    opportunityEvents: conn.prepare('SELECT * FROM opportunity_events ORDER BY created_at DESC').all().map(rowToOpportunityEvent),
    proposals: conn.prepare('SELECT * FROM proposals ORDER BY created_at DESC').all().map(rowToProposal),
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
    serviceLinePayments: conn.prepare('SELECT * FROM service_line_payments ORDER BY paid_at ASC').all().map(rowToServiceLinePayment),
    refunds: conn.prepare('SELECT * FROM refunds ORDER BY created_at DESC').all().map(rowToRefund),
    reservationEvents: conn.prepare('SELECT * FROM reservation_events ORDER BY created_at DESC').all().map(rowToReservationEvent),
    tasks: conn.prepare('SELECT * FROM tasks ORDER BY due_date ASC').all().map(rowToTask)
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

    const tables = ['margins', 'branches', 'staff', 'customers', 'leads', 'opportunities', 'opportunity_events', 'proposals', 'reservations', 'payments', 'emails', 'operator_logs', 'audit_logs', 'idempotency_keys', 'documents', 'contact_log', 'complaints', 'suppliers', 'reservation_service_lines', 'service_line_payments', 'refunds', 'reservation_events', 'tasks'];
    for (const t of tables) conn.exec(`DELETE FROM ${t}`);

    const insMargin = conn.prepare('INSERT INTO margins (id, name, match_rule, operator_name, channel, product_type, percent, minimum_percent, rebate_percent, min_value, round_to, active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const m of dbState.margins || []) insMargin.run(m.id, m.name, m.match || '*', m.operator || '*', m.channel || '*', m.productType || '*', m.percent ?? 5, m.minimumPercent ?? 0, m.rebatePercent ?? 0, m.min ?? 0, m.roundTo ?? 5, m.active !== false ? 1 : 0);

    const insBranch = conn.prepare('INSERT INTO branches (id, created_at, updated_at, name, code, active) VALUES (?,?,?,?,?,?)');
    for (const b of dbState.branches || []) insBranch.run(b.id, b.createdAt, b.updatedAt || null, b.name, b.code || null, b.active !== false ? 1 : 0);

    const insStaff = conn.prepare('INSERT INTO staff (id, created_at, updated_at, name, email, username, password_hash, role, color, active, branch_id, employment_type) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const s of dbState.staff || []) insStaff.run(s.id, s.createdAt, s.updatedAt || null, s.name, s.email || null, s.username, s.passwordHash, s.role || 'COMERCIAL', s.color || null, s.active !== false ? 1 : 0, s.branchId || null, s.employmentType || 'INTERNO');

    const insCustomer = conn.prepare('INSERT INTO customers (id, created_at, updated_at, name, email, phone, phone2, nif, address, postal_code, city, birthdate, nationality, travel_scope, passengers, notes, password_hash, preferences, alerts) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const c2 of dbState.customers || []) insCustomer.run(c2.id, c2.createdAt, c2.updatedAt || null, c2.name || 'Cliente', c2.email, c2.phone || null, c2.phone2 || null, c2.nif || null, c2.address || null, c2.postalCode || null, c2.city || null, c2.birthdate || null, c2.nationality || null, c2.travelScope || null, j(c2.passengers || []), c2.notes || null, c2.passwordHash || null, j(c2.preferences || {}), j(c2.alerts || []));

    const insLead = conn.prepare('INSERT INTO leads (id, created_at, updated_at, source, status, search, top_result) VALUES (?,?,?,?,?,?,?)');
    for (const l of dbState.leads || []) insLead.run(l.id, l.createdAt, l.updatedAt || null, l.source || 'site', l.status, j(l.search || {}), j(l.topResult));

    const insOpp = conn.prepare('INSERT INTO opportunities (id, created_at, updated_at, stage, customer_name, customer_email, customer_phone, destination, date_start, date_end, pax_adults, pax_children, estimated_value, probability, origin, temperature, tags, commercial_staff_id, next_action_type, next_action_date, next_action_notes, loss_reason, loss_notes, notes, reservation_id, branch_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const o of dbState.opportunities || []) insOpp.run(o.id, o.createdAt, o.updatedAt || null, o.stage || 'NOVO_INTERESSE', o.customerName || null, o.customerEmail || null, o.customerPhone || null, o.destination || null, o.dateStart || null, o.dateEnd || null, o.paxAdults ?? 0, o.paxChildren ?? 0, o.estimatedValue ?? null, o.probability ?? null, o.origin || null, o.temperature || 'MORNO', j(o.tags || []), o.commercialStaffId || null, o.nextActionType || null, o.nextActionDate || null, o.nextActionNotes || null, o.lossReason || null, o.lossNotes || null, o.notes || null, o.reservationId || null, o.branchId || null);

    const insOppEvent = conn.prepare('INSERT INTO opportunity_events (id, created_at, opportunity_id, actor, type, description) VALUES (?,?,?,?,?,?)');
    for (const e of dbState.opportunityEvents || []) insOppEvent.run(e.id, e.createdAt, e.opportunityId, e.actor || null, e.type, e.description || null);

    const insProposal = conn.prepare('INSERT INTO proposals (id, created_at, updated_at, opportunity_id, version, status, services, cost_value, sale_value, notes) VALUES (?,?,?,?,?,?,?,?,?,?)');
    for (const p of dbState.proposals || []) insProposal.run(p.id, p.createdAt, p.updatedAt || null, p.opportunityId, p.version ?? 1, p.status || 'RASCUNHO', p.services || null, p.costValue ?? null, p.saleValue ?? null, p.notes || null);

    const insRes = conn.prepare(`INSERT INTO reservations (id, created_at, updated_at, status, customer, passengers, offer, operator, source, notes, payment_received_at, operator_validation, operator_validation_at, operator_confirmation, operator_locator, confirmed_at, vat_regime, invoice_number, invoice_date, invoice_system, post_trip_ok, post_trip_notes, commercial_staff_id, operational_staff_id, financial_staff_id, branch_id, origin, margin_confirmed, margin_confirmed_at, margin_final, margin_final_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const r of dbState.reservations || []) insRes.run(r.id, r.createdAt, r.updatedAt || null, r.status, j(r.customer || {}), j(r.passengers || []), j(r.offer || {}), r.operator || null, r.source || 'site', r.notes || null, r.paymentReceivedAt || null, r.operatorValidation || null, r.operatorValidationAt || null, r.operatorConfirmation || null, r.operatorLocator || null, r.confirmedAt || null, r.vatRegime || 'MARGEM', r.invoiceNumber || null, r.invoiceDate || null, r.invoiceSystem || null, r.postTripOk === undefined ? null : (r.postTripOk ? 1 : 0), r.postTripNotes || null, r.commercialStaffId || null, r.operationalStaffId || null, r.financialStaffId || null, r.branchId || null, r.origin || null, r.marginConfirmed ?? null, r.marginConfirmedAt || null, r.marginFinal ?? null, r.marginFinalAt || null);

    const insPay = conn.prepare('INSERT INTO payments (id, created_at, updated_at, reservation_id, method, amount, status, reference, paid_at, expires_at, gateway, gateway_session_id, gateway_session) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const p of dbState.payments || []) insPay.run(p.id, p.createdAt, p.updatedAt || null, p.reservationId, p.method, p.amount, p.status, p.reference || null, p.paidAt || null, p.expiresAt || null, p.gateway || null, p.gatewaySessionId || null, j(p.gatewaySession));

    const insEmail = conn.prepare('INSERT INTO emails (id, created_at, recipient, subject, body, status) VALUES (?,?,?,?,?,?)');
    for (const e of dbState.emails || []) insEmail.run(e.id, e.createdAt, e.to || e.recipient || 'cliente@exemplo.pt', e.subject || 'Email Boomviagens', e.body || '', e.status || 'GERADO_DEMO');

    const insLog = conn.prepare('INSERT INTO operator_logs (id, created_at, type, payload) VALUES (?,?,?,?)');
    for (const l of dbState.operatorLogs || []) insLog.run(l.id, l.createdAt, l.type, j(l.payload || {}));

    const insAudit = conn.prepare('INSERT INTO audit_logs (id, created_at, actor, action, payload) VALUES (?,?,?,?,?)');
    for (const a of dbState.auditLogs || []) insAudit.run(a.id, a.createdAt, a.actor || null, a.action, j(a.payload || {}));

    const insIdem = conn.prepare('INSERT INTO idempotency_keys (idempotency_key, reservation_id, payment_id, created_at) VALUES (?,?,?,?)');
    for (const [key, value] of Object.entries(dbState.idempotencyKeys || {})) insIdem.run(key, value.reservationId, value.paymentId, value.createdAt || new Date().toISOString());

    const insServiceLine = conn.prepare('INSERT INTO reservation_service_lines (id, created_at, updated_at, reservation_id, type, description, supplier_name, reference, locator, quantity, date_start, date_end, status, net_value, pvp_value, discount_percent, option_deadline, cancellation_terms, paid, paid_at, cancel_reason, refundable_amount, refunded_amount, refunded_at, vat_regime, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const s of dbState.serviceLines || []) insServiceLine.run(s.id, s.createdAt, s.updatedAt || null, s.reservationId, s.type, s.description, s.supplierName || null, s.reference || null, s.locator || null, s.quantity ?? 1, s.dateStart || null, s.dateEnd || null, s.status || 'NAO_CONFIRMADO', s.netValue ?? 0, s.pvpValue ?? 0, s.discountPercent ?? 0, s.optionDeadline || null, s.cancellationTerms || null, s.paid ? 1 : 0, s.paidAt || null, s.cancelReason || null, s.refundableAmount ?? null, s.refundedAmount ?? null, s.refundedAt || null, s.vatRegime || null, s.notes || null);

    const insServiceLinePayment = conn.prepare('INSERT INTO service_line_payments (id, created_at, service_line_id, amount, paid_at, method, reference, notes) VALUES (?,?,?,?,?,?,?,?)');
    for (const p of dbState.serviceLinePayments || []) insServiceLinePayment.run(p.id, p.createdAt, p.serviceLineId, p.amount, p.paidAt, p.method || null, p.reference || null, p.notes || null);

    const insRefund = conn.prepare('INSERT INTO refunds (id, created_at, reservation_id, service_line_id, direction, amount, reason, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?)');
    for (const r of dbState.refunds || []) insRefund.run(r.id, r.createdAt, r.reservationId, r.serviceLineId || null, r.direction, r.amount, r.reason || null, r.notes || null, r.createdBy || null);

    const insEvent = conn.prepare('INSERT INTO reservation_events (id, created_at, reservation_id, actor, type, description, resolved, resolution) VALUES (?,?,?,?,?,?,?,?)');
    for (const e of dbState.reservationEvents || []) insEvent.run(e.id, e.createdAt, e.reservationId, e.actor || null, e.type, e.description || null, e.resolved ? 1 : 0, e.resolution || null);

    const insDoc = conn.prepare('INSERT INTO documents (id, created_at, reservation_id, customer_email, supplier_id, service_line_id, event_id, complaint_id, payment_id, type, passenger_id, passenger_name, file_name, storage_path, uploaded_by, document_number, document_date, amount, expiry_date, issuing_country) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const d of dbState.documents || []) insDoc.run(d.id, d.createdAt, d.reservationId || null, d.customerEmail || null, d.supplierId || null, d.serviceLineId || null, d.eventId || null, d.complaintId || null, d.paymentId || null, d.type, d.passengerId || null, d.passengerName || null, d.fileName, d.storagePath, d.uploadedBy || null, d.documentNumber || null, d.documentDate || null, d.amount ?? null, d.expiryDate || null, d.issuingCountry || null);

    const insSupplier = conn.prepare('INSERT INTO suppliers (id, created_at, updated_at, name, type, email, phone, nif, notes) VALUES (?,?,?,?,?,?,?,?,?)');
    for (const s of dbState.suppliers || []) insSupplier.run(s.id, s.createdAt, s.updatedAt || null, s.name, s.type || 'OUTRO', s.email || null, s.phone || null, s.nif || null, s.notes || null);

    const insContact = conn.prepare('INSERT INTO contact_log (id, created_at, customer_email, reservation_id, opportunity_id, actor, type, summary, direction, external_id, delivery_status) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    for (const c3 of dbState.contactLog || []) insContact.run(c3.id, c3.createdAt, c3.customerEmail, c3.reservationId || null, c3.opportunityId || null, c3.actor || null, c3.type, c3.summary || '', c3.direction || 'OUTBOUND', c3.externalId || null, c3.deliveryStatus || null);

    const insComplaint = conn.prepare('INSERT INTO complaints (id, created_at, updated_at, customer_email, reservation_id, direction, supplier_id, status, subject, description, claimed_amount, received_amount, paid_to_customer, resolution, resolved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const co of dbState.complaints || []) insComplaint.run(co.id, co.createdAt, co.updatedAt || null, co.customerEmail, co.reservationId || null, co.direction || 'CUSTOMER_TO_AGENCY', co.supplierId || null, co.status, co.subject, co.description || null, co.claimedAmount ?? null, co.receivedAmount ?? null, co.paidToCustomer ?? null, co.resolution || null, co.resolvedAt || null);

    const insTask = conn.prepare('INSERT INTO tasks (id, created_at, updated_at, reservation_id, opportunity_id, description, assignee, assignee_staff_id, due_date, priority, status, completed_at, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const t of dbState.tasks || []) insTask.run(t.id, t.createdAt, t.updatedAt || null, t.reservationId || null, t.opportunityId || null, t.description, t.assignee || null, t.assigneeStaffId || null, t.dueDate || null, t.priority || 'NORMAL', t.status || 'TODO', t.completedAt || null, t.notes || null);

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

// Contagem de rate limit atomica num unico statement (INSERT .. ON
// CONFLICT): dois pedidos simultaneos no mesmo processo nunca se pisam, ao
// contrario de um ler-modificar-escrever. reset_at guarda-se em ms epoch
// (inteiro) para as comparacoes serem triviais.
function incrementRateBucketSqlite(key, windowMs) {
  const conn = getDb();
  const nowMs = Date.now();
  conn.prepare(`INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN rate_limits.reset_at < ? THEN 1 ELSE rate_limits.count + 1 END,
      reset_at = CASE WHEN rate_limits.reset_at < ? THEN ? ELSE rate_limits.reset_at END`)
    .run(key, nowMs + windowMs, nowMs, nowMs, nowMs + windowMs);
  const row = conn.prepare('SELECT count, reset_at FROM rate_limits WHERE key = ?').get(key);
  // Limpeza oportunistica: sem isto a tabela crescia para sempre com
  // buckets ha muito expirados (uma linha por IP+escopo).
  conn.prepare('DELETE FROM rate_limits WHERE reset_at < ?').run(nowMs - 24 * 60 * 60 * 1000);
  return { count: Number(row.count), resetAt: Number(row.reset_at) };
}

// Mesmo contrato de storage.js#markLoginChallengeUsed: true na primeira
// utilizacao, false se o challenge ja tinha sido consumido. INSERT OR
// IGNORE + changes torna a verificacao atomica (a chave primaria e que
// decide), sem race entre ler e inserir.
function markLoginChallengeUsedSqlite(challengeId) {
  const conn = getDb();
  const result = conn.prepare('INSERT OR IGNORE INTO used_login_challenges (challenge_id, created_at) VALUES (?, ?)')
    .run(challengeId, new Date().toISOString());
  return Number(result.changes) > 0;
}

module.exports = { readDbSqlite, writeDbSqlite, updateDbSqlite, incrementRateBucketSqlite, markLoginChallengeUsedSqlite, SQLITE_PATH };
