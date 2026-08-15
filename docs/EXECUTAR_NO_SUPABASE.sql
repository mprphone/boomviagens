-- Boomviagens - Supabase/Postgres schema inicial
-- Aplicar no SQL Editor do Supabase.
-- As tabelas ficam com RLS ativo e sem policies publicas: o frontend nao deve aceder diretamente a dados sensiveis.
-- O servidor Node deve usar SUPABASE_SERVICE_ROLE_KEY apenas no backend.

create table if not exists public.company_settings (
  id text primary key default 'main',
  name text not null,
  brand text not null,
  domain text,
  email text,
  phone text,
  nif text,
  rnavt text,
  address text,
  cae text,
  market_country text not null default 'PT',
  currency text not null default 'EUR',
  price_type text not null default 'PVP',
  commission_included boolean not null default true,
  confirmation_mode text not null default 'automatic',
  default_margin_percent numeric(5,2) not null default 5,
  updated_at timestamptz not null default now()
);

create table if not exists public.margins (
  id text primary key,
  name text not null,
  match_rule text not null default '*',
  percent numeric(5,2) not null default 5,
  min_value numeric(12,2) not null default 0,
  round_to numeric(8,2) not null default 5,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Equipa (staff) - login multi-utilizador com perfil (COMERCIAL/
-- OPERACIONAL/FINANCEIRO/SUPERVISOR/ADMIN). Substitui o login unico por
-- variaveis de ambiente (ADMIN_USERNAME/ADMIN_PASSWORD) - essas
-- credenciais continuam a funcionar como arranque do primeiro
-- utilizador (role ADMIN) enquanto esta tabela estiver vazia.
create table if not exists public.staff (
  id text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  name text not null,
  email text,
  username text not null unique,
  password_hash text not null,
  role text not null default 'COMERCIAL',
  color text,
  active boolean not null default true
);

create table if not exists public.customers (
  id text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  name text not null,
  email text not null unique,
  phone text,
  phone2 text,
  nif text,
  address text,
  postal_code text,
  city text,
  birthdate text,
  travel_scope text,
  notes text,
  password_hash text,
  passengers jsonb not null default '[]'::jsonb
);

alter table public.customers
  add column if not exists nif text,
  add column if not exists address text,
  add column if not exists notes text,
  add column if not exists password_hash text,
  add column if not exists phone2 text,
  add column if not exists postal_code text,
  add column if not exists city text,
  add column if not exists birthdate text,
  add column if not exists travel_scope text;

create table if not exists public.leads (
  id text primary key,
  created_at timestamptz not null default now(),
  source text not null default 'site',
  status text not null,
  search jsonb not null default '{}'::jsonb,
  top_result jsonb
);

-- Pipeline comercial ("Pipeline"/"Oportunidades") - a entrada real de
-- oportunidades comerciais, com arrasto entre fases. reservation_id fica
-- preenchido quando a oportunidade e convertida em processo (fase GANHO).
create table if not exists public.opportunities (
  id text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  stage text not null default 'NOVO_INTERESSE',
  customer_name text,
  customer_email text,
  customer_phone text,
  destination text,
  date_start text,
  date_end text,
  pax_adults integer not null default 0,
  pax_children integer not null default 0,
  estimated_value numeric(12,2),
  probability integer,
  origin text,
  temperature text not null default 'MORNO',
  tags jsonb not null default '[]'::jsonb,
  commercial_staff_id text references public.staff(id) on delete set null,
  next_action_type text,
  next_action_date text,
  next_action_notes text,
  loss_reason text,
  loss_notes text,
  notes text
  -- reservation_id (referencia a public.reservations) e adicionada mais
  -- abaixo, depois de a tabela reservations existir - ver alter table
  -- perto do fim deste ficheiro.
);

create index if not exists opportunities_stage_idx on public.opportunities(stage);
create index if not exists opportunities_commercial_staff_idx on public.opportunities(commercial_staff_id);
create index if not exists opportunities_customer_email_idx on public.opportunities(customer_email);

create table if not exists public.opportunity_events (
  id text primary key,
  created_at timestamptz not null default now(),
  opportunity_id text not null references public.opportunities(id) on delete cascade,
  actor text,
  type text not null,
  description text
);

create index if not exists opportunity_events_opportunity_id_idx on public.opportunity_events(opportunity_id);

create table if not exists public.proposals (
  id text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  opportunity_id text not null references public.opportunities(id) on delete cascade,
  version integer not null default 1,
  status text not null default 'RASCUNHO',
  services text,
  cost_value numeric(12,2),
  sale_value numeric(12,2),
  notes text
);

create index if not exists proposals_opportunity_id_idx on public.proposals(opportunity_id);

create table if not exists public.reservations (
  id text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  status text not null,
  customer jsonb not null default '{}'::jsonb,
  passengers jsonb not null default '[]'::jsonb,
  offer jsonb not null default '{}'::jsonb,
  operator text,
  source text not null default 'site',
  notes text,
  payment_received_at timestamptz,
  operator_validation text,
  operator_validation_at timestamptz,
  operator_confirmation text,
  operator_locator text,
  confirmed_at timestamptz,
  vat_regime text not null default 'MARGEM',
  invoice_number text,
  invoice_date text,
  invoice_system text
);

alter table public.reservations
  add column if not exists vat_regime text not null default 'MARGEM',
  add column if not exists invoice_number text,
  add column if not exists invoice_date text,
  add column if not exists invoice_system text,
  add column if not exists post_trip_ok boolean,
  add column if not exists post_trip_notes text;

-- Tres responsaveis por processo (comercial/operacional/financeiro).
alter table public.reservations
  add column if not exists commercial_staff_id text references public.staff(id) on delete set null,
  add column if not exists operational_staff_id text references public.staff(id) on delete set null,
  add column if not exists financial_staff_id text references public.staff(id) on delete set null;

-- So pode ser adicionada agora que a tabela reservations existe.
alter table public.opportunities add column if not exists reservation_id text references public.reservations(id) on delete set null;

create index if not exists reservations_status_idx on public.reservations(status);
create index if not exists reservations_created_at_idx on public.reservations(created_at desc);

create table if not exists public.payments (
  id text primary key,
  created_at timestamptz not null default now(),
  reservation_id text not null references public.reservations(id) on delete cascade,
  method text not null,
  amount numeric(12,2) not null,
  status text not null,
  reference text,
  idempotency_key text unique,
  paid_at timestamptz,
  expires_at timestamptz
);

create index if not exists payments_reservation_id_idx on public.payments(reservation_id);

create table if not exists public.emails (
  id text primary key,
  created_at timestamptz not null default now(),
  reservation_id text,
  lead_id text,
  recipient text not null,
  subject text not null,
  body text,
  status text not null
);

create table if not exists public.operator_logs (
  id text primary key,
  created_at timestamptz not null default now(),
  type text not null,
  reservation_id text,
  operator text,
  payload jsonb not null default '{}'::jsonb
);

create table if not exists public.audit_logs (
  id text primary key,
  created_at timestamptz not null default now(),
  actor text,
  action text not null,
  payload jsonb not null default '{}'::jsonb
);

create table if not exists public.idempotency_keys (
  idempotency_key text primary key,
  reservation_id text references public.reservations(id) on delete cascade,
  payment_id text references public.payments(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Linhas de servico (compras/vendas) de uma reserva - separador "Servicos"
-- da Ficha de Reserva. A soma destas linhas da os valores reais da
-- reserva (custo/venda/margem), em contraste com a proposta original
-- guardada em reservations.offer.
create table if not exists public.reservation_service_lines (
  id text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  reservation_id text not null references public.reservations(id) on delete cascade,
  type text not null,
  description text not null,
  supplier_name text,
  reference text,
  quantity numeric(8,2) not null default 1,
  date_start text,
  date_end text,
  status text not null default 'PENDENTE',
  net_value numeric(12,2) not null default 0,
  pvp_value numeric(12,2) not null default 0,
  discount_percent numeric(5,2) not null default 0,
  notes text
);

alter table public.reservation_service_lines
  add column if not exists locator text,
  add column if not exists option_deadline text,
  add column if not exists cancellation_terms text,
  add column if not exists paid boolean not null default false,
  add column if not exists paid_at timestamptz,
  add column if not exists cancel_reason text,
  add column if not exists refundable_amount numeric(12,2),
  add column if not exists refunded_amount numeric(12,2),
  add column if not exists refunded_at timestamptz;

create index if not exists reservation_service_lines_reservation_id_idx on public.reservation_service_lines(reservation_id);

-- Historico/timeline de uma reserva: mudancas de estado, linhas de servico
-- adicionadas/editadas/removidas e documentos anexados sao registados aqui
-- automaticamente pelo servidor; ocorrencias (problemas, incidentes,
-- atrasos...), contactos e notas livres sao registados manualmente pelo
-- operador. O separador "Ocorrencias" e uma leitura filtrada deste mesmo
-- registo, com resolved/resolution para acompanhar o fecho do problema.
create table if not exists public.reservation_events (
  id text primary key,
  created_at timestamptz not null default now(),
  reservation_id text not null references public.reservations(id) on delete cascade,
  actor text,
  type text not null,
  description text
);

alter table public.reservation_events
  add column if not exists resolved boolean not null default false,
  add column if not exists resolution text;

create index if not exists reservation_events_reservation_id_idx on public.reservation_events(reservation_id);

-- Definida aqui (antes de documents) para o FK de documents.complaint_id
-- poder apontar para esta tabela.
create table if not exists public.complaints (
  id text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  customer_email text not null,
  reservation_id text references public.reservations(id) on delete set null,
  status text not null default 'OPEN',
  subject text not null,
  description text,
  resolution text,
  resolved_at timestamptz
);

alter table public.complaints
  add column if not exists direction text not null default 'CUSTOMER_TO_AGENCY',
  add column if not exists supplier_id text,
  add column if not exists claimed_amount numeric(12,2),
  add column if not exists received_amount numeric(12,2),
  add column if not exists paid_to_customer numeric(12,2);

create index if not exists complaints_customer_email_idx on public.complaints(customer_email);

-- Tarefas do processo (separador "Tarefas") - checklist administrativo e
-- operacional (pedir passaportes, confirmar hotel, emitir seguro...).
create table if not exists public.tasks (
  id text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  reservation_id text not null references public.reservations(id) on delete cascade,
  description text not null,
  assignee text,
  due_date text,
  priority text not null default 'NORMAL',
  status text not null default 'TODO',
  completed_at timestamptz,
  notes text
);

create index if not exists tasks_reservation_id_idx on public.tasks(reservation_id);
create index if not exists tasks_status_idx on public.tasks(status);

-- Uma tarefa pode pertencer a uma oportunidade em vez de (ou alem de) um
-- processo; assignee_staff_id liga a um colaborador real (assignee
-- texto livre fica so para compatibilidade com tarefas antigas).
alter table public.tasks alter column reservation_id drop not null;
alter table public.tasks add column if not exists opportunity_id text references public.opportunities(id) on delete cascade;
alter table public.tasks add column if not exists assignee_staff_id text references public.staff(id) on delete set null;
create index if not exists tasks_opportunity_id_idx on public.tasks(opportunity_id);

create table if not exists public.documents (
  id text primary key,
  created_at timestamptz not null default now(),
  reservation_id text references public.reservations(id) on delete cascade,
  customer_email text,
  supplier_id text,
  service_line_id text references public.reservation_service_lines(id) on delete set null,
  type text not null,
  passenger_name text,
  file_name text not null,
  storage_path text not null,
  uploaded_by text
);

-- reservation_id passa a opcional (documentos podem ficar ligados so ao
-- cliente, ex.: passaporte do agregado familiar reutilizavel entre reservas,
-- ou a um fornecedor).
alter table public.documents alter column reservation_id drop not null;
alter table public.documents add column if not exists customer_email text;
alter table public.documents add column if not exists supplier_id text;
alter table public.documents add column if not exists service_line_id text references public.reservation_service_lines(id) on delete set null;
alter table public.documents add column if not exists event_id text references public.reservation_events(id) on delete cascade;
alter table public.documents add column if not exists complaint_id text references public.complaints(id) on delete cascade;
alter table public.documents add column if not exists document_number text;
alter table public.documents add column if not exists document_date text;
alter table public.documents add column if not exists amount numeric(12,2);

create index if not exists documents_reservation_id_idx on public.documents(reservation_id);
create index if not exists documents_customer_email_idx on public.documents(customer_email);
create index if not exists documents_supplier_id_idx on public.documents(supplier_id);
create index if not exists documents_service_line_id_idx on public.documents(service_line_id);
create index if not exists documents_event_id_idx on public.documents(event_id);
create index if not exists documents_complaint_id_idx on public.documents(complaint_id);

-- Validade/pais emissor: so relevante para documentos pessoais
-- (passaporte/cartao de cidadao/visto) do cliente ou do agregado familiar -
-- permite alertar "passaporte expira em N meses" na ficha do cliente.
alter table public.documents add column if not exists expiry_date text;
alter table public.documents add column if not exists issuing_country text;

-- Preferencias comerciais (destinos, tipo de viagem, hotel, regime,
-- companhia aerea, orcamento habitual...) e alertas permanentes do cliente
-- (ex.: "necessita assistencia no aeroporto") - guardados como jsonb por
-- serem estruturas pequenas e variaveis, sem justificar tabelas propias.
alter table public.customers add column if not exists preferences jsonb not null default '{}'::jsonb;
alter table public.customers add column if not exists alerts jsonb not null default '[]'::jsonb;

create table if not exists public.suppliers (
  id text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  name text not null,
  type text not null default 'OUTRO',
  email text,
  phone text,
  nif text,
  notes text
);

create table if not exists public.contact_log (
  id text primary key,
  created_at timestamptz not null default now(),
  customer_email text not null,
  actor text,
  type text not null,
  summary text
);

alter table public.contact_log add column if not exists reservation_id text references public.reservations(id) on delete cascade;

-- Comunicacoes de uma oportunidade comercial, e preparacao de esquema
-- para uma integracao real de WhatsApp/email/chat interno mais tarde
-- (direcao, id da mensagem no fornecedor, estado de entrega) - sem
-- nenhuma integracao real ainda, so os campos prontos a receber esses dados.
alter table public.contact_log add column if not exists opportunity_id text references public.opportunities(id) on delete cascade;
alter table public.contact_log add column if not exists direction text not null default 'OUTBOUND';
alter table public.contact_log add column if not exists external_id text;
alter table public.contact_log add column if not exists delivery_status text;

create index if not exists contact_log_customer_email_idx on public.contact_log(customer_email);
create index if not exists contact_log_reservation_id_idx on public.contact_log(reservation_id);
create index if not exists contact_log_opportunity_id_idx on public.contact_log(opportunity_id);

alter table public.company_settings enable row level security;
alter table public.margins enable row level security;
alter table public.staff enable row level security;
alter table public.opportunities enable row level security;
alter table public.opportunity_events enable row level security;
alter table public.proposals enable row level security;
alter table public.customers enable row level security;
alter table public.leads enable row level security;
alter table public.reservations enable row level security;
alter table public.payments enable row level security;
alter table public.emails enable row level security;
alter table public.operator_logs enable row level security;
alter table public.audit_logs enable row level security;
alter table public.idempotency_keys enable row level security;
alter table public.documents enable row level security;
alter table public.contact_log enable row level security;
alter table public.complaints enable row level security;
alter table public.suppliers enable row level security;
alter table public.reservation_service_lines enable row level security;
alter table public.reservation_events enable row level security;
alter table public.tasks enable row level security;

-- Dados publicos que podem ser lidos pelo site sem expor clientes/reservas.
create or replace view public.public_margins
with (security_invoker = true)
as
select id, name, match_rule, percent, min_value, round_to, active
from public.margins
where active = true;

alter view public.public_margins set (security_invoker = true);

-- Grants para acesso via PostgREST. RLS continua a proteger as linhas.
grant usage on schema public to anon, authenticated, service_role;
grant select on public.public_margins to anon, authenticated;
grant all on all tables in schema public to service_role;

-- Bucket privado para documentos de reservas. O acesso deve ser feito pelo servidor
-- com service role e URLs assinadas de curta duracao.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;
