-- TikGen AI (TikTok Video AI) - Supabase schema (MVP paid launch)
-- Apply in Supabase SQL Editor.

-- Enable pgcrypto for gen_random_uuid
create extension if not exists pgcrypto;

-- Users table (mirrors Supabase auth.users, but allows extra profile fields)
create table if not exists public.users (
  id uuid primary key,
  email text unique,
  display_name text,
  created_at timestamptz not null default now()
);

-- Subscription / entitlement
create table if not exists public.subscriptions (
  user_id uuid primary key references public.users(id) on delete cascade,
  plan_id text not null check (plan_id in ('trial','basic','pro','enterprise')),
  status text not null check (status in ('active','past_due','canceled','expired')),
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  auto_renew boolean not null default true,
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_status_idx on public.subscriptions(status);
create index if not exists subscriptions_period_end_idx on public.subscriptions(current_period_end);

-- Orders (payment provider)
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null check (provider in ('xorpay')),
  provider_order_id text not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'CNY',
  status text not null check (status in ('created','paid','failed','refunded')),
  plan_id text not null check (plan_id in ('trial','basic','pro','enterprise')),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  raw jsonb
);

create unique index if not exists orders_provider_order_id_uniq on public.orders(provider, provider_order_id);
create index if not exists orders_user_idx on public.orders(user_id, created_at desc);

-- Usage ledger (metering + idempotency)
create table if not exists public.usage_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null check (type in ('video','image','llm')),
  units integer not null default 1 check (units > 0),
  request_idempotency_key text not null,
  related_task_id text,
  created_at timestamptz not null default now(),
  result_json jsonb
);

create unique index if not exists usage_ledger_idempotency_uniq on public.usage_ledger(user_id, request_idempotency_key);
create index if not exists usage_ledger_user_day_idx on public.usage_ledger(user_id, type, created_at desc);

-- Generation tasks (optional but useful for history)
create table if not exists public.generation_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null check (type in ('video','image')),
  model text,
  status text not null default 'submitted',
  provider_task_id text,
  output_url text,
  prompt_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  raw jsonb
);

create index if not exists generation_tasks_user_idx on public.generation_tasks(user_id, created_at desc);

-- Assets library (user uploads + AI outputs), permanently retained
create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  source text not null check (source in ('user_upload','ai_generated')),
  type text not null check (type in ('image','video')),
  url text not null,
  name text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists assets_user_created_idx on public.assets(user_id, created_at desc);
create index if not exists assets_user_source_idx on public.assets(user_id, source, created_at desc);

