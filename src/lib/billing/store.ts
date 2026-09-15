/**
 * Billing persistence.
 *
 * Server-only. The `subscriptions` and `billing_events` tables are reachable
 * only from this app server (Postgres sits on the private `net_data` network
 * with no published port) — never import this module into a React component.
 */

import { query, queryOne } from "../db";
import { extendedExpiry, type SubscriptionRecord } from "./entitlements";
import { planById, type PlanId } from "./plans";

/** Identity is the verified Google email, lowercased. */
function key(email: string): string {
  return email.trim().toLowerCase();
}

interface SubRow {
  email: string; plan_id: string; tier: string; expires_at: string; last_payment_ref: string | null;
}

export async function getSubscription(email: string): Promise<SubscriptionRecord | null> {
  const data = await queryOne<SubRow>(
    `select email, plan_id, tier, expires_at, last_payment_ref from subscriptions where email = $1`,
    [key(email)]
  );
  if (!data) return null;

  return {
    email: data.email,
    planId: data.plan_id as PlanId,
    tier: data.tier === "pro" ? "pro" : "free",
    expiresAt: new Date(data.expires_at).toISOString(),
    lastPaymentRef: data.last_payment_ref,
  };
}

/**
 * Record a paid purchase and extend access.
 *
 * Idempotent on `eventId`: the insert into `billing_events` is the lock, so a
 * retried webhook is rejected by the primary key rather than by a read the next
 * delivery could race. Returns false when the event had already been applied.
 */
export async function applyPurchase(opts: {
  eventId: string;
  eventType: string;
  email: string;
  planId: PlanId;
  amountCentavos: number | null;
  paymentRef: string | null;
  now?: Date;
}): Promise<{ applied: boolean; expiresAt: string | null }> {
  const plan = planById(opts.planId);
  if (!plan || !plan.purchasable) throw new Error(`plan ${opts.planId} is not purchasable`);

  const email = key(opts.email);

  try {
    await query(
      `insert into billing_events (event_id, event_type, email, plan_id, amount_centavos)
         values ($1, $2, $3, $4, $5)`,
      [opts.eventId, opts.eventType, email, opts.planId, opts.amountCentavos]
    );
  } catch (err: any) {
    // 23505 is unique_violation: this event has already been applied. That is
    // the expected outcome of a provider retry, not a failure — say so and
    // return 2xx, or the provider retries forever.
    if (err?.code === "23505") {
      const existing = await getSubscription(email);
      return { applied: false, expiresAt: existing?.expiresAt ?? null };
    }
    throw new Error(`could not record billing event: ${err instanceof Error ? err.message : err}`);
  }

  const existing = await getSubscription(email);
  const expiresAt = extendedExpiry(existing?.expiresAt ?? null, opts.planId, opts.now ?? new Date());

  try {
    await query(
      `insert into subscriptions (email, plan_id, tier, expires_at, last_payment_ref, updated_at)
         values ($1, $2, $3, $4, $5, now())
       on conflict (email) do update set
         plan_id = excluded.plan_id, tier = excluded.tier, expires_at = excluded.expires_at,
         last_payment_ref = excluded.last_payment_ref, updated_at = now()`,
      [email, opts.planId, plan.tier, expiresAt, opts.paymentRef]
    );
  } catch (err) {
    // The event is recorded but access was not granted — the worst state to
    // leave quiet, because the customer has paid and the retry will now be
    // treated as a duplicate. Loud enough to find in the logs.
    console.error(
      `[billing] PAID BUT NOT GRANTED — event ${opts.eventId}, ${email}, ${opts.planId}: ${err instanceof Error ? err.message : err}`,
    );
    throw new Error(`could not grant access: ${err instanceof Error ? err.message : err}`);
  }

  return { applied: true, expiresAt };
}
