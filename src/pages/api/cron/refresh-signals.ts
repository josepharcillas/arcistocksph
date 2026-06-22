import type { APIRoute } from 'astro';
import { createSupabaseAdmin } from '../../../lib/supabase-admin';
import { getOrComputeSignal } from '../../../lib/signals';

// Scheduled refresh: recompute signals for every ticker someone holds, so a
// flip to SELL alerts holders even when nobody is actively viewing the stock.
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

export const POST: APIRoute = async ({ request }) => {
  const secret = env('PUSH_NOTIFY_SECRET');
  if (!secret) return json({ error: 'PUSH_NOTIFY_SECRET not configured' }, 500);
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return json({ error: 'Unauthorized' }, 401);

  try {
    const admin = createSupabaseAdmin();
    const { data: holdings } = await admin.from('holdings').select('ticker');
    const tickers = [...new Set((holdings ?? []).map((h: any) => h.ticker as string))];

    let recomputed = 0;
    let sells = 0;
    let errors = 0;

    // Sequential to stay gentle on the AI provider's rate limits.
    for (const ticker of tickers) {
      try {
        const r = await getOrComputeSignal(ticker);
        if (!r.cached) recomputed++;
        if (r.verdict === 'SELL') sells++;
      } catch (err) {
        errors++;
        console.warn('refresh-signals failed for', ticker, err instanceof Error ? err.message : err);
      }
    }

    return json({ ok: true, checked: tickers.length, recomputed, sells, errors });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
