import type { APIRoute } from 'astro';
import { query } from '../../../lib/db';

// New-entry candidates for the advisor: PSE stocks with a FRESH cached BUY
// signal that clear every quality gate the panel agreed on — MEDIUM+ confidence,
// above the 200-day SMA, above the liquidity floor. Cache-only: this endpoint
// never triggers an AI call; the refresh cron + bot keep the cache populated.
// The client filters out held/watchlisted tickers and takes the top 2 —
// suggestions are rate-limited by QUALITY (these gates), not by calendar.

const STOCK_MIN_TURNOVER = Number(process.env.STOCK_MIN_TURNOVER ?? 5_000_000);
// How recent a cached BUY must be to be suggested. The signal refresh only runs
// a couple times a day, so a 4h window (the cache TTL) leaves this empty most of
// the day; 24h surfaces the latest available reads. Override with
// OPPORTUNITY_FRESH_HOURS or a ?freshHours=N query param.
const DEFAULT_FRESH_HOURS = Number(process.env.OPPORTUNITY_FRESH_HOURS ?? 24);

const confRank = (c: string | null): number => (c === 'HIGH' ? 3 : c === 'MEDIUM' ? 2 : c === 'LOW' ? 1 : 0);

export const GET: APIRoute = async ({ url }) => {
  try {
    const freshHours = Math.max(1, Number(url.searchParams.get('freshHours') ?? DEFAULT_FRESH_HOURS));
    const freshCutoff = new Date(Date.now() - freshHours * 3_600_000).toISOString();
    const data = await query<any>(
      `select ticker, verdict, confidence, stop_loss, turnover20d, above_sma200, computed_at
         from signal_cache
        where verdict = 'BUY' and computed_at >= $1
          and turnover20d is not null and turnover20d >= $2`,
      [freshCutoff, STOCK_MIN_TURNOVER]
    );

    const candidates = data
      .filter((s: any) =>
        !s.ticker.includes(':')          // crypto is the crypto bot's world, not the PSE advisor's
        && confRank(s.confidence) >= 2   // MEDIUM+ only
        && s.above_sma200 !== false)     // don't suggest fighting the 200-day trend
      .sort((a: any, b: any) => confRank(b.confidence) - confRank(a.confidence) || Number(b.turnover20d) - Number(a.turnover20d))
      .slice(0, 10)
      .map((s: any) => ({
        ticker: s.ticker, verdict: s.verdict, confidence: s.confidence,
        stopLoss: s.stop_loss != null ? Number(s.stop_loss) : null,
        turnover20d: Number(s.turnover20d),
      }));

    return json({ candidates });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
