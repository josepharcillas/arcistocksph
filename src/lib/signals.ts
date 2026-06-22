import { analyzeStock } from './ai';
import { getStockData } from './market';
import { createSupabaseAdmin } from './supabase-admin';
import { isPushConfigured, notifyHoldersOfSignal } from './push/send';
import type { StockAnalysisResult } from './ai/types';

// Shared signal pipeline used by both the on-view route (/api/analyze) and the
// scheduled refresh (/api/cron/refresh-signals): read the DB cache, recompute on
// miss/stale, and notify holders when a stock newly flips to SELL.

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours — shared across users via DB

export interface SignalWithMeta extends StockAnalysisResult {
  cached: boolean;
}

export async function getOrComputeSignal(ticker: string, companyName?: string): Promise<SignalWithMeta> {
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
    };
  }

  const stockData = await getStockData(sym, companyName ?? sym);
  const result = await analyzeStock(stockData);

  await admin.from('signal_cache').upsert({
    ticker: sym,
    verdict: result.verdict,
    confidence: result.confidence,
    rationale: result.rationale,
    target_price: result.targetPrice,
    stop_loss: result.stopLoss,
    provider: result.provider,
    computed_at: new Date().toISOString(),
  });

  // Notify holders only on the transition into SELL (not every recompute), and
  // only when push is configured. Fire-and-forget so it never blocks the caller.
  if (result.verdict === 'SELL' && cached?.verdict !== 'SELL' && isPushConfigured()) {
    notifyHoldersOfSignal(sym, result.verdict, result.rationale).catch((err) =>
      console.warn('push notify failed:', err instanceof Error ? err.message : err)
    );
  }

  return { ...result, cached: false };
}
