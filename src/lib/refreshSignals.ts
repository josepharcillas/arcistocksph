import { createSupabaseAdmin } from './supabase-admin';
import { getOrComputeSignal, type SignalLogContext } from './signals';
import { getOrComputeCryptoSignal } from './cryptoSignals';
import { fetchAllQuotes } from './market';
import { fetchTopCryptoQuotes } from './market/crypto';

// Scheduled signal refresh — five rings of coverage (2026-07-04/05 panel + the
// user's "cover ALL stocks and crypto" requirement):
//   1. HELD    — every ticker someone holds, so a flip to SELL alerts holders.
//   2. WATCH   — every user-watchlisted ticker.
//   3. ACTIVE  — the top-N most actively traded PSE stocks today.
//   4. ROTATE  — the stalest liquid PSE stocks, oldest-cache-first, so EVERY
//                above-floor stock cycles through a fresh signal (~daily at
//                default sizes) instead of waiting for the bot's random draw.
//   5. CRYPTO  — the stalest coins from the active universe (top 250, already
//                liquidity-floored), most-traded first, so the whole crypto
//                market accumulates signal coverage too.
// getOrComputeSignal respects the 4h DB cache, so frequent runs only recompute
// stale tickers. Ring sizes are the AI-budget knobs — see .env.example.

const STOCK_MIN_TURNOVER = Number(process.env.STOCK_MIN_TURNOVER ?? 5_000_000);
const FRESH_MS = 4 * 60 * 60 * 1000; // mirrors signal_cache TTL

// Pace fresh AI calls to fit free-tier rate limits (Gemini 2.5-flash free =
// 20 req/min → ≥3s spacing; bursts 429 into Groq and 429 there too). Cached
// hits skip the wait, so warmed-up runs stay fast.
const AI_CALL_DELAY_MS = Number(process.env.AI_CALL_DELAY_MS ?? 3500);
const pace = () => new Promise((r) => setTimeout(r, AI_CALL_DELAY_MS));

export interface RefreshOptions {
  topActive?: number; // ring 3 size (default 30)
  rotate?: number;    // ring 4 size (default 30)
  cryptoTop?: number; // ring 5 size (default 15)
}

export interface RefreshResult {
  ok: true;
  checked: number;
  held: number; watch: number; active: number; rotate: number; crypto: number;
  recomputed: number; sells: number; errors: number;
}

export async function refreshSignals(opts: RefreshOptions = {}): Promise<RefreshResult> {
  const topActive = Math.max(0, opts.topActive ?? 30);
  const rotate = Math.max(0, opts.rotate ?? 30);
  const cryptoTop = Math.max(0, opts.cryptoTop ?? 15);

  const admin = createSupabaseAdmin();
  const [{ data: holdings }, { data: watchlist }, { data: cacheRows }] = await Promise.all([
    admin.from('holdings').select('ticker'),
    admin.from('watchlist').select('ticker'),
    admin.from('signal_cache').select('ticker, computed_at'),
  ]);
  const cacheAge = new Map<string, number>(
    (cacheRows ?? []).map((r: any) => [r.ticker as string, new Date(r.computed_at).getTime()]),
  );
  const isFresh = (t: string) => {
    const at = cacheAge.get(t);
    return at != null && Date.now() - at < FRESH_MS;
  };

  // Crypto-namespaced holdings ("X:BTC") are the crypto bot's — held-ring
  // refreshes go through the PSE stock path only.
  const noCrypto = (t: string) => !t.includes(':');
  const heldTickers = [...new Set((holdings ?? []).map((h: any) => h.ticker as string))].filter(noCrypto);
  const heldSet = new Set(heldTickers);
  const watchTickers = [...new Set((watchlist ?? []).map((w: any) => w.ticker as string))]
    .filter((t) => noCrypto(t) && !heldSet.has(t));

  // Liquid PSE universe from one bulk phisix call: today's peso turnover.
  const covered = new Set([...heldTickers, ...watchTickers]);
  let activeTickers: string[] = [];
  let rotateTickers: string[] = [];
  if (topActive > 0 || rotate > 0) {
    const quotes = await fetchAllQuotes().catch(() => new Map());
    const liquid = [...quotes.values()]
      .map((q: any) => ({ ticker: q.symbol as string, turnover: (q.price ?? 0) * (q.volume ?? 0) }))
      .filter((q) => !covered.has(q.ticker) && q.turnover >= STOCK_MIN_TURNOVER);

    // Ring 3: most active today (freshness matters most where the money is).
    activeTickers = [...liquid]
      .sort((a, b) => b.turnover - a.turnover)
      .slice(0, topActive)
      .map((q) => q.ticker);
    const activeSet = new Set(activeTickers);

    // Ring 4: the rest of the liquid market, stalest cache first (never-scanned
    // names sort before everything), so full coverage accumulates predictably.
    rotateTickers = liquid
      .filter((q) => !activeSet.has(q.ticker) && !isFresh(q.ticker))
      .sort((a, b) => (cacheAge.get(a.ticker) ?? 0) - (cacheAge.get(b.ticker) ?? 0))
      .slice(0, rotate)
      .map((q) => q.ticker);
  }

  // Ring 5: coins — whole active universe (already volume-floored upstream),
  // stalest-first with most-traded breaking ties, so all ~250 coins cycle.
  let cryptoEntries: { ticker: string; id: string; symbol: string; name: string }[] = [];
  if (cryptoTop > 0) {
    const coins = await fetchTopCryptoQuotes(Number(process.env.CRYPTO_UNIVERSE ?? 250)).catch(() => new Map());
    cryptoEntries = [...coins.values()]
      .filter((c: any) => !isFresh(c.ticker))
      .sort((a: any, b: any) => (cacheAge.get(a.ticker) ?? 0) - (cacheAge.get(b.ticker) ?? 0) || b.volume - a.volume)
      .slice(0, cryptoTop)
      .map((c: any) => ({ ticker: c.ticker, id: c.id, symbol: c.symbol, name: c.name }));
  }

  let recomputed = 0;
  let sells = 0;
  let errors = 0;

  const stockRings: [string[], SignalLogContext][] = [
    [heldTickers, { source: 'held' }],
    [watchTickers, { source: 'watch' }],
    [activeTickers, { source: 'active' }],
    [rotateTickers, { source: 'rotate' }],
  ];
  // Sequential to stay gentle on the AI provider's rate limits.
  for (const [tickers, log] of stockRings) {
    for (const ticker of tickers) {
      try {
        const r = await getOrComputeSignal(ticker, undefined, log);
        if (!r.cached) { recomputed++; await pace(); }
        if (r.verdict === 'SELL') sells++;
      } catch (err) {
        errors++;
        console.warn('refresh-signals failed for', ticker, err instanceof Error ? err.message : err);
        await pace(); // failures burn rate-limit budget too
      }
    }
  }
  for (const c of cryptoEntries) {
    try {
      const r = await getOrComputeCryptoSignal(c.ticker, c.id, c.symbol, c.name, { source: 'rotate' });
      if (!r.cached) { recomputed++; await pace(); }
      if (r.verdict === 'SELL') sells++;
    } catch (err) {
      errors++;
      console.warn('refresh-signals failed for', c.ticker, err instanceof Error ? err.message : err);
      await pace();
    }
  }

  return {
    ok: true,
    checked: heldTickers.length + watchTickers.length + activeTickers.length + rotateTickers.length + cryptoEntries.length,
    held: heldTickers.length, watch: watchTickers.length, active: activeTickers.length,
    rotate: rotateTickers.length, crypto: cryptoEntries.length,
    recomputed, sells, errors,
  };
}
