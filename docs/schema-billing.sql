-- ArciStocks PH — billing schema
-- Run in the Supabase SQL editor. Safe to re-run.

-- ---------------------------------------------------------------------------
-- Why these tables are keyed on email, and have no RLS policies
--
-- Identity is now the verified Google email carried in a signed session cookie
-- (see src/lib/auth.ts), NOT a Supabase auth.users row. So `auth.uid()` is null
-- for every request and an RLS policy written against it would deny everyone.
--
-- RLS is therefore enabled with NO policies at all, which denies every client
-- using the anon key outright. Only the service-role client reaches these rows,
-- and it is only ever imported server-side. That is deliberate: billing state
-- must never be readable or writable from the browser, and "no policy" is a
-- stronger guarantee than any policy anyone could write here.
-- ---------------------------------------------------------------------------

create table if not exists subscriptions (
  email           text primary key,
  plan_id         text not null,
  tier            text not null check (tier in ('free', 'pro')),
  expires_at      timestamptz not null,
  last_payment_ref text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table subscriptions enable row level security;

create index if not exists subscriptions_expires_at_idx on subscriptions (expires_at);

-- ---------------------------------------------------------------------------
-- Processed webhook events.
--
-- PayMongo retries a webhook until it gets a 2xx, so the same payment WILL
-- arrive more than once. Without this table a retry extends the customer's
-- access a second time from the same money — and the retry is invisible,
-- because both attempts look identical and both succeed.
--
-- The primary key is the provider's event id, so the insert itself is the lock:
-- a duplicate raises a unique violation instead of racing a read-then-write.
-- ---------------------------------------------------------------------------

create table if not exists billing_events (
  event_id     text primary key,
  event_type   text not null,
  email        text,
  plan_id      text,
  amount_centavos integer,
  processed_at timestamptz not null default now()
);

alter table billing_events enable row level security;

create index if not exists billing_events_email_idx on billing_events (email);
