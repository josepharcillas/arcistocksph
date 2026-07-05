import { analyzeStock } from './ai';
import { getStockData } from './market';
import { createSupabaseAdmin } from './supabase-admin';
import { isPushConfigured, notifyHoldersOfSignal } from './push/send';
import { medianTurnover } from './botLogic';
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
}

export async function getOrComputeSignal(
  ticker: string, companyName?: string, log: SignalLogContext = {},
): Promise<SignalWithMeta> {
  const sym = ticker.toUpperCase().replace('.PS', '');
  const admin = createSupabaseAdmin();

  const { data: cached } = await admin.from('signal_cache').select('*').eq('ticker', sym).maybeSingle();
  if (cached && Date.now() - new Date(cached.computed_at).getTime() < CACHE_TTL_MS) {
    return {
      verdict: cached.verdict,
      confidence: cached.confidence,
      rationale: cached.rationale,
      targetPrice: cached.target_price,
      stopLoss: cached.stop_loss,
      provider: cached.provider,
      analyzedAt: cached.computed_at,
      cached: true,
      aboveSma200: cached.above_sma200 ?? null,
      turnover20d: cached.turnover20d != null ? Number(cached.turnover20d) : null,
      rsi14: cached.rsi14 != null ? Number(cached.rsi14) : null,
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

  await admin.from('signal_cache').upsert({
    ticker: sym,
    verdict: result.verdict,
    confidence: result.confidence,
    rationale: result.rationale,
    target_price: result.targetPrice,
    stop_loss: result.stopLoss,
    provider: result.provider,
    above_sma200: aboveSma200,
    turnover20d,
    rsi14: t?.rsi14 ?? null,
    computed_at: new Date().toISOString(),
  });

  // Append to the accuracy log (price at signal time). Best-effort — never block.
  const priceNow = stockData.technicals?.currentPrice;
  if (priceNow) {
    await admin
      .from('signal_history')
      .insert({
        ticker: sym, verdict: result.verdict, confidence: result.confidence, price: priceNow,
        source: log.source ?? 'user', arm: log.arm ?? null, turnover20d,
      })
      .then(({ error }) => { if (error) console.warn('signal_history insert failed:', error.message); });
  }

  // Notify holders only on the transition into SELL (not every recompute), and
  // only when push is configured. Fire-and-forget so it never blocks the caller.
  if (result.verdict === 'SELL' && cached?.verdict !== 'SELL' && isPushConfigured()) {
    notifyHoldersOfSignal(sym, result.verdict, result.rationale).catch((err) =>
      console.warn('push notify failed:', err instanceof Error ? err.message : err)
    );
  }

  return { ...result, cached: false, aboveSma200, turnover20d, rsi14: t?.rsi14 ?? null };
}
