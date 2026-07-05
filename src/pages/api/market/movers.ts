import type { APIRoute } from 'astro';
import { fetchAllQuotes } from '../../../lib/market';
import { fetchTopCryptoQuotes } from '../../../lib/market/crypto';
import { createSupabaseAdmin } from '../../../lib/supabase-admin';

// Market movers for the signals page: top gainers + most actively traded PSE
// stocks AND coins, decorated with any FRESH cached signal. Display-only and
// cache-only — this endpoint never triggers an AI call; badges appear as the
// refresh cron / bots populate signal_cache. Only names above the liquidity
// floors are listed: we don't advertise assets we'd never let the advisor or
// bot touch. (The coin universe is floored upstream by CRYPTO_MIN_VOLUME.)

const STOCK_MIN_TURNOVER = Number(process.env.STOCK_MIN_TURNOVER ?? 5_000_000);
// Show the latest available signal, not just the last 4h. The refresh runs a
// couple times a day, so a 4h window blanks every badge most of the day; 24h
// mirrors the opportunities panel (OPPORTUNITY_FRESH_HOURS). Override via env.
const SIGNAL_FRESH_MS = Number(process.env.MOVERS_FRESH_HOURS ?? 24) * 3_600_000;
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
    const [quotesR, coinsR] = await Promise.allSettled([
      fetchAllQuotes(),
      fetchTopCryptoQuotes(Number(process.env.CRYPTO_UNIVERSE ?? 250)),
    ]);
    if (quotesR.status === 'rejected' && coinsR.status === 'rejected') {
      throw new Error('both market snapshots failed');
    }

    const liquid = quotesR.status === 'fulfilled'
      ? [...quotesR.value.values()]
          .map((q) => ({
            ticker: q.symbol, name: q.name, price: q.price, changePct: q.change1d,
            turnover: (q.price ?? 0) * (q.volume ?? 0),
          }))
          .filter((q) => q.price > 0 && q.turnover >= STOCK_MIN_TURNOVER)
      : [];
    const topGainers = [...liquid].sort((a, b) => b.changePct - a.changePct).slice(0, 10);
    const mostActive = [...liquid].sort((a, b) => b.turnover - a.turnover).slice(0, 10);

    // Coins: same two views. Display the bare symbol; signals cache under "X:SYM".
    const coins = coinsR.status === 'fulfilled'
      ? [...coinsR.value.values()].map((c) => ({
          ticker: c.ticker, name: c.name, price: c.price, changePct: c.change1d, turnover: c.volume,
        }))
      : [];
    const coinGainers = [...coins].sort((a, b) => b.changePct - a.changePct).slice(0, 10);
    const coinActive = [...coins].sort((a, b) => b.turnover - a.turnover).slice(0, 10);

    // Decorate with fresh cached signals (one query, no AI calls).
    const tickers = [...new Set([...topGainers, ...mostActive, ...coinGainers, ...coinActive].map((m) => m.ticker))];
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
      // Coins display without the "X:" namespace.
      return { ...m, ticker: m.ticker.replace(/^X:/, ''), verdict: s?.verdict ?? null, confidence: s?.confidence ?? null };
    };

    const data = {
      asOf: new Date().toISOString(),
      minTurnover: STOCK_MIN_TURNOVER,
      gainers: topGainers.map(decorate),
      mostActive: mostActive.map(decorate),
      crypto: {
        gainers: coinGainers.map(decorate),
        mostActive: coinActive.map(decorate),
      },
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
