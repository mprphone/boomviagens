-- ATENCAO: NAO EXECUTAR ESTE FICHEIRO NO SUPABASE.
-- Para Supabase use docs/EXECUTAR_NO_SUPABASE.sql ou docs/supabase-schema.sql.
-- Boom das Viagens - schema inicial para Oracle Cloud Database.
-- Usar tipos e constraints conservadores para facilitar migracao a partir do JSON local.

CREATE TABLE customers (
  id VARCHAR2(40) PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE,
  name VARCHAR2(160) NOT NULL,
  email VARCHAR2(254) NOT NULL UNIQUE,
  phone VARCHAR2(40)
);

CREATE TABLE passengers (
  id VARCHAR2(40) PRIMARY KEY,
  customer_id VARCHAR2(40) REFERENCES customers(id),
  reservation_id VARCHAR2(40),
  name VARCHAR2(160) NOT NULL,
  surname VARCHAR2(160),
  type VARCHAR2(10) DEFAULT 'ADT' NOT NULL,
  birthdate DATE,
  document_number VARCHAR2(80)
);

CREATE TABLE leads (
  id VARCHAR2(40) PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  source VARCHAR2(80) DEFAULT 'site' NOT NULL,
  status VARCHAR2(40) NOT NULL,
  search_json CLOB CHECK (search_json IS JSON),
  top_result_json CLOB CHECK (top_result_json IS JSON)
);

CREATE TABLE proposals (
  id VARCHAR2(40) PRIMARY KEY,
  lead_id VARCHAR2(40) REFERENCES leads(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  status VARCHAR2(40) NOT NULL,
  offer_json CLOB CHECK (offer_json IS JSON),
  final_price NUMBER(12,2),
  margin_value NUMBER(12,2)
);

CREATE TABLE reservations (
  id VARCHAR2(40) PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE,
  status VARCHAR2(40) NOT NULL,
  customer_id VARCHAR2(40) REFERENCES customers(id),
  operator_name VARCHAR2(120),
  operator_locator VARCHAR2(120),
  offer_json CLOB CHECK (offer_json IS JSON),
  notes VARCHAR2(1000),
  confirmed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_reservations_status ON reservations(status);
CREATE INDEX idx_reservations_customer ON reservations(customer_id);

CREATE TABLE payments (
  id VARCHAR2(40) PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  reservation_id VARCHAR2(40) NOT NULL REFERENCES reservations(id),
  method VARCHAR2(60) NOT NULL,
  amount NUMBER(12,2) NOT NULL,
  status VARCHAR2(40) NOT NULL,
  reference VARCHAR2(120),
  idempotency_key VARCHAR2(180) UNIQUE,
  paid_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_payments_reservation ON payments(reservation_id);

CREATE TABLE margins (
  id VARCHAR2(40) PRIMARY KEY,
  name VARCHAR2(120) NOT NULL,
  match_rule VARCHAR2(500) DEFAULT '*' NOT NULL,
  percent NUMBER(5,2) DEFAULT 7 NOT NULL,
  min_value NUMBER(12,2) DEFAULT 50 NOT NULL,
  round_to NUMBER(8,2) DEFAULT 5 NOT NULL,
  active NUMBER(1) DEFAULT 1 NOT NULL
);

CREATE TABLE operator_logs (
  id VARCHAR2(40) PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  reservation_id VARCHAR2(40),
  operator_name VARCHAR2(120),
  type VARCHAR2(80) NOT NULL,
  payload_json CLOB CHECK (payload_json IS JSON)
);

CREATE TABLE emails (
  id VARCHAR2(40) PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  reservation_id VARCHAR2(40),
  lead_id VARCHAR2(40),
  recipient VARCHAR2(254) NOT NULL,
  subject VARCHAR2(300) NOT NULL,
  status VARCHAR2(40) NOT NULL,
  body CLOB
);

CREATE TABLE audit_logs (
  id VARCHAR2(40) PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  actor VARCHAR2(120),
  action VARCHAR2(120) NOT NULL,
  payload_json CLOB CHECK (payload_json IS JSON)
);
