/**
 * Resolving what the current request is allowed to do.
 *
 * The one place API routes and pages should ask. Fails OPEN to the free tier:
 * if billing is misconfigured or the database is briefly unreachable, visitors
 * still get the free product rather than an error page. A billing outage must
 * never become a site outage.
 */

import { resolveAccess, requireEntitlement, type Access } from "./entitlements";
import { FREE_ENTITLEMENTS, type Entitlements } from "./plans";
import { getSubscription } from "./store";

export type { Access };

const ANONYMOUS: Access = {
  state: "none",
  entitlements: FREE_ENTITLEMENTS,
  expiresAt: null,
  daysRemaining: 0,
  renewalDue: false,
};

/** @param user `locals.user` from the session middleware. */
export async function accessFor(user: { email?: string } | null | undefined): Promise<Access> {
  if (!user?.email) return ANONYMOUS;

  try {
    return resolveAccess(await getSubscription(user.email));
  } catch (err) {
    console.error("[billing] access lookup failed, falling back to free:", err);
    return ANONYMOUS;
  }
}

/**
 * Guard a premium API route.
 *
 * Returns a 402 Response to return directly, or null when the caller may
 * proceed. 402 Payment Required rather than 403: the client can tell the
 * difference between "you may not" and "you have not paid yet", and show a
 * pricing link instead of an error.
 */
export async function guard(
  user: { email?: string } | null | undefined,
  capability: keyof Omit<Entitlements, "tier" | "watchlistLimit" | "aiRequestsPerDay">,
): Promise<Response | null> {
  const access = await accessFor(user);
  const denial = requireEntitlement(access, capability);
  if (!denial) return null;

  return new Response(
    JSON.stringify({ error: denial, upgrade: "/pricing", tier: access.entitlements.tier }),
    { status: 402, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
  );
}
