/**
 * PayMongo — checkout sessions and webhook verification.
 *
 * PayMongo rather than Stripe because it settles GCash, Maya and GrabPay
 * alongside cards. In the Philippines a card-only checkout turns most of the
 * addressable market away at the last step.
 *
 * Everything provider-specific is confined to this file. The rest of the
 * billing code works in plans, entitlements and dates, so a second provider
 * means another file like this one and nothing else.
 *
 * > **Before going live**, re-read PayMongo's current API reference and confirm
 * > the request shape and the webhook signature scheme below still match. This
 * > is written to their documented v1 behaviour, but a payment integration that
 * > "looks right" and is subtly wrong fails by silently not granting access to
 * > someone who has been charged. Test with a real sandbox event, not only with
 * > the unit tests.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { planById, type PlanId } from "./plans";

const API_BASE = "https://api.paymongo.com/v1";

function env(key: string): string | undefined {
  // Astro exposes build-time env on import.meta.env and runtime on process.env.
  return (import.meta as any).env?.[key] ?? process.env[key];
}

export function secretKey(): string {
  const key = env("PAYMONGO_SECRET_KEY");
  if (!key) throw new Error("PAYMONGO_SECRET_KEY is not set");
  return key;
}

export function webhookSecret(): string {
  const key = env("PAYMONGO_WEBHOOK_SECRET");
  if (!key) throw new Error("PAYMONGO_WEBHOOK_SECRET is not set");
  return key;
}

export function isConfigured(): boolean {
  return Boolean(env("PAYMONGO_SECRET_KEY") && env("PAYMONGO_WEBHOOK_SECRET"));
}

/** PayMongo authenticates with the secret key as HTTP Basic username. */
function authHeader(): string {
  return `Basic ${Buffer.from(`${secretKey()}:`).toString("base64")}`;
}

export interface CheckoutSession {
  id: string;
  checkoutUrl: string;
  referenceNumber: string;
}

/**
 * Create a hosted checkout session for one plan.
 *
 * `email` goes into metadata because the webhook is the only place access is
 * granted, and the webhook must be able to tell whose account to extend without
 * trusting anything the browser sends back.
 */
export async function createCheckoutSession(opts: {
  planId: PlanId;
  email: string;
  successUrl: string;
  cancelUrl: string;
  referenceNumber: string;
  fetchImpl?: typeof fetch;
}): Promise<CheckoutSession> {
  const plan = planById(opts.planId);
  if (!plan || !plan.purchasable) throw new Error(`plan ${opts.planId} is not purchasable`);

  const doFetch = opts.fetchImpl ?? fetch;

  const res = await doFetch(`${API_BASE}/checkout_sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader() },
    body: JSON.stringify({
      data: {
        attributes: {
          line_items: [
            {
              currency: "PHP",
              amount: plan.priceCentavos,
              name: `ArciStocks ${plan.name}`,
              quantity: 1,
            },
          ],
          payment_method_types: ["gcash", "paymaya", "card", "grab_pay"],
          success_url: opts.successUrl,
          cancel_url: opts.cancelUrl,
          reference_number: opts.referenceNumber,
          description: `ArciStocks PH — ${plan.name}`,
          // The webhook reads these back. Never derive the granted plan from
          // anything the returning browser supplies.
          metadata: {
            email: opts.email,
            plan_id: opts.planId,
            reference_number: opts.referenceNumber,
          },
        },
      },
    }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = body?.errors?.[0]?.detail ?? `HTTP ${res.status}`;
    throw new Error(`PayMongo checkout failed: ${detail}`);
  }

  const checkoutUrl = body?.data?.attributes?.checkout_url;
  const id = body?.data?.id;
  if (!checkoutUrl || !id) throw new Error("PayMongo returned no checkout URL");

  return { id, checkoutUrl, referenceNumber: opts.referenceNumber };
}

/**
 * Verify a webhook signature.
 *
 * The header looks like `t=<unix>,te=<test sig>,li=<live sig>`, and the signed
 * value is `<t>.<raw body>` under HMAC-SHA256 with the webhook secret.
 *
 * The RAW body must be passed, exactly as received. `JSON.parse` followed by
 * `JSON.stringify` reorders keys and drops whitespace, and the signature will
 * never match again — this is the single most common way a webhook integration
 * fails, and it fails closed, so paying customers get nothing.
 */
export function verifyWebhookSignature(opts: {
  rawBody: string;
  signatureHeader: string | null | undefined;
  secret?: string;
  /** Reject events older than this. Blocks replay of a captured request. */
  toleranceSeconds?: number;
  now?: Date;
  mode?: "live" | "test";
}): { ok: true } | { ok: false; reason: string } {
  const { rawBody, signatureHeader } = opts;
  if (!signatureHeader) return { ok: false, reason: "missing signature header" };

  const parts = new Map<string, string>();
  for (const segment of signatureHeader.split(",")) {
    const idx = segment.indexOf("=");
    if (idx > 0) parts.set(segment.slice(0, idx).trim(), segment.slice(idx + 1).trim());
  }

  const timestamp = parts.get("t");
  if (!timestamp) return { ok: false, reason: "signature header has no timestamp" };

  const mode = opts.mode ?? (secretKeyLooksLive() ? "live" : "test");
  const provided = parts.get(mode === "live" ? "li" : "te");
  if (!provided) return { ok: false, reason: `signature header has no ${mode} signature` };

  const tolerance = opts.toleranceSeconds ?? 300;
  const now = opts.now ?? new Date();
  const age = Math.abs(Math.floor(now.getTime() / 1000) - Number(timestamp));
  if (!Number.isFinite(age)) return { ok: false, reason: "signature timestamp is not a number" };
  if (age > tolerance) return { ok: false, reason: "signature timestamp outside tolerance" };

  const secret = opts.secret ?? webhookSecret();
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  // Compare in constant time, and only after the lengths match — timingSafeEqual
  // throws on a length mismatch, and an early return on length leaks nothing
  // useful because the digest length is fixed and public.
  if (a.length !== b.length) return { ok: false, reason: "signature mismatch" };
  if (!timingSafeEqual(a, b)) return { ok: false, reason: "signature mismatch" };

  return { ok: true };
}

function secretKeyLooksLive(): boolean {
  return (env("PAYMONGO_SECRET_KEY") ?? "").startsWith("sk_live");
}

export interface PaidEvent {
  type: string;
  email: string | null;
  planId: string | null;
  referenceNumber: string | null;
  paymentRef: string | null;
  amountCentavos: number | null;
}

/** The event types that should grant access. */
const PAID_TYPES = new Set(["checkout_session.payment.paid", "payment.paid"]);

export function isPaidEvent(type: string): boolean {
  return PAID_TYPES.has(type);
}

/**
 * Pull the fields we act on out of a verified webhook payload.
 *
 * Defensive about shape: this is a third-party document that changes on their
 * schedule, and a thrown TypeError here would return a 500 to PayMongo, which
 * retries, which produces the same 500 forever.
 */
export function parseWebhookEvent(payload: unknown): PaidEvent {
  const root: any = payload ?? {};
  const attrs = root?.data?.attributes ?? {};
  const inner = attrs?.data?.attributes ?? {};
  const metadata = inner?.metadata ?? attrs?.metadata ?? {};

  return {
    type: String(attrs?.type ?? ""),
    email: normaliseEmail(metadata?.email),
    planId: metadata?.plan_id ? String(metadata.plan_id) : null,
    referenceNumber: inner?.reference_number
      ? String(inner.reference_number)
      : metadata?.reference_number
        ? String(metadata.reference_number)
        : null,
    paymentRef: root?.data?.id ? String(root.data.id) : null,
    amountCentavos:
      typeof inner?.amount === "number"
        ? inner.amount
        : typeof inner?.line_items?.[0]?.amount === "number"
          ? inner.line_items[0].amount * (inner.line_items[0].quantity ?? 1)
          : null,
  };
}

function normaliseEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.includes("@") ? trimmed : null;
}
