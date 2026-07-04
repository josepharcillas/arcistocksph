import { analyzeStock } from './ai';
import { getCryptoData } from './market/crypto';
import { createSupabaseAdmin } from './supabase-admin';
import type { SignalLogContext, SignalWithMeta } from './signals';

// Crypto counterpart of getOrComputeSignal: same DB cache + accuracy log, but it
// fetches crypto data (CoinGecko) and stores under a namespaced ticker ("X:BTC")
// so it never collides with PSE stock signals. No SELL-push (crypto bot only).

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4h, shared via DB

export async function getOrComputeCryptoSignal(
  cacheTicker: string, // namespaced, e.g. "X:BTC"
  coinId: string,      // CoinGecko id, e.g. "bitcoin"
  symbol: string,      // display, e.g. "BTC"
  name: string,
  log: SignalLogContext = {},
): Promise<SignalWithMeta> {
  const admin = createSupabaseAdmin();

  const { data: cached } = await admin.from('signal_cache').select('*').eq('ticker', cacheTicker).maybeSingle();
  if (cached && Date.now() - new Date(cached.computed_at).getTime() < CACHE_TTL_MS) {
    return {
      verdict: cached.verdict, confidence: cached.confidence, rationale: cached.rationale,
      targetPrice: cached.target_price, stopLoss: cached.stop_loss, provider: cached.provider,
      analyzedAt: cached.computed_at, cached: true, aboveSma200: cached.above_sma200 ?? null,
    };
  }

  const data = await getCryptoData(coinId, symbol, name);
  const result = await analyzeStock(data);

  const t = data.technicals;
  const aboveSma200 = t && t.sma200 > 0 ? t.currentPrice > t.sma200 : null;

  await admin.from('signal_cache').upsert({
    ticker: cacheTicker,
    verdict: result.verdict, confidence: result.confidence, rationale: result.rationale,
    target_price: result.targetPrice, stop_loss: result.stopLoss, provider: result.provider,
    above_sma200: aboveSma200,
    computed_at: new Date().toISOString(),
  });

  const priceNow = data.technicals?.currentPrice;
  if (priceNow) {
    // turnover20d stays null for crypto — the CoinGecko universe is already
    // liquidity-floored upstream (CRYPTO_MIN_VOLUME), so no floor gating here.
    await admin.from('signal_history')
      .insert({
        ticker: cacheTicker, verdict: result.verdict, confidence: result.confidence, price: priceNow,
        source: log.source ?? 'user', arm: log.arm ?? null,
      })
      .then(({ error }) => { if (error) console.warn('crypto signal_history insert failed:', error.message); });
  }

  return { ...result, cached: false, aboveSma200 };
}
