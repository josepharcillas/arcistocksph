-- ArciStocks PH — Supabase Schema
-- Run this in the Supabase SQL editor

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Profiles (auto-created on first login via trigger)
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  display_name text,
  avatar_url text,
  leaderboard_opt_in boolean default false,
  created_at timestamptz default now()
);
alter table profiles enable row level security;
create policy "Users can view own profile" on profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);

-- Auto-create profile on signup.
-- NOTE: must schema-qualify `public.profiles` AND pin search_path — the GoTrue
-- auth connection does not have `public` on its search_path, so an unqualified
-- reference makes signup fail with "Database error creating new user".
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- Holdings (real portfolio)
create table holdings (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users on delete cascade not null,
  ticker text not null,
  company_name text,
  qty numeric not null check (qty > 0),
  buy_price numeric not null check (buy_price > 0),
  buy_date date not null default current_date,
  notes text,
  created_at timestamptz default now()
);
alter table holdings enable row level security;
create policy "Users manage own holdings" on holdings using (auth.uid() = user_id);

-- Watchlist
create table watchlist (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users on delete cascade not null,
  ticker text not null,
  company_name text,
  alert_price_above numeric,
  alert_price_below numeric,
  notify_push boolean default true,
  created_at timestamptz default now(),
  unique(user_id, ticker)
);
alter table watchlist enable row level security;
create policy "Users manage own watchlist" on watchlist using (auth.uid() = user_id);

-- Paper trading balances (₱100,000 default)
create table paper_balances (
  user_id uuid references auth.users on delete cascade primary key,
  balance numeric not null default 100000,
  updated_at timestamptz default now()
);
alter table paper_balances enable row level security;
create policy "Users manage own paper balance" on paper_balances using (auth.uid() = user_id);

-- Paper trades log
create table paper_trades (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users on delete cascade not null,
  ticker text not null,
  company_name text,
  action text not null check (action in ('BUY', 'SELL')),
  qty numeric not null check (qty > 0),
  price numeric not null check (price > 0),
  total numeric generated always as (qty * price) stored,
  traded_at timestamptz default now()
);
alter table paper_trades enable row level security;
create policy "Users manage own paper trades" on paper_trades using (auth.uid() = user_id);

-- Daily portfolio-value snapshots (powers leaderboard week/month returns).
-- Written server-side by the snapshot cron; one row per user per day.
create table balance_snapshots (
  user_id uuid references auth.users on delete cascade not null,
  snapshot_date date not null,
  total_value numeric not null,
  primary key (user_id, snapshot_date)
);
alter table balance_snapshots enable row level security;
create policy "Users read own snapshots" on balance_snapshots for select using (auth.uid() = user_id);

-- Push notification subscriptions
create table push_subscriptions (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users on delete cascade not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now(),
  unique(user_id, endpoint)
);
alter table push_subscriptions enable row level security;
create policy "Users manage own push subs" on push_subscriptions using (auth.uid() = user_id);

-- Per-stock push opt-out. Absence of a row = opted in (default on). A row with
-- enabled = false suppresses alerts for that ticker.
create table push_preferences (
  user_id uuid references auth.users on delete cascade not null,
  ticker text not null,
  enabled boolean not null default true,
  primary key (user_id, ticker)
);
alter table push_preferences enable row level security;
create policy "Users manage own push prefs" on push_preferences using (auth.uid() = user_id);

-- Signal cache (avoid re-calling AI on every visit)
create table signal_cache (
  ticker text primary key,
  verdict text not null check (verdict in ('BUY', 'SELL', 'HOLD')),
  confidence text not null,
  rationale text not null,
  target_price numeric,
  stop_loss numeric,
  provider text,
  computed_at timestamptz default now()
);
-- No RLS — signal cache is public read, server-only write

-- ---------------------------------------------------------------------------
-- Role grants. Hosted Supabase auto-grants new tables to anon/authenticated via
-- default privileges, but a raw schema.sql does NOT — without these, PostgREST
-- returns "permission denied for table ...". RLS policies above still restrict
-- which ROWS each role can see; these grants only open the tables at all.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
