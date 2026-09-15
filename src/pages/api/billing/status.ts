import type { APIRoute } from "astro";
import { accessFor } from "../../../lib/billing/access";

export const prerender = false;

/**
 * What the current user is entitled to.
 *
 * The client uses this to decide what to show. It is NOT what protects a
 * premium feature — every gated endpoint calls `guard()` itself, because
 * anything the browser decides is a decision an attacker also gets to make.
 */
export const GET: APIRoute = async ({ locals }) => {
  const user = (locals as any).user as { email?: string } | undefined;
  const access = await accessFor(user);

  return new Response(
    JSON.stringify({
      signedIn: Boolean(user?.email),
      tier: access.entitlements.tier,
      state: access.state,
      expiresAt: access.expiresAt,
      daysRemaining: access.daysRemaining,
      renewalDue: access.renewalDue,
      entitlements: {
        ...access.entitlements,
        // Infinity does not survive JSON.stringify — it becomes null, and the
        // client reads null as "no watchlist allowed" rather than "unlimited".
        watchlistLimit: Number.isFinite(access.entitlements.watchlistLimit)
          ? access.entitlements.watchlistLimit
          : null,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
  );
};
