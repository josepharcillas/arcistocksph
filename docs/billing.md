# Billing — how ArciStocks Pro works

## The model

Access is sold as a **fixed period**, not an auto-renewing subscription. A
purchase buys 30 or 365 days, it expires on a date the user can see, and
renewing is a deliberate act.

This is not a shortcut around recurring billing — it is the right model for this
market. Most Filipinos pay online with GCash or Maya, which are push payments
and cannot carry a recurring card mandate. A card-only auto-renewing
subscription would turn away the majority of the addressable market at the last
step, to save the operator a renewal email. It also removes a whole category of
billing dispute, because nothing can ever charge a customer who did not act.

Renewals **extend** from the later of today and the current expiry, so buying
early adds to what is left rather than discarding it.

## Where each decision lives

| File | Responsibility |
|---|---|
| `src/lib/billing/plans.ts` | Plans, prices, and what each tier unlocks |
| `src/lib/billing/entitlements.ts` | Turning a payment record into permission. Pure, fully unit-tested |
| `src/lib/billing/paymongo.ts` | Everything provider-specific: checkout creation, webhook signature |
| `src/lib/billing/store.ts` | Persistence. Service-role only |
| `src/lib/billing/access.ts` | What API routes and pages call |
| `src/pages/api/billing/webhook.ts` | The only place access is ever granted |

A second payment provider means another file like `paymongo.ts` and nothing
else — the rest of the code works in plans, entitlements and dates.

## Setup

1. Run `docs/schema-billing.sql` in the Supabase SQL editor.
2. Set `PAYMONGO_SECRET_KEY` and `PAYMONGO_WEBHOOK_SECRET` (see `.env.example`).
3. Register the webhook in the PayMongo dashboard:
   - URL: `<PUBLIC_ORIGIN>/api/billing/webhook`
   - Event: `checkout_session.payment.paid`
4. Pay for a plan with a test key and confirm a row appears in `subscriptions`.

Leave the keys blank and the app runs exactly as before: the pricing page still
renders, and the buttons say payments are unavailable rather than half-starting
a checkout.

## Gating a feature

```ts
import { guard } from '../../lib/billing/access';

const denied = await guard(locals.user, 'aiSignals');
if (denied) return denied;   // 402 with an upgrade link
```

`/api/analyze` is gated this way. Gate on the **server**, in the route — never
by hiding a button. Anything the browser decides is a decision an
unauthenticated caller also gets to make.

`GET /api/billing/status` tells the client what to *show*. It is not what
protects anything.

## Things that will bite you

**The raw body is the signed body.** The webhook verifies HMAC-SHA256 over
`<timestamp>.<raw body>`. Parsing the JSON and re-serialising it reorders keys
and the signature can never match again. This is the most common way a webhook
integration fails, and it fails closed — paying customers get nothing.

**Status codes drive retries.** PayMongo retries anything that is not 2xx. So a
bad signature is 401 (never retried), an event we ignore is 200 (or it retries
forever), and a database failure is 500 **because we want the retry**. Returning
200 on a real failure loses the payment silently.

**Webhooks arrive more than once.** `billing_events` is keyed on the provider's
event id, and the insert itself is the lock — a duplicate hits a unique
violation instead of racing a read-then-write. Without it, a retry extends
access a second time from the same money, invisibly.

**Billing must never take the site down.** `accessFor()` catches everything and
falls back to the free tier. A billing outage degrades premium features; it does
not produce an error page for visitors.

**Log lines worth alerting on.** These mean someone paid and did not get what
they bought:

```
[billing] PAID BUT NOT GRANTED
[billing] PAID BUT UNATTRIBUTABLE
[billing] PAID FOR UNKNOWN PLAN
[billing] AMOUNT MISMATCH
```

## Before going live

- [ ] Re-read PayMongo's current API reference and confirm the request shape and
      signature scheme in `paymongo.ts` still match. It is written to their
      documented v1 behaviour, but a payment integration that looks right and is
      subtly wrong fails by not granting access to someone already charged.
- [ ] Complete one real sandbox payment end to end. The unit tests cover the
      logic; they cannot prove the wire format.
- [ ] Confirm `subscriptions` and `billing_events` are unreachable with the anon
      key. They have RLS on and no policies, so they should be.
- [ ] Decide the refund process. The pricing page promises a full refund within
      7 days if something is broken and unfixable.

## Not financial advice

Paying does not change what the product is. Pro unlocks more analysis; it is
still an educational tool, and the signals are still not recommendations. See
`/disclaimer`, which is shown in English and Tagalog.
