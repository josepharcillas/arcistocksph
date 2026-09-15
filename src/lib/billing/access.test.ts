import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SubscriptionRecord } from './entitlements';

/**
 * The gate itself, exercised the way a request hits it.
 *
 * `billing.test.ts` proves the rules. This proves the wiring: that a real call
 * to `guard()` refuses a free account, admits a paid one, and — the case that
 * matters most in an outage — lets the free product keep working when the
 * billing database is unreachable.
 */

const getSubscription = vi.fn<(email: string) => Promise<SubscriptionRecord | null>>();
vi.mock('./store', () => ({ getSubscription: (email: string) => getSubscription(email) }));

const { guard, accessFor } = await import('./access');

const proRecord = (expiresAt: string): SubscriptionRecord => ({
  email: 'paid@example.com',
  planId: 'pro_monthly',
  tier: 'pro',
  expiresAt,
});

const farFuture = new Date(Date.now() + 20 * 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();

beforeEach(() => {
  getSubscription.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('guard', () => {
  it('refuses a signed-in free user with 402 and an upgrade link', async () => {
    getSubscription.mockResolvedValue(null);

    const res = await guard({ email: 'free@example.com' }, 'aiSignals');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(402); // Payment Required, not 403 — the client shows pricing

    const body = await res!.json();
    expect(body.upgrade).toBe('/pricing');
    expect(body.tier).toBe('free');
  });

  it('lets a paying user through', async () => {
    getSubscription.mockResolvedValue(proRecord(farFuture));
    expect(await guard({ email: 'paid@example.com' }, 'aiSignals')).toBeNull();
  });

  it('refuses a lapsed subscriber', async () => {
    // The renewal case: they paid once, the period ended, the expensive
    // endpoint must stop serving them.
    getSubscription.mockResolvedValue(proRecord(past));

    const res = await guard({ email: 'paid@example.com' }, 'aiSignals');
    expect(res!.status).toBe(402);
  });

  it('refuses an anonymous caller without touching the database', async () => {
    const res = await guard(null, 'aiSignals');
    expect(res!.status).toBe(402);
    expect(getSubscription).not.toHaveBeenCalled();
  });

  it('a billing outage degrades to free rather than taking the site down', async () => {
    // The rule that matters in an incident: if the subscription lookup throws,
    // visitors keep the free product. Premium is refused, nothing 500s.
    getSubscription.mockRejectedValue(new Error('connection refused'));

    const access = await accessFor({ email: 'paid@example.com' });
    expect(access.entitlements.tier).toBe('free');

    const res = await guard({ email: 'paid@example.com' }, 'aiSignals');
    expect(res!.status).toBe(402);
  });

  it('gates each capability independently', async () => {
    getSubscription.mockResolvedValue(null);
    for (const cap of ['aiSignals', 'dipRadar', 'dividendAlerts', 'portfolioInsights'] as const) {
      expect((await guard({ email: 'free@example.com' }, cap))!.status).toBe(402);
    }
  });
});
