-- Boom das Viagens - Supabase/Postgres schema inicial
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

create table if not exists public.customers (
  id text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  name text not null,
  email text not null unique,
  phone text,
  passengers jsonb not null default '[]'::jsonb
);

create table if not exists public.leads (
  id text primary key,
  created_at timestamptz not null default now(),
  source text not null default 'site',
  status text not null,
  search jsonb not null default '{}'::jsonb,
  top_result jsonb
);

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
  confirmed_at timestamptz
);

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

alter table public.company_settings enable row level security;
alter table public.margins enable row level security;
alter table public.customers enable row level security;
alter table public.leads enable row level security;
alter table public.reservations enable row level security;
alter table public.payments enable row level security;
alter table public.emails enable row level security;
alter table public.operator_logs enable row level security;
alter table public.audit_logs enable row level security;
alter table public.idempotency_keys enable row level security;

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
