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
  operator_name text not null default '*',
  channel text not null default '*',
  product_type text not null default '*',
  percent numeric(5,2) not null default 5,
  minimum_percent numeric(5,2) not null default 0,
  rebate_percent numeric(5,2) not null default 0,
  min_value numeric(12,2) not null default 0,
  round_to numeric(8,2) not null default 5,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Agencias/balcoes (separador "Agências") - CRUD proprio pelo proprio
-- utilizador, sem nomes fixos no codigo (a lista cresce). "Sede/Online"
-- e semeada com um id fixo (branch-sede) para dados sem agencia real
-- ficarem sempre atribuidos a ela.
create table if not exists public.branches (
  id text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  name text not null,
  code text,
  active boolean not null default true
);
insert into public.branches (id, name, code, active)
values ('branch-sede', 'Sede/Online', 'SEDE', true)
on conflict (id) do nothing;

-- Equipa (staff) - login multi-utilizador com perfil (COMERCIAL/
-- OPERACIONAL/FINANCEIRO/SUPERVISOR/ADMIN). Substitui o login unico por
-- variaveis de ambiente (ADMIN_USERNAME/ADMIN_PASSWORD) - essas
-- credenciais continuam a funcionar como arranque do primeiro
-- utilizador (role ADMIN) enquanto esta tabela estiver vazia.
-- branch_id: agencia principal (freelancer pode ficar sem nenhuma).
-- employment_type: INTERNO/FREELANCER.
create table if not exists public.staff (
  id text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  name text not null,
  email text,
  username text not null unique,
  password_hash text not null,
  branch_id text references public.branches(id) on delete set null,
  employment_type text not null default 'INTERNO',
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
  -- Agregado familiar/passageiros habituais do cliente (nome, nascimento,
  -- nacionalidade, documento, relacao) - reutilizavel entre viagens, ver
  -- separador "Passageiros" da ficha do cliente.
  passengers jsonb not null default '[]'::jsonb,
  -- Preferencias comerciais e alertas permanentes - ver separadores
  -- "Preferencias" e "Resumo" da ficha do cliente.
  preferences jsonb not null default '{}'::jsonb,
  alerts jsonb not null default '[]'::jsonb
);

-- Legado: nada cria registos aqui (ver pipeline comercial em
-- opportunities). Mantida sem uso, nao apagada.
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
  notes text,
  branch_id text references public.branches(id) on delete set null
  -- reservation_id (referencia a public.reservations) e adicionada mais
  -- abaixo, depois de a tabela reservations existir - ver alter table
  -- perto do fim deste ficheiro.
);

create index if not exists opportunities_stage_idx on public.opportunities(stage);
create index if not exists opportunities_commercial_staff_idx on public.opportunities(commercial_staff_id);
create index if not exists opportunities_customer_email_idx on public.opportunities(customer_email);

-- Historico da oportunidade - mesmo padrao de reservation_events.
create table if not exists public.opportunity_events (
  id text primary key,
  created_at timestamptz not null default now(),
  opportunity_id text not null references public.opportunities(id) on delete cascade,
  actor text,
  type text not null,
  description text
);

create index if not exists opportunity_events_opportunity_id_idx on public.opportunity_events(opportunity_id);

-- Propostas de uma oportunidade (varias versoes possiveis). Sem geracao
-- de PDF nesta fase - so o registo estruturado de valores e estado.
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
  -- canal de venda (mesmo dominio de opportunities.origin - BALCAO/
  -- WEBSITE/TELEFONE/etc.) - checkout do site fixa sempre 'WEBSITE'.
  origin text,
  branch_id text references public.branches(id) on delete set null,
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
  invoice_system text,
  post_trip_ok boolean,
  post_trip_notes text,
  -- Tres responsaveis por processo (comercial/operacional/financeiro) -
  -- ver "Responsaveis diferentes por area".
  commercial_staff_id text references public.staff(id) on delete set null,
  operational_staff_id text references public.staff(id) on delete set null,
  financial_staff_id text references public.staff(id) on delete set null
);

create index if not exists reservations_status_idx on public.reservations(status);
create index if not exists reservations_created_at_idx on public.reservations(created_at desc);

-- So pode ser adicionada agora que a tabela reservations existe (a
-- oportunidade e criada antes da reserva, mas so fica ligada quando e
-- convertida em processo, fase GANHO).
alter table public.opportunities add column if not exists reservation_id text references public.reservations(id) on delete set null;

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
  locator text,
  quantity numeric(8,2) not null default 1,
  date_start text,
  date_end text,
  status text not null default 'PENDENTE',
  net_value numeric(12,2) not null default 0,
  pvp_value numeric(12,2) not null default 0,
  discount_percent numeric(5,2) not null default 0,
  option_deadline text,
  cancellation_terms text,
  paid boolean not null default false,
  paid_at timestamptz,
  cancel_reason text,
  refundable_amount numeric(12,2),
  refunded_amount numeric(12,2),
  refunded_at timestamptz,
  notes text
);

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
  description text,
  resolved boolean not null default false,
  resolution text
);

create index if not exists reservation_events_reservation_id_idx on public.reservation_events(reservation_id);

-- Reclamacao do cliente contra a agencia (direction=CUSTOMER_TO_AGENCY) ou
-- da agencia contra um fornecedor/operador (direction=AGENCY_TO_SUPPLIER).
-- Definida aqui (antes de documents) para o FK de documents.complaint_id
-- poder apontar para esta tabela.
create table if not exists public.complaints (
  id text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  customer_email text not null,
  reservation_id text references public.reservations(id) on delete set null,
  direction text not null default 'CUSTOMER_TO_AGENCY',
  supplier_id text,
  status text not null default 'OPEN',
  subject text not null,
  description text,
  claimed_amount numeric(12,2),
  received_amount numeric(12,2),
  paid_to_customer numeric(12,2),
  resolution text,
  resolved_at timestamptz
);

create index if not exists complaints_customer_email_idx on public.complaints(customer_email);

-- Tarefas do processo (separador "Tarefas") - checklist administrativo e
-- operacional (pedir passaportes, confirmar hotel, emitir seguro...).
-- reservation_id fica opcional: uma tarefa pode pertencer a uma
-- oportunidade (opportunity_id) em vez de um processo. assignee_staff_id
-- liga a um colaborador real; assignee (texto livre) fica so para
-- compatibilidade com tarefas antigas.
create table if not exists public.tasks (
  id text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  reservation_id text references public.reservations(id) on delete cascade,
  opportunity_id text references public.opportunities(id) on delete cascade,
  description text not null,
  assignee text,
  assignee_staff_id text references public.staff(id) on delete set null,
  due_date text,
  priority text not null default 'NORMAL',
  status text not null default 'TODO',
  completed_at timestamptz,
  notes text
);

create index if not exists tasks_reservation_id_idx on public.tasks(reservation_id);
create index if not exists tasks_status_idx on public.tasks(status);

-- reservation_id fica opcional: documentos podem estar ligados a uma
-- reserva especifica, a um cliente (passaporte de um membro do agregado
-- familiar, reutilizavel em reservas futuras) OU a um fornecedor
-- (contratos/acordos), sem reserva nenhuma associada. service_line_id e
-- um extra opcional: quando o documento pertence a uma reserva, pode
-- ainda ficar ligado a uma linha de servico especifica dessa reserva
-- (ex.: o voucher do hotel, o bilhete de aviao).
create table if not exists public.documents (
  id text primary key,
  created_at timestamptz not null default now(),
  reservation_id text references public.reservations(id) on delete cascade,
  customer_email text,
  supplier_id text,
  service_line_id text references public.reservation_service_lines(id) on delete set null,
  event_id text references public.reservation_events(id) on delete cascade,
  complaint_id text references public.complaints(id) on delete cascade,
  type text not null,
  passenger_name text,
  file_name text not null,
  storage_path text not null,
  uploaded_by text,
  -- So para documentos financeiros (separador Financeiro > Faturas e
  -- Documentos): numero/data/valor do documento emitido externamente -
  -- nunca gerados aqui, so registados para ficar ligado ao anexo.
  document_number text,
  document_date text,
  amount numeric(12,2),
  -- So para documentos pessoais (passaporte/CC/visto): permite alertar
  -- "passaporte expira em N meses" na ficha do cliente.
  expiry_date text,
  issuing_country text
);

create index if not exists documents_reservation_id_idx on public.documents(reservation_id);
create index if not exists documents_customer_email_idx on public.documents(customer_email);
create index if not exists documents_supplier_id_idx on public.documents(supplier_id);
create index if not exists documents_service_line_id_idx on public.documents(service_line_id);
create index if not exists documents_event_id_idx on public.documents(event_id);
create index if not exists documents_complaint_id_idx on public.documents(complaint_id);

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

-- Registo de contactos com o cliente (chamadas, emails, notas) - visao
-- tipo CRM na ficha do cliente no backoffice. reservation_id e opcional:
-- permite tambem consultar as comunicacoes de um processo especifico
-- (separador "Comunicacoes" da Ficha de Reserva).
-- opportunity_id: comunicacoes de uma oportunidade comercial. direction/
-- external_id/delivery_status: preparacao de esquema para uma integracao
-- real de WhatsApp/email/chat interno mais tarde - sem nenhuma
-- integracao ainda, so os campos prontos a receber esses dados.
create table if not exists public.contact_log (
  id text primary key,
  created_at timestamptz not null default now(),
  customer_email text not null,
  reservation_id text references public.reservations(id) on delete cascade,
  opportunity_id text references public.opportunities(id) on delete cascade,
  actor text,
  type text not null,
  summary text,
  direction text not null default 'OUTBOUND',
  external_id text,
  delivery_status text
);

create index if not exists contact_log_customer_email_idx on public.contact_log(customer_email);
create index if not exists contact_log_reservation_id_idx on public.contact_log(reservation_id);
create index if not exists contact_log_opportunity_id_idx on public.contact_log(opportunity_id);
create index if not exists tasks_opportunity_id_idx on public.tasks(opportunity_id);

alter table public.company_settings enable row level security;
alter table public.margins enable row level security;
alter table public.branches enable row level security;
alter table public.staff enable row level security;
alter table public.customers enable row level security;
alter table public.leads enable row level security;
alter table public.opportunities enable row level security;
alter table public.opportunity_events enable row level security;
alter table public.proposals enable row level security;
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

-- As regras de margem são internas. O site público recebe apenas PVP já calculado;
-- NET/margem nunca são expostos a anon/authenticated.
grant all on all tables in schema public to service_role;

-- Bucket privado para documentos de reservas. O acesso deve ser feito pelo servidor
-- com service role e URLs assinadas de curta duracao.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;
