// Dip Radar: surface liquid PSE stocks that are washed out near their lows, each
// rated SETUP / WAIT / AVOID by bounceLogic. The scanner reads signal_cache (like
// the dividend board) so it never re-fetches history for the whole universe; the
// pressure-test path fetches one ticker live so it works for anything the user types.
import { query } from './db';
import { fetchAllQuotes, getStockData } from './market';
import { bounceRating, pctFromLow, type BounceRating } from './bounceLogic';
import { getOrComputeSignal } from './signals';

const NEAR_LOW_PCT = Number(process.env.BOUNCE_NEAR_LOW_PCT ?? 10); // % above the low = "washed out"
const RSI_MAX = Number(process.env.BOUNCE_RSI_MAX ?? 35);          // oversold gate
const MIN_TURNOVER = Number(process.env.STOCK_MIN_TURNOVER ?? 5_000_000); // liquidity floor (₱/day)

export interface BounceRow {
  ticker: string;
  companyName: string | null;
  price: number;
  rsi14: number | null;
  pctFromLow: number | null;
  macdHist: number | null;
  aboveSma200: boolean | null;
  verdict: string | null;
  confidence: string | null;
  turnover20d: number | null;
  rating: BounceRating;
  score: number;
  reasons: string[];
}

export interface BounceBoard {
  ok: true;
  asOf: string;
  coveredTickers: number;
  rows: BounceRow[];
}

const RANK: Record<BounceRating, number> = { SETUP: 0, WAIT: 1, AVOID: 2 };

/** Scan the cached, liquid universe for washed-out dip candidates. */
export async function getBounceBoard(limit = 40): Promise<BounceBoard> {
  const [sigRows, quotes] = await Promise.all([
    query<any>(`select ticker, verdict, confidence, rsi14, above_sma200, turnover20d, pct_from_low, macd_hist from signal_cache`),
    fetchAllQuotes(),
  ]);

  const rows: BounceRow[] = [];
  for (const s of sigRows) {
    const turnover20d = s.turnover20d != null ? Number(s.turnover20d) : null;
    if (turnover20d == null || turnover20d < MIN_TURNOVER) continue; // thin names give fictional fills

    const quote = quotes.get(s.ticker);
    const price = quote?.price ?? 0;
    if (!(price > 0)) continue; // suspended / not quoted today

    const rsi14 = s.rsi14 != null ? Number(s.rsi14) : null;
    const pFromLow = s.pct_from_low != null ? Number(s.pct_from_low) : null;
    const macdHist = s.macd_hist != null ? Number(s.macd_hist) : null;

    // Only surface actual dips — oversold or washed out near the low.
    const isDip = (rsi14 != null && rsi14 <= RSI_MAX) || (pFromLow != null && pFromLow <= NEAR_LOW_PCT);
    if (!isDip) continue;

    const r = bounceRating({
      rsi14, pctFromLow: pFromLow, macdHist,
      aboveSma200: s.above_sma200 ?? null, verdict: s.verdict ?? null,
      nearLowPct: NEAR_LOW_PCT, rsiMax: RSI_MAX,
    });

    rows.push({
      ticker: s.ticker, companyName: quote?.name ?? null, price,
      rsi14, pctFromLow: pFromLow, macdHist, aboveSma200: s.above_sma200 ?? null,
      verdict: s.verdict ?? null, confidence: s.confidence ?? null, turnover20d,
      rating: r.rating, score: r.score, reasons: r.reasons,
    });
  }

  // SETUP first, then WAIT, then AVOID; strongest score first within each group.
  rows.sort((a, b) =>
    RANK[a.rating] - RANK[b.rating] || b.score - a.score || (a.pctFromLow ?? 1e9) - (b.pctFromLow ?? 1e9));

  return { ok: true, asOf: new Date().toISOString(), coveredTickers: rows.length, rows: rows.slice(0, limit) };
}

export interface BounceTickerResult {
  ok: boolean;
  ticker: string;
  error?: string;
  companyName?: string;
  price?: number;
  rsi14?: number | null;
  pctFromLow?: number | null;
  macdHist?: number | null;
  aboveSma200?: boolean | null;
  verdict?: string | null;
  rating?: BounceRating;
  score?: number;
  reasons?: string[];
}

/** Pressure-test a single user-supplied ticker live (works even if it's not in the
 *  scan cache). Pulls the AI verdict via the shared signal pipeline so the value-
 *  trap guard applies. */
export async function getBounceForTicker(ticker: string): Promise<BounceTickerResult> {
  const sym = ticker.toUpperCase().replace('.PS', '').trim();
  if (!sym) return { ok: false, ticker: sym, error: 'No ticker given' };

  let stockData;
  try {
    stockData = await getStockData(sym, sym);
  } catch {
    return { ok: false, ticker: sym, error: 'Could not fetch market data for this ticker' };
  }
  const t = stockData.technicals;
  if (!t || !(t.currentPrice > 0)) return { ok: false, ticker: sym, error: 'No live price for this ticker' };

  const pFromLow = pctFromLow(stockData.priceHistory.map((d) => d.close), t.currentPrice);
  const macdHist = t.macd?.histogram ?? null;
  const aboveSma200 = t.sma200 > 0 ? t.currentPrice > t.sma200 : null;

  // AI verdict powers the trap guard; cached 4h so this is usually cheap.
  const sig = await getOrComputeSignal(sym, stockData.companyName).catch(() => null);

  const r = bounceRating({
    rsi14: t.rsi14, pctFromLow: pFromLow, macdHist, aboveSma200,
    verdict: sig?.verdict ?? null, nearLowPct: NEAR_LOW_PCT, rsiMax: RSI_MAX,
  });

  return {
    ok: true, ticker: sym, companyName: stockData.companyName, price: t.currentPrice,
    rsi14: t.rsi14, pctFromLow: pFromLow, macdHist, aboveSma200, verdict: sig?.verdict ?? null,
    rating: r.rating, score: r.score, reasons: r.reasons,
  };
}
