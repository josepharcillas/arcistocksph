/**
 * Turning a payment record into permission.
 *
 * Every decision here is pure and unit-tested, because the alternative is
 * discovering the rule was wrong from a customer who paid and got nothing.
 * Nothing in this file talks to a database or a payment provider.
 */

import {
  FREE_ENTITLEMENTS,
  entitlementsForTier,
  planById,
  type Entitlements,
  type PlanId,
  type Tier,
} from "./plans";

/** What the database stores for one customer. */
export interface SubscriptionRecord {
  /** Stable user key — the verified Google email, lowercased. */
  email: string;
  planId: PlanId;
  tier: Tier;
  /** ISO timestamp. Access ends at this instant. */
  expiresAt: string;
  /** Last payment reference from the provider, for support and reconciliation. */
  lastPaymentRef?: string | null;
}

export type AccessState = "none" | "active" | "expired";

export interface Access {
  state: AccessState;
  entitlements: Entitlements;
  expiresAt: string | null;
  /** Whole days left, floored. Zero when access has ended. */
  daysRemaining: number;
  /**
   * True in the last week of a paid period. The UI uses this to prompt a
   * renewal, which is the whole reason a fixed period needs no auto-charge.
   */
  renewalDue: boolean;
}

const DAY_MS = 86_400_000;
const RENEWAL_WINDOW_DAYS = 7;

/**
 * Resolve what a user may do right now.
 *
 * A missing, malformed or lapsed record all resolve to the free tier rather
 * than to an error. Billing state must never be able to lock someone out of the
 * free product: a bad row is a support ticket, but a hard failure here is an
 * outage for every visitor.
 */
export function resolveAccess(
  subscription: SubscriptionRecord | null | undefined,
  now: Date = new Date(),
): Access {
  if (!subscription) {
    return { state: "none", entitlements: FREE_ENTITLEMENTS, expiresAt: null, daysRemaining: 0, renewalDue: false };
  }

  const expiry = new Date(subscription.expiresAt);
  if (Number.isNaN(expiry.getTime())) {
    return { state: "none", entitlements: FREE_ENTITLEMENTS, expiresAt: null, daysRemaining: 0, renewalDue: false };
  }

  const remainingMs = expiry.getTime() - now.getTime();

  if (remainingMs <= 0) {
    return {
      state: "expired",
      entitlements: FREE_ENTITLEMENTS,
      expiresAt: subscription.expiresAt,
      daysRemaining: 0,
      renewalDue: true,
    };
  }

  // Trust the tier recorded on the row, not the plan id: plans are renamed and
  // repriced over time, and a customer who paid must keep what they bought even
  // if the plan they bought it under no longer exists.
  const tier: Tier = subscription.tier === "pro" ? "pro" : "free";
  const daysRemaining = Math.floor(remainingMs / DAY_MS);

  return {
    state: "active",
    entitlements: entitlementsForTier(tier),
    expiresAt: subscription.expiresAt,
    daysRemaining,
    renewalDue: daysRemaining <= RENEWAL_WINDOW_DAYS,
  };
}

/**
 * When access should end after buying `planId`.
 *
 * Extends from the later of now and the current expiry, so buying a renewal
 * early adds to what is left instead of throwing it away. Someone with 12 days
 * remaining who renews gets 42, not 30 — the alternative quietly penalises the
 * most loyal customers and produces a support ticket every time.
 */
export function extendedExpiry(
  currentExpiry: string | null | undefined,
  planId: PlanId,
  now: Date = new Date(),
): string {
  const plan = planById(planId);
  if (!plan || plan.days <= 0) {
    throw new Error(`plan ${planId} grants no access period`);
  }

  let from = now.getTime();
  if (currentExpiry) {
    const existing = new Date(currentExpiry).getTime();
    if (!Number.isNaN(existing) && existing > from) from = existing;
  }

  return new Date(from + plan.days * DAY_MS).toISOString();
}

/** Guard for API routes. Returns null when allowed, or a reason when not. */
export function requireEntitlement(
  access: Access,
  capability: keyof Omit<Entitlements, "tier" | "watchlistLimit" | "aiRequestsPerDay">,
): string | null {
  return access.entitlements[capability]
    ? null
    : "This feature is part of ArciStocks Pro.";
}
