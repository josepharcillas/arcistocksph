import type { APIRoute } from 'astro';
import { createSupabaseAdmin } from '../../../lib/supabase-admin';
import { getOrComputeSignal, type SignalLogContext } from '../../../lib/signals';
import { fetchAllQuotes } from '../../../lib/market';

// Scheduled refresh, three rings of coverage (2026-07-04 panel):
//   1. HELD    — every ticker someone holds, so a flip to SELL alerts holders
//                even when nobody is actively viewing the stock.
//   2. WATCH   — every user-watchlisted ticker, so alerts and the advisor see them.
//   3. ACTIVE  — the top-N most actively traded PSE stocks (by today's peso
//                turnover, above the liquidity floor), so the signals page,
//                movers panel, and advisor track the live market, not just
//                what users already own. ?topActive=N overrides (default 30).
// getOrComputeSignal respects the 4h DB cache, so frequent runs only recompute
// stale tickers (and only newly-SELL transitions notify). Run it from cron, e.g.
//   */30 1-8 * * 1-5  curl -fsS -X POST \
//     -H "Authorization: Bearer $PUSH_NOTIFY_SECRET" \
//     -H "Content-Type: application/json" \
//     https://YOUR_DOMAIN/api/cron/refresh-signals
// (01:30–07:30 UTC ≈ PSE trading hours in PHT, Mon–Fri.)
// The application/json header is required — Astro's CSRF guard rejects POSTs
// with a form content-type and no matching Origin (i.e. server-to-server calls).

function env(key: string): string | undefined {
  return import.meta.env[key] ?? process.env[key];
}

const STOCK_MIN_TURNOVER = Number(process.env.STOCK_MIN_TURNOVER ?? 5_000_000);

export const POST: APIRoute = async ({ request, url }) => {
  const secret = env('PUSH_NOTIFY_SECRET');
  if (!secret) return json({ error: 'PUSH_NOTIFY_SECRET not configured' }, 500);
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return json({ error: 'Unauthorized' }, 401);

  try {
    const admin = createSupabaseAdmin();
    const topActive = Math.max(0, Number(url.searchParams.get('topActive') ?? 30));
    const [{ data: holdings }, { data: watchlist }] = await Promise.all([
      admin.from('holdings').select('ticker'),
      admin.from('watchlist').select('ticker'),
    ]);
    // Skip crypto-namespaced tickers ("X:BTC") — those are the crypto bot's and
    // are refreshed by its own pipeline, not the PSE stock signal path.
    const noCrypto = (t: string) => !t.includes(':');
    const heldTickers = [...new Set((holdings ?? []).map((h: any) => h.ticker as string))].filter(noCrypto);
    const heldSet = new Set(heldTickers);
    const watchTickers = [...new Set((watchlist ?? []).map((w: any) => w.ticker as string))]
      .filter((t) => noCrypto(t) && !heldSet.has(t));

    // Most-active ring: today's peso turnover from the bulk phisix snapshot.
    // Above the liquidity floor only — thin names aren't surfaced to users, so
    // spending refresh budget on them buys nothing (the bot's control arm
    // still samples them for measurement).
    let activeTickers: string[] = [];
    if (topActive > 0) {
      const covered = new Set([...heldTickers, ...watchTickers]);
      const quotes = await fetchAllQuotes().catch(() => new Map());
      activeTickers = [...quotes.values()]
        .map((q: any) => ({ ticker: q.symbol as string, turnover: (q.price ?? 0) * (q.volume ?? 0) }))
        .filter((q) => !covered.has(q.ticker) && q.turnover >= STOCK_MIN_TURNOVER)
        .sort((a, b) => b.turnover - a.turnover)
        .slice(0, topActive)
        .map((q) => q.ticker);
    }

    let recomputed = 0;
    let sells = 0;
    let errors = 0;

    const rings: [string[], SignalLogContext][] = [
      [heldTickers, { source: 'held' }],
      [watchTickers, { source: 'watch' }],
      [activeTickers, { source: 'active' }],
    ];
    // Sequential to stay gentle on the AI provider's rate limits.
    for (const [tickers, log] of rings) {
      for (const ticker of tickers) {
        try {
          const r = await getOrComputeSignal(ticker, undefined, log);
          if (!r.cached) recomputed++;
          if (r.verdict === 'SELL') sells++;
        } catch (err) {
          errors++;
          console.warn('refresh-signals failed for', ticker, err instanceof Error ? err.message : err);
        }
      }
    }

    return json({
      ok: true,
      checked: heldTickers.length + watchTickers.length + activeTickers.length,
      held: heldTickers.length, watch: watchTickers.length, active: activeTickers.length,
      recomputed, sells, errors,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
