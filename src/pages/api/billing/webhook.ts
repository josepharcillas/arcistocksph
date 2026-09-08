import type { APIRoute } from "astro";
import {
  verifyWebhookSignature,
  parseWebhookEvent,
  isPaidEvent,
  isConfigured,
} from "../../../lib/billing/paymongo";
import { applyPurchase } from "../../../lib/billing/store";
import { planById, type PlanId } from "../../../lib/billing/plans";

export const prerender = false;

/**
 * PayMongo webhook — the ONLY place access is ever granted.
 *
 * The browser returning from a successful checkout proves nothing: that URL can
 * be visited by anyone, at any time, as many times as they like. Money is a
 * fact the payment provider tells us about server to server.
 *
 * ## Status codes matter here
 *
 * PayMongo retries anything that is not 2xx. So:
 *  - bad signature        -> 401, never retried, never processed
 *  - event we ignore      -> 200, so it is not retried forever
 *  - already applied      -> 200, the retry has done its job
 *  - our database is down -> 500, BECAUSE we want the retry
 *
 * Returning 200 on a real failure loses the payment silently. Returning 500 on
 * an event we simply do not handle produces an infinite retry loop.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!isConfigured()) {
    console.error("[billing] webhook received but PayMongo is not configured");
    return json(500, { error: "billing not configured" });
  }

  // The raw text, exactly as sent. Parsing and re-serialising reorders keys and
  // the signature can never match again.
  const rawBody = await request.text();

  const verdict = verifyWebhookSignature({
    rawBody,
    signatureHeader: request.headers.get("paymongo-signature"),
  });

  if (!verdict.ok) {
    console.warn(`[billing] rejected webhook: ${verdict.reason}`);
    return json(401, { error: "invalid signature" });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Signed by us but not JSON: nothing to retry into existence.
    return json(200, { ignored: "unparseable body" });
  }

  const event = parseWebhookEvent(payload);

  if (!isPaidEvent(event.type)) {
    return json(200, { ignored: event.type || "unknown event" });
  }

  const eventId = (payload as any)?.data?.id;
  if (!eventId) return json(200, { ignored: "event has no id" });

  if (!event.email || !event.planId) {
    // Paid, but we cannot tell whose account to extend. Never retry into a
    // guess — this needs a human with the payment reference in hand.
    console.error(
      `[billing] PAID BUT UNATTRIBUTABLE — event ${eventId}, ref ${event.referenceNumber}, ` +
        `email=${event.email}, plan=${event.planId}`,
    );
    return json(200, { ignored: "missing email or plan in metadata" });
  }

  const plan = planById(event.planId);
  if (!plan || !plan.purchasable) {
    console.error(`[billing] PAID FOR UNKNOWN PLAN — event ${eventId}, plan ${event.planId}`);
    return json(200, { ignored: "unknown plan" });
  }

  // Charged the wrong amount for the plan claimed. Metadata is round-tripped
  // through the provider, so this should be impossible — which is exactly why
  // it is worth checking rather than trusting.
  if (event.amountCentavos !== null && event.amountCentavos !== plan.priceCentavos) {
    console.error(
      `[billing] AMOUNT MISMATCH — event ${eventId}, plan ${plan.id} costs ` +
        `${plan.priceCentavos} but ${event.amountCentavos} was paid`,
    );
    return json(200, { ignored: "amount does not match plan" });
  }

  try {
    const result = await applyPurchase({
      eventId,
      eventType: event.type,
      email: event.email,
      planId: event.planId as PlanId,
      amountCentavos: event.amountCentavos,
      paymentRef: event.paymentRef,
    });

    console.log(
      `[billing] ${result.applied ? "granted" : "duplicate"} ${plan.id} to ${event.email}` +
        ` until ${result.expiresAt}`,
    );
    return json(200, { ok: true, applied: result.applied, expiresAt: result.expiresAt });
  } catch (err) {
    // A 500 is correct: we want PayMongo to deliver this again.
    console.error(`[billing] failed to apply event ${eventId}:`, err);
    return json(500, { error: "could not apply payment" });
  }
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
