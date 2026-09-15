-- ArciStocks PH — Postgres schema
--
-- Runs on the arcitools home stack's shared Postgres (`arcitools-postgres-1`),
-- database `stocks`. Apply with:
--   docker exec -i arcitools-postgres-1 psql -U arcitools -d stocks < docs/schema.sql
--
-- Formerly a hosted-Supabase schema. Three things changed when that project was
-- deleted and the app moved in-house:
--
--  * No RLS, no policies, no role grants. Supabase let the BROWSER talk to
--    Postgres directly, so row-level security was the only thing standing
--    between one user's rows and another's. Here Postgres sits on `net_data`
--    with no published port, reachable only by the app server, which scopes
--    every query to the session's user. The trust boundary moved from the
--    database to the API layer.
--  * `user_id` is the verified Google email (text), not an `auth.users` uuid.
--    There is no auth schema to reference any more, and an email survives a
--    database rebuild — which, given how we got here, is the point.
--  * No signup trigger. `profiles` rows are created by the app on first sign-in.

-- gen_random_uuid() is built in from PG13; no uuid-ossp needed.

-- One row per person who has ever signed in. Created on first sign-in.
create table if not exists profiles (
  id text primary key,              -- verified Google email, lowercased
  display_name text,
  avatar_url text,
  leaderboard_opt_in boolean default false,
  created_at timestamptz default now()
);

-- Holdings (real portfolio)
create table if not exists holdings (
  id uuid default gen_random_uuid() primary key,
  user_id text references profiles on delete cascade not null,
  ticker text not null,
  company_name text,
  qty numeric not null check (qty > 0),
  buy_price numeric not null check (buy_price > 0),
  buy_date date not null default current_date,
  peak_price numeric, -- highest price seen since entry (auto-trade bot trailing stop)
  notes text,
  created_at timestamptz default now()
);
create index if not exists holdings_user_idx on holdings (user_id);

-- Real-portfolio cash balance (so the portfolio can show Total Account Equity =
-- cash + holdings value, like a broker). Editable by the user.
create table if not exists portfolio_cash (
  user_id text references profiles on delete cascade primary key,
  cash numeric not null default 0,
  updated_at timestamptz default now()
);

-- Watchlist
create table if not exists watchlist (
  id uuid default gen_random_uuid() primary key,
  user_id text references profiles on delete cascade not null,
  ticker text not null,
  company_name text,
  alert_price_above numeric,
  alert_price_below numeric,
  notify_push boolean default true,
  created_at timestamptz default now(),
  unique(user_id, ticker)
);

-- Paper trading balances (PHP 100,000 default)
create table if not exists paper_balances (
  user_id text references profiles on delete cascade primary key,
  balance numeric not null default 100000,
  updated_at timestamptz default now()
);

-- Paper trades log
create table if not exists paper_trades (
  id uuid default gen_random_uuid() primary key,
  user_id text references profiles on delete cascade not null,
  ticker text not null,
  company_name text,
  action text not null check (action in ('BUY', 'SELL')),
  qty numeric not null check (qty > 0),
  price numeric not null check (price > 0),
  total numeric generated always as (qty * price) stored,
  reason text, -- bot decision rationale (null for manual user trades); powers /dashboard/bots
  traded_at timestamptz default now()
);
create index if not exists paper_trades_user_idx on paper_trades (user_id, traded_at desc);

-- Daily portfolio-value snapshots (powers leaderboard week/month returns).
-- Written server-side by the snapshot cron; one row per user per day.
create table if not exists balance_snapshots (
  user_id text references profiles on delete cascade not null,
  snapshot_date date not null,
  total_value numeric not null,
  primary key (user_id, snapshot_date)
);

-- Push notification subscriptions
create table if not exists push_subscriptions (
  id uuid default gen_random_uuid() primary key,
  user_id text references profiles on delete cascade not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now(),
  unique(user_id, endpoint)
);

-- Per-stock push opt-out. Absence of a row = opted in (default on). A row with
-- enabled = false suppresses alerts for that ticker.
create table if not exists push_preferences (
  user_id text references profiles on delete cascade not null,
  ticker text not null,
  enabled boolean not null default true,
  primary key (user_id, ticker)
);

-- Dedup state for advisor push alerts: the last headline-action signature pushed
-- to each user, so the advisor-alerts cron only notifies on a *change*.
create table if not exists advisor_alert_state (
  user_id text references profiles on delete cascade primary key,
  signature text,
  updated_at timestamptz default now()
);

-- Signal cache (avoid re-calling AI on every visit). Shared across all users.
create table if not exists signal_cache (
  ticker text primary key,
  verdict text not null check (verdict in ('BUY', 'SELL', 'HOLD')),
  confidence text not null,
  rationale text not null,
  target_price numeric,
  stop_loss numeric,
  provider text,
  above_sma200 boolean, -- price > 200-day SMA at signal time (bot trend filter)
  turnover20d numeric,  -- median daily peso value traded (~20 sessions) — liquidity floor
  rsi14 numeric,        -- 14-day RSI at signal time (dividend tracker entry rating)
  pct_from_low numeric, -- % above the trailing (~52wk) low at signal time (Dip Radar washout)
  macd_hist numeric,    -- MACD histogram at signal time (Dip Radar momentum turn)
  computed_at timestamptz default now()
);

-- Signal history — append-only log of every fresh signal + the price at the time,
-- so we can measure how accurate the signals turned out to be (/api/signals/accuracy).
create table if not exists signal_history (
  id uuid default gen_random_uuid() primary key,
  ticker text not null,
  verdict text not null check (verdict in ('BUY', 'SELL', 'HOLD')),
  confidence text not null,
  price numeric not null,
  source text,         -- what asked for this signal: held | watch | discovery | active | user
  arm text,            -- discovery sampling arm: weighted | control (null otherwise)
  turnover20d numeric, -- liquidity at signal time, so accuracy can be decomposed by tier
  created_at timestamptz default now()
);
create index if not exists signal_history_created_idx on signal_history (created_at);

-- Cash dividend declarations scraped from PSE Edge (Disclosure Form 6-1).
-- Feeds the /dividends tracker (TTM-yield ranking + entry ratings) and the DCA
-- bot's dividend crediting.
create table if not exists dividends (
  edge_no text primary key,     -- PSE Edge disclosure id (dedup key)
  circular_no text,             -- e.g. C05077-2026
  ticker text not null,
  company_name text,
  amount numeric not null,      -- per share, in PHP (USD declarations converted)
  raw_amount numeric,           -- as declared, in `currency`
  currency text not null default 'PHP',
  div_type text,                -- Regular | Special
  security_type text,           -- COMMON | PREFERRED | OTHERS (yields use COMMON only)
  record_date date,
  payment_date date,
  announced_at timestamptz,     -- disclosure announce time
  created_at timestamptz default now()
);
create index if not exists dividends_ticker_record_idx on dividends (ticker, record_date);
create index if not exists dividends_payment_idx on dividends (payment_date);

-- Dedup for dividend entry push alerts: one row per ticker holding the last
-- alerted signature, so the daily job only notifies on a *change*.
create table if not exists dividend_alert_state (
  ticker text primary key,
  signature text,
  sent_at timestamptz default now()
);

-- Idempotency ledger for the DCA bot's dividend income: one credit per
-- (user, disclosure), so re-runs never double-pay.
create table if not exists dca_dividend_credits (
  user_id text references profiles on delete cascade,
  edge_no text references dividends on delete cascade,
  pesos numeric not null,
  credited_at timestamptz default now(),
  primary key (user_id, edge_no)
);
