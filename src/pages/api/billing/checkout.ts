import type { APIRoute } from "astro";
import { randomUUID } from "node:crypto";
import { createCheckoutSession, isConfigured } from "../../../lib/billing/paymongo";
import { planById, type PlanId } from "../../../lib/billing/plans";

export const prerender = false;

/**
 * Start a checkout for the signed-in user.
 *
 * The plan comes from the request, but the EMAIL never does — it is taken from
 * the session. A checkout that let the client name the account to credit is a
 * checkout that lets anyone buy Pro for someone else's account, or, with a
 * tampered success flow, for free.
 */
export const POST: APIRoute = async ({ request, locals, url }) => {
  const user = (locals as any).user as { email?: string } | undefined;
  if (!user?.email) return json(401, { error: "Sign in to subscribe." });

  if (!isConfigured()) return json(503, { error: "Payments are not available right now." });

  let planId: string | undefined;
  try {
    planId = (await request.json())?.planId;
  } catch {
    return json(400, { error: "Invalid request body." });
  }

  const plan = planId ? planById(planId) : null;
  if (!plan || !plan.purchasable) return json(400, { error: "Unknown plan." });

  // Ours, not the provider's: it appears on the customer's receipt and is what
  // support searches for when someone says "I paid and nothing happened".
  const referenceNumber = `AS-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`;

  try {
    const session = await createCheckoutSession({
      planId: plan.id as PlanId,
      email: user.email,
      successUrl: new URL("/dashboard?upgraded=1", url.origin).toString(),
      cancelUrl: new URL("/pricing?cancelled=1", url.origin).toString(),
      referenceNumber,
    });

    return json(200, { checkoutUrl: session.checkoutUrl, referenceNumber });
  } catch (err) {
    console.error("[billing] checkout creation failed:", err);
    return json(502, { error: "Could not start checkout. Please try again." });
  }
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
