import type { APIRoute } from 'astro';
import { createSupabaseAdmin } from '../../../lib/supabase-admin';
import { fetchAllQuotes } from '../../../lib/market';
import { computeAdvice, headlineSignature, DEFAULT_ADVISOR_CONFIG, type AdvisorPosition } from '../../../lib/advisor';
import { sendPushToUser, isPushConfigured } from '../../../lib/push/send';

// R11: push the advisor's headline recommendation to each user when it changes.
// Run from cron (after the signal refresh so signal_cache is warm):
//   15 9 * * 1-5  curl -fsS -X POST \
//     -H "Authorization: Bearer $PUSH_NOTIFY_SECRET" \
//     -H "Content-Type: application/json" \
//     https://YOUR_DOMAIN/api/cron/advisor-alerts
// Dedup: only notifies when the top actionable recommendation differs from the
// last one pushed (advisor_alert_state). HOLD-only advice never alerts.

function env(key: string): string | undefined {
  return import.meta.env[key] ?? process.env[key];
}

const LABEL: Record<string, string> = { EXIT: 'Exit', TRIM: 'Trim', BUY: 'Buy' };

export const POST: APIRoute = async ({ request }) => {
  const secret = env('PUSH_NOTIFY_SECRET');
  if (!secret) return json({ error: 'PUSH_NOTIFY_SECRET not configured' }, 500);
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return json({ error: 'Unauthorized' }, 401);
  if (!isPushConfigured()) return json({ error: 'Push not configured (VAPID keys missing)' }, 500);

  try {
    const admin = createSupabaseAdmin();

    // Only users who can receive a push are worth computing.
    const { data: subs } = await admin.from('push_subscriptions').select('user_id');
    const userIds = [...new Set((subs ?? []).map((s: any) => s.user_id as string))];
    if (userIds.length === 0) return json({ ok: true, users: 0, alerted: 0 });

    const quotes = await fetchAllQuotes().catch(() => new Map<string, { price: number }>());
    let alerted = 0;

    for (const userId of userIds) {
      const [{ data: holdings }, { data: cashRow }, { data: watch }, { data: stateRow }] = await Promise.all([
        admin.from('holdings').select('ticker, qty, buy_price').eq('user_id', userId),
        admin.from('portfolio_cash').select('cash').eq('user_id', userId).maybeSingle(),
        admin.from('watchlist').select('ticker').eq('user_id', userId),
        admin.from('advisor_alert_state').select('signature').eq('user_id', userId).maybeSingle(),
      ]);

      const hs = (holdings ?? []) as { ticker: string; qty: number; buy_price: number }[];
      if (hs.length === 0) continue;

      const held = new Set(hs.map((h) => h.ticker));
      const watchTickers = [...new Set(((watch ?? []) as { ticker: string }[]).map((w) => w.ticker))].filter((t) => !held.has(t));
      const allTickers = [...held, ...watchTickers];

      // Signals from the shared cache (no AI calls in the cron).
      const { data: sigs } = await admin.from('signal_cache').select('ticker, verdict, confidence, stop_loss').in('ticker', allTickers);
      const sigMap = new Map((sigs ?? []).map((s: any) => [s.ticker, s]));

      const price = (t: string) => (quotes as Map<string, { price: number }>).get(t)?.price ?? 0;
      const mk = (ticker: string, shares: number, avgCost: number): AdvisorPosition => {
        const s = sigMap.get(ticker);
        return { ticker, shares, avgCost, price: price(ticker) || avgCost, verdict: s?.verdict ?? null, confidence: s?.confidence ?? null, stopLoss: s?.stop_loss ?? null };
      };

      const positions = [
        ...hs.map((h) => mk(h.ticker, Number(h.qty), Number(h.buy_price))),
        ...watchTickers.map((t) => mk(t, 0, 0)).filter((p) => p.price > 0),
      ];

      const advice = computeAdvice(positions, cashRow ? Number(cashRow.cash) : 0, { ...DEFAULT_ADVISOR_CONFIG, sizing: 'risk' });
      const sig = headlineSignature(advice);
      const prev = stateRow?.signature ?? null;

      if (sig && sig !== prev) {
        const top = advice.actions.find((a) => a.kind !== 'HOLD_CASH')!;
        await sendPushToUser(userId, {
          title: `Advisor: ${LABEL[top.kind] ?? top.kind} ${top.ticker}`,
          body: top.reason,
          url: '/dashboard/advisor',
          ticker: top.ticker,
        });
        alerted++;
      }
      // Track the current signature either way (so HOLD clears a prior alert).
      if (sig !== prev) {
        await admin.from('advisor_alert_state').upsert({ user_id: userId, signature: sig, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      }
    }

    return json({ ok: true, users: userIds.length, alerted });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
