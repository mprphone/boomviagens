const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY antes de importar.');
  process.exit(1);
}

if (SUPABASE_URL.includes('PROJECT_REF') || SERVICE_ROLE_KEY.includes('colocar_')) {
  console.error('Substitua os placeholders SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY por valores reais no .env local.');
  process.exit(1);
}

const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));

async function upsert(table, rows, onConflict = 'id') {
  if (!rows.length) return;
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates'
    },
    body: JSON.stringify(rows)
  });
  if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
  console.log(`Importado ${table}: ${rows.length}`);
}

function ts(value) {
  return value || new Date().toISOString();
}

(async () => {
  await upsert('company_settings', [{
    id: 'main',
    name: db.company.name,
    brand: db.company.brand,
    domain: db.company.domain,
    email: db.company.email,
    phone: db.company.phone,
    nif: db.company.nif,
    rnavt: db.company.rnavt,
    address: db.company.address,
    cae: db.company.cae,
    market_country: db.company.marketCountry || 'PT',
    currency: db.company.currency || 'EUR',
    price_type: db.company.priceType || 'PVP',
    commission_included: db.company.commissionIncluded !== false,
    confirmation_mode: db.company.confirmationMode || 'automatic',
    default_margin_percent: db.company.defaultMarginPercent || 5
  }]);

  await upsert('margins', (db.margins || []).map(m => ({
    id: m.id,
    name: m.name,
    match_rule: m.match || '*',
    percent: m.percent ?? 5,
    min_value: m.min ?? 0,
    round_to: m.roundTo ?? 5,
    active: m.active !== false
  })));

  await upsert('customers', (db.customers || []).filter(c => c.email).map(c => ({
    id: c.id,
    created_at: ts(c.createdAt),
    updated_at: c.updatedAt || null,
    name: c.name || 'Cliente',
    email: c.email,
    phone: c.phone || null,
    passengers: c.passengers || []
  })));

  await upsert('leads', (db.leads || []).map(l => ({
    id: l.id,
    created_at: ts(l.createdAt),
    source: l.source || 'site',
    status: l.status || 'PROPOSAL_SENT',
    search: l.search || {},
    top_result: l.topResult || null
  })));

  await upsert('reservations', (db.reservations || []).map(r => ({
    id: r.id,
    created_at: ts(r.createdAt),
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
  })));

  await upsert('payments', (db.payments || []).map(p => ({
    id: p.id,
    created_at: ts(p.createdAt),
    reservation_id: p.reservationId,
    method: p.method,
    amount: p.amount,
    status: p.status,
    reference: p.reference || null,
    paid_at: p.paidAt || null,
    expires_at: p.expiresAt || null
  })));

  await upsert('emails', (db.emails || []).map(e => ({
    id: e.id,
    created_at: ts(e.createdAt),
    recipient: e.to || e.recipient || 'cliente@exemplo.pt',
    subject: e.subject || 'Email Boomviagens',
    body: e.body || '',
    status: e.status || 'GERADO_DEMO'
  })));

  await upsert('operator_logs', (db.operatorLogs || []).map(l => ({
    id: l.id,
    created_at: ts(l.createdAt),
    type: l.type,
    payload: l.payload || {}
  })));

  await upsert('audit_logs', (db.auditLogs || []).map(l => ({
    id: l.id,
    created_at: ts(l.createdAt),
    actor: l.actor || null,
    action: l.action,
    payload: l.payload || {}
  })));

  const idemRows = Object.entries(db.idempotencyKeys || {}).map(([key, value]) => ({
    idempotency_key: key,
    reservation_id: value.reservationId,
    payment_id: value.paymentId,
    created_at: ts(value.createdAt)
  }));
  await upsert('idempotency_keys', idemRows, 'idempotency_key');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
