/**
 * Billing persistence.
 *
 * Service-role only. `subscriptions` and `billing_events` have RLS enabled with
 * no policies, so the anon key cannot read or write them at all — never import
 * this module into a React component.
 */

import { createSupabaseAdmin } from "../supabase-admin";
import { extendedExpiry, type SubscriptionRecord } from "./entitlements";
import { planById, type PlanId } from "./plans";

/** Identity is the verified Google email, lowercased. */
function key(email: string): string {
  return email.trim().toLowerCase();
}

export async function getSubscription(email: string): Promise<SubscriptionRecord | null> {
  const db = createSupabaseAdmin();
  const { data, error } = await db
    .from("subscriptions")
    .select("email, plan_id, tier, expires_at, last_payment_ref")
    .eq("email", key(email))
    .maybeSingle();

  // A read failure must not look like "not subscribed" to the caller, or a
  // transient database blip silently downgrades a paying customer mid-session.
  if (error) throw new Error(`subscription lookup failed: ${error.message}`);
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

  const db = createSupabaseAdmin();
  const email = key(opts.email);

  const claim = await db.from("billing_events").insert({
    event_id: opts.eventId,
    event_type: opts.eventType,
    email,
    plan_id: opts.planId,
    amount_centavos: opts.amountCentavos,
  });

  if (claim.error) {
    // 23505 is unique_violation: this event has already been applied. That is
    // the expected outcome of a provider retry, not a failure — say so and
    // return 2xx, or the provider retries forever.
    if (claim.error.code === "23505") {
      const existing = await getSubscription(email);
      return { applied: false, expiresAt: existing?.expiresAt ?? null };
    }
    throw new Error(`could not record billing event: ${claim.error.message}`);
  }

  const existing = await getSubscription(email);
  const expiresAt = extendedExpiry(existing?.expiresAt ?? null, opts.planId, opts.now ?? new Date());

  const { error } = await db.from("subscriptions").upsert(
    {
      email,
      plan_id: opts.planId,
      tier: plan.tier,
      expires_at: expiresAt,
      last_payment_ref: opts.paymentRef,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "email" },
  );

  if (error) {
    // The event is recorded but access was not granted — the worst state to
    // leave quiet, because the customer has paid and the retry will now be
    // treated as a duplicate. Loud enough to find in the logs.
    console.error(
      `[billing] PAID BUT NOT GRANTED — event ${opts.eventId}, ${email}, ${opts.planId}: ${error.message}`,
    );
    throw new Error(`could not grant access: ${error.message}`);
  }

  return { applied: true, expiresAt };
}
