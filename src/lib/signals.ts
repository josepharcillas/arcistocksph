import { analyzeStock } from './ai';
import { getStockData } from './market';
import { query, queryOne } from './db';
import { isPushConfigured, notifyHoldersOfSignal } from './push/send';
import { medianTurnover } from './botLogic';
import { pctFromLow } from './bounceLogic';
import type { StockAnalysisResult } from './ai/types';

// Shared signal pipeline used by both the on-view route (/api/analyze) and the
// scheduled refresh (/api/cron/refresh-signals): read the DB cache, recompute on
// miss/stale, and notify holders when a stock newly flips to SELL.

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours — shared across users via DB

// Where a signal request came from + which sampling arm picked it. Logged to
// signal_history so accuracy can be decomposed by tier/arm (2026-07-04 panel:
// instrument first — without these columns no coverage change is measurable).
export interface SignalLogContext {
  source?: 'held' | 'watch' | 'discovery' | 'active' | 'user';
  arm?: 'weighted' | 'control' | null;
}

export interface SignalWithMeta extends StockAnalysisResult {
  cached: boolean;
  aboveSma200?: boolean | null; // trend flag for the bot's 200-day filter
  turnover20d?: number | null;  // median peso value traded over ~20 sessions (liquidity floor)
  rsi14?: number | null;        // 14-day RSI at signal time (dividend tracker entry rating)
  pctFromLow?: number | null;   // % above the trailing (~52wk) low (Dip Radar washout measure)
  macdHist?: number | null;     // MACD histogram at signal time (Dip Radar momentum turn)
}

interface CacheRow {
  ticker: string;
  verdict: string;
  confidence: string;
  rationale: string;
  target_price: number | null;
  stop_loss: number | null;
  provider: string;
  above_sma200: boolean | null;
  turnover20d: number | null;
  rsi14: number | null;
  pct_from_low: number | null;
  macd_hist: number | null;
  computed_at: string;
}

export async function getOrComputeSignal(
  ticker: string, companyName?: string, log: SignalLogContext = {},
): Promise<SignalWithMeta> {
  const sym = ticker.toUpperCase().replace('.PS', '');

  const cached = await queryOne<CacheRow>(`select * from signal_cache where ticker = $1`, [sym]);
  if (cached && Date.now() - new Date(cached.computed_at).getTime() < CACHE_TTL_MS) {
    return {
      verdict: cached.verdict as StockAnalysisResult['verdict'],
      confidence: cached.confidence as StockAnalysisResult['confidence'],
      rationale: cached.rationale,
      targetPrice: cached.target_price,
      stopLoss: cached.stop_loss,
      provider: cached.provider,
      analyzedAt: cached.computed_at,
      cached: true,
      aboveSma200: cached.above_sma200 ?? null,
      turnover20d: cached.turnover20d != null ? Number(cached.turnover20d) : null,
      rsi14: cached.rsi14 != null ? Number(cached.rsi14) : null,
      pctFromLow: cached.pct_from_low != null ? Number(cached.pct_from_low) : null,
      macdHist: cached.macd_hist != null ? Number(cached.macd_hist) : null,
    };
  }

  const stockData = await getStockData(sym, companyName ?? sym);
  const result = await analyzeStock(stockData);

  // Trend flag for the bot's 200-day filter: only meaningful when we actually
  // have a long-enough history (sma200 > 0); otherwise unknown (null).
  const t = stockData.technicals;
  const aboveSma200 = t && t.sma200 > 0 ? t.currentPrice > t.sma200 : null;

  // Liquidity: PSE Edge history's `volume` field is peso VALUE traded per day.
  const turnover20d = medianTurnover(stockData.priceHistory.map((d) => d.volume));

  // Dip Radar inputs (additive — do NOT affect verdict/confidence, so the bots are
  // unchanged): how far above its trailing low the price sits, and the MACD
  // histogram as a momentum-turn proxy.
  const fromLow = pctFromLow(stockData.priceHistory.map((d) => d.close), t?.currentPrice ?? 0);
  const macdHist = t?.macd?.histogram ?? null;

  await query(
    `insert into signal_cache
       (ticker, verdict, confidence, rationale, target_price, stop_loss, provider,
        above_sma200, turnover20d, rsi14, pct_from_low, macd_hist, computed_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
     on conflict (ticker) do update set
       verdict = excluded.verdict, confidence = excluded.confidence, rationale = excluded.rationale,
       target_price = excluded.target_price, stop_loss = excluded.stop_loss, provider = excluded.provider,
       above_sma200 = excluded.above_sma200, turnover20d = excluded.turnover20d, rsi14 = excluded.rsi14,
       pct_from_low = excluded.pct_from_low, macd_hist = excluded.macd_hist, computed_at = now()`,
    [sym, result.verdict, result.confidence, result.rationale, result.targetPrice, result.stopLoss,
      result.provider, aboveSma200, turnover20d, t?.rsi14 ?? null, fromLow, macdHist]
  );

  // Append to the accuracy log (price at signal time). Best-effort — never block.
  const priceNow = stockData.technicals?.currentPrice;
  if (priceNow) {
    query(
      `insert into signal_history (ticker, verdict, confidence, price, source, arm, turnover20d)
         values ($1,$2,$3,$4,$5,$6,$7)`,
      [sym, result.verdict, result.confidence, priceNow, log.source ?? 'user', log.arm ?? null, turnover20d]
    ).catch((err) => console.warn('signal_history insert failed:', err instanceof Error ? err.message : err));
  }

  // Notify holders only on the transition into SELL (not every recompute), and
  // only when push is configured. Fire-and-forget so it never blocks the caller.
  if (result.verdict === 'SELL' && cached?.verdict !== 'SELL' && isPushConfigured()) {
    notifyHoldersOfSignal(sym, result.verdict, result.rationale).catch((err) =>
      console.warn('push notify failed:', err instanceof Error ? err.message : err)
    );
  }

  return { ...result, cached: false, aboveSma200, turnover20d, rsi14: t?.rsi14 ?? null, pctFromLow: fromLow, macdHist };
}
