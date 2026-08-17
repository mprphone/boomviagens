-- Boomviagens - Pricing V2 (17/08/2026)
-- Executar uma vez no Supabase SQL Editor antes de usar regras por operador/canal/produto.

alter table public.margins add column if not exists operator_name text not null default '*';
alter table public.margins add column if not exists channel text not null default '*';
alter table public.margins add column if not exists product_type text not null default '*';
alter table public.margins add column if not exists minimum_percent numeric(5,2) not null default 0;
alter table public.margins add column if not exists rebate_percent numeric(5,2) not null default 0;

-- A grelha de margens é informação interna. A aplicação pública já não precisa desta view.
drop view if exists public.public_margins;

-- Service role continua a ler/escrever a tabela via backend; não criar policies/grants anon.
