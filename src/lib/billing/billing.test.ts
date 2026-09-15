import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';

import { PLANS, PURCHASABLE_PLANS, planById, formatPhp, FREE_ENTITLEMENTS, PRO_ENTITLEMENTS } from './plans';
import { resolveAccess, extendedExpiry, requireEntitlement, type SubscriptionRecord } from './entitlements';
import { verifyWebhookSignature, parseWebhookEvent, isPaidEvent } from './paymongo';

const at = (iso: string) => new Date(iso);
const sub = (over: Partial<SubscriptionRecord> = {}): SubscriptionRecord => ({
  email: 'a@example.com',
  planId: 'pro_monthly',
  tier: 'pro',
  expiresAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

describe('plans', () => {
  it('prices are whole centavos', () => {
    for (const p of Object.values(PLANS)) {
      expect(Number.isInteger(p.priceCentavos)).toBe(true);
    }
  });

  it('the annual plan is cheaper per day than the monthly one', () => {
    // If this ever inverts, the pricing page is quietly advertising a discount
    // that costs the customer more.
    const monthly = PLANS.pro_monthly.priceCentavos / PLANS.pro_monthly.days;
    const annual = PLANS.pro_annual.priceCentavos / PLANS.pro_annual.days;
    expect(annual).toBeLessThan(monthly);
  });

  it('only purchasable plans grant a period', () => {
    for (const p of PURCHASABLE_PLANS) expect(p.days).toBeGreaterThan(0);
    expect(PLANS.free.purchasable).toBe(false);
    expect(PLANS.free.days).toBe(0);
  });

  it('pro unlocks strictly more than free', () => {
    for (const [k, v] of Object.entries(FREE_ENTITLEMENTS)) {
      if (typeof v === 'boolean' && v) {
        expect((PRO_ENTITLEMENTS as any)[k]).toBe(true);
      }
    }
    expect(PRO_ENTITLEMENTS.watchlistLimit).toBeGreaterThan(FREE_ENTITLEMENTS.watchlistLimit);
  });

  it('an unknown plan id resolves to null rather than undefined behaviour', () => {
    expect(planById('pro_lifetime')).toBeNull();
    expect(planById('__proto__')).toBeNull();
  });

  it('formats pesos without inventing centavos', () => {
    expect(formatPhp(29_900)).toBe('₱299');
    expect(formatPhp(29_950)).toBe('₱299.50');
  });
});

describe('resolveAccess', () => {
  it('no record is the free tier, not an error', () => {
    const a = resolveAccess(null);
    expect(a.state).toBe('none');
    expect(a.entitlements.tier).toBe('free');
  });

  it('grants pro while the period is live', () => {
    const a = resolveAccess(sub(), at('2026-09-08T00:00:00.000Z'));
    expect(a.state).toBe('active');
    expect(a.entitlements.aiSignals).toBe(true);
    expect(a.daysRemaining).toBe(23);
  });

  it('drops to free the instant the period ends', () => {
    const a = resolveAccess(sub(), at('2026-10-01T00:00:01.000Z'));
    expect(a.state).toBe('expired');
    expect(a.entitlements.aiSignals).toBe(false);
    expect(a.daysRemaining).toBe(0);
  });

  it('flags a renewal in the last week', () => {
    expect(resolveAccess(sub(), at('2026-09-20T00:00:00.000Z')).renewalDue).toBe(false);
    expect(resolveAccess(sub(), at('2026-09-27T00:00:00.000Z')).renewalDue).toBe(true);
  });

  it('a malformed expiry degrades to free instead of throwing', () => {
    // Billing state must never be able to take the free product down.
    const a = resolveAccess(sub({ expiresAt: 'not a date' }));
    expect(a.state).toBe('none');
    expect(a.entitlements.tier).toBe('free');
  });

  it('honours the tier on the row even if the plan is retired', () => {
    // Someone who bought a plan we no longer sell keeps what they paid for.
    const a = resolveAccess(sub({ planId: 'pro_legacy_2024' as any }), at('2026-09-08T00:00:00.000Z'));
    expect(a.entitlements.tier).toBe('pro');
  });
});

describe('extendedExpiry', () => {
  const now = at('2026-09-08T00:00:00.000Z');

  it('a first purchase runs from today', () => {
    expect(extendedExpiry(null, 'pro_monthly', now)).toBe('2026-10-08T00:00:00.000Z');
  });

  it('renewing early adds to the time left rather than discarding it', () => {
    // 12 days remaining + 30 bought = 42. Resetting to 30 would silently
    // punish the customers who renew soonest.
    const remaining = '2026-09-20T00:00:00.000Z';
    expect(extendedExpiry(remaining, 'pro_monthly', now)).toBe('2026-10-20T00:00:00.000Z');
  });

  it('renewing after a lapse runs from today, not from the old expiry', () => {
    const lapsed = '2026-08-01T00:00:00.000Z';
    expect(extendedExpiry(lapsed, 'pro_monthly', now)).toBe('2026-10-08T00:00:00.000Z');
  });

  it('a garbled stored expiry does not poison the new one', () => {
    expect(extendedExpiry('nonsense', 'pro_monthly', now)).toBe('2026-10-08T00:00:00.000Z');
  });

  it('refuses to grant a period for a plan that has none', () => {
    expect(() => extendedExpiry(null, 'free', now)).toThrow();
  });
});

describe('requireEntitlement', () => {
  it('lets a pro user through and turns a free user away', () => {
    const pro = resolveAccess(sub(), at('2026-09-08T00:00:00.000Z'));
    const free = resolveAccess(null);
    expect(requireEntitlement(pro, 'aiSignals')).toBeNull();
    expect(requireEntitlement(free, 'aiSignals')).toBeTruthy();
  });
});

describe('verifyWebhookSignature', () => {
  const secret = 'whsk_test_secret_value';
  const body = JSON.stringify({ data: { id: 'evt_1', attributes: { type: 'checkout_session.payment.paid' } } });
  const now = at('2026-09-08T12:00:00.000Z');
  const ts = Math.floor(now.getTime() / 1000);

  const sign = (payload: string, t: number = ts) =>
    createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');

  it('accepts a correctly signed event', () => {
    const header = `t=${ts},te=${sign(body)},li=deadbeef`;
    expect(verifyWebhookSignature({ rawBody: body, signatureHeader: header, secret, now, mode: 'test' }))
      .toEqual({ ok: true });
  });

  it('rejects a tampered body', () => {
    // The attack this exists to stop: a forged event granting free access.
    const header = `t=${ts},te=${sign(body)},li=x`;
    const tampered = body.replace('evt_1', 'evt_2');
    const r = verifyWebhookSignature({ rawBody: tampered, signatureHeader: header, secret, now, mode: 'test' });
    expect(r.ok).toBe(false);
  });

  it('rejects a wrong secret', () => {
    const header = `t=${ts},te=${createHmac('sha256', 'other').update(`${ts}.${body}`).digest('hex')}`;
    expect(verifyWebhookSignature({ rawBody: body, signatureHeader: header, secret, now, mode: 'test' }).ok).toBe(false);
  });

  it('rejects a replayed event outside the tolerance', () => {
    const old = ts - 3600;
    const header = `t=${old},te=${sign(body, old)}`;
    const r = verifyWebhookSignature({ rawBody: body, signatureHeader: header, secret, now, mode: 'test' });
    expect(r).toEqual({ ok: false, reason: 'signature timestamp outside tolerance' });
  });

  it('rejects a missing or malformed header rather than defaulting to allow', () => {
    expect(verifyWebhookSignature({ rawBody: body, signatureHeader: null, secret, now }).ok).toBe(false);
    expect(verifyWebhookSignature({ rawBody: body, signatureHeader: 'garbage', secret, now }).ok).toBe(false);
    expect(verifyWebhookSignature({ rawBody: body, signatureHeader: `t=${ts}`, secret, now, mode: 'test' }).ok).toBe(false);
  });

  it('will not accept a test signature when running live', () => {
    // A leaked test key must not be able to grant access on production.
    const header = `t=${ts},te=${sign(body)}`;
    expect(verifyWebhookSignature({ rawBody: body, signatureHeader: header, secret, now, mode: 'live' }).ok).toBe(false);
  });

  it('is not fooled by a signature of a different length', () => {
    const header = `t=${ts},te=abc`;
    expect(verifyWebhookSignature({ rawBody: body, signatureHeader: header, secret, now, mode: 'test' }).ok).toBe(false);
  });
});

describe('parseWebhookEvent', () => {
  const paid = {
    data: {
      id: 'evt_abc',
      attributes: {
        type: 'checkout_session.payment.paid',
        data: {
          attributes: {
            reference_number: 'AS-XYZ',
            line_items: [{ amount: 29_900, quantity: 1 }],
            metadata: { email: 'Buyer@Example.COM ', plan_id: 'pro_monthly' },
          },
        },
      },
    },
  };

  it('pulls out the fields access is granted from', () => {
    const e = parseWebhookEvent(paid);
    expect(e.type).toBe('checkout_session.payment.paid');
    expect(e.email).toBe('buyer@example.com'); // normalised, since it is the key
    expect(e.planId).toBe('pro_monthly');
    expect(e.paymentRef).toBe('evt_abc');
    expect(e.amountCentavos).toBe(29_900);
  });

  it('survives a payload shaped differently than expected', () => {
    // A third-party document that changes on their schedule. Throwing here
    // returns 500, which makes the provider retry the same crash forever.
    for (const junk of [null, {}, { data: null }, { data: { attributes: {} } }, 'string']) {
      expect(() => parseWebhookEvent(junk)).not.toThrow();
    }
    expect(parseWebhookEvent(null).email).toBeNull();
  });

  it('refuses a metadata email that is not an email', () => {
    const bad = structuredClone(paid);
    (bad.data.attributes.data.attributes.metadata as any).email = 'not-an-email';
    expect(parseWebhookEvent(bad).email).toBeNull();
  });

  it('recognises only the event types that mean money arrived', () => {
    expect(isPaidEvent('checkout_session.payment.paid')).toBe(true);
    expect(isPaidEvent('payment.failed')).toBe(false);
    expect(isPaidEvent('source.chargeable')).toBe(false);
  });
});
