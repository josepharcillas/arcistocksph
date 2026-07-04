import type { APIRoute } from 'astro';
import { fetchAllQuotes } from '../../../lib/market';
import { createSupabaseAdmin } from '../../../lib/supabase-admin';

// Market movers for the signals page: top gainers + most actively traded PSE
// stocks, decorated with any FRESH cached signal. Display-only and cache-only —
// this endpoint never triggers an AI call; badges appear as the refresh cron /
// bot populate signal_cache. Only names above the liquidity floor are listed:
// we don't advertise stocks we'd never let the advisor or bot touch.

const STOCK_MIN_TURNOVER = Number(process.env.STOCK_MIN_TURNOVER ?? 5_000_000);
const SIGNAL_FRESH_MS = 4 * 60 * 60 * 1000; // mirrors signal_cache TTL
const CACHE_TTL_MS = 10 * 60 * 1000;

interface Mover {
  ticker: string; name: string; price: number; changePct: number; turnover: number;
  verdict: string | null; confidence: string | null;
}

let cache: { data: unknown; expiresAt: number } | null = null;

export const GET: APIRoute = async () => {
  if (cache && cache.expiresAt > Date.now()) {
    return json(cache.data);
  }
  try {
    const quotes = await fetchAllQuotes();
    const liquid = [...quotes.values()]
      .map((q) => ({
        ticker: q.symbol, name: q.name, price: q.price, changePct: q.change1d,
        turnover: (q.price ?? 0) * (q.volume ?? 0),
      }))
      .filter((q) => q.price > 0 && q.turnover >= STOCK_MIN_TURNOVER);

    const topGainers = [...liquid].sort((a, b) => b.changePct - a.changePct).slice(0, 10);
    const mostActive = [...liquid].sort((a, b) => b.turnover - a.turnover).slice(0, 10);

    // Decorate with fresh cached signals (one query, no AI calls).
    const tickers = [...new Set([...topGainers, ...mostActive].map((m) => m.ticker))];
    const admin = createSupabaseAdmin();
    const { data: sigs } = await admin
      .from('signal_cache').select('ticker, verdict, confidence, computed_at').in('ticker', tickers);
    const sigMap = new Map(
      (sigs ?? [])
        .filter((s: any) => Date.now() - new Date(s.computed_at).getTime() < SIGNAL_FRESH_MS)
        .map((s: any) => [s.ticker, s]),
    );
    const decorate = (m: Omit<Mover, 'verdict' | 'confidence'>): Mover => {
      const s = sigMap.get(m.ticker) as any;
      return { ...m, verdict: s?.verdict ?? null, confidence: s?.confidence ?? null };
    };

    const data = {
      asOf: new Date().toISOString(),
      minTurnover: STOCK_MIN_TURNOVER,
      gainers: topGainers.map(decorate),
      mostActive: mostActive.map(decorate),
    };
    cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    return json(data);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
