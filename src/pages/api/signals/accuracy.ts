import type { APIRoute } from 'astro';
import { createSupabaseAdmin } from '../../../lib/supabase-admin';
import { fetchAllQuotes } from '../../../lib/market';
import { isSignalCorrect } from '../../../lib/signalAccuracy';

// Measures how the recorded signals (signal_history) have played out: for every
// signal at least `horizon` days old, compare the price then to the price now.
//   BUY  correct if price is up
//   SELL correct if price is down
//   HOLD correct if price moved within ±HOLD_BAND
// This is a directional, point-in-time-to-today measure — a first-order sanity
// check on signal quality, not a rigorous fixed-horizon backtest.

const HOLD_BAND = 0.03; // ±3% counts as "flat" for HOLD

export const GET: APIRoute = async ({ url }) => {
  const horizonDays = Math.max(1, Number(url.searchParams.get('horizon') ?? 7));
  const cutoff = new Date(Date.now() - horizonDays * 86_400_000).toISOString();

  try {
    const admin = createSupabaseAdmin();
    const [{ data: history }, quotes] = await Promise.all([
      admin
        .from('signal_history')
        .select('ticker, verdict, price, created_at')
        .lte('created_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(1000),
      fetchAllQuotes().catch(() => new Map()),
    ]);

    const q = quotes as Map<string, { price: number }>;
    const tally = {
      BUY: { n: 0, correct: 0 },
      SELL: { n: 0, correct: 0 },
      HOLD: { n: 0, correct: 0 },
    } as Record<string, { n: number; correct: number }>;
    let evaluated = 0;
    let correct = 0;

    for (const s of history ?? []) {
      const now = q.get(s.ticker)?.price;
      if (!now || !s.price) continue;
      const ret = (now - Number(s.price)) / Number(s.price);
      const isCorrect = isSignalCorrect(s.verdict, ret, HOLD_BAND);
      tally[s.verdict].n++;
      if (isCorrect) tally[s.verdict].correct++;
      evaluated++;
      if (isCorrect) correct++;
    }

    const pct = (c: number, n: number) => (n > 0 ? Math.round((c / n) * 1000) / 10 : null);

    return json({
      horizonDays,
      evaluated,
      accuracyPct: pct(correct, evaluated),
      byVerdict: {
        BUY: { n: tally.BUY.n, accuracyPct: pct(tally.BUY.correct, tally.BUY.n) },
        SELL: { n: tally.SELL.n, accuracyPct: pct(tally.SELL.correct, tally.SELL.n) },
        HOLD: { n: tally.HOLD.n, accuracyPct: pct(tally.HOLD.correct, tally.HOLD.n) },
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
