import { analyzeStock } from './ai';
import { getCryptoData } from './market/crypto';
import { query, queryOne } from './db';
import type { SignalLogContext, SignalWithMeta } from './signals';

// Crypto counterpart of getOrComputeSignal: same DB cache + accuracy log, but it
// fetches crypto data (CoinGecko) and stores under a namespaced ticker ("X:BTC")
// so it never collides with PSE stock signals. No SELL-push (crypto bot only).

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4h, shared via DB

interface CacheRow {
  verdict: string; confidence: string; rationale: string;
  target_price: number | null; stop_loss: number | null; provider: string;
  above_sma200: boolean | null; computed_at: string;
}

export async function getOrComputeCryptoSignal(
  cacheTicker: string, // namespaced, e.g. "X:BTC"
  coinId: string,      // CoinGecko id, e.g. "bitcoin"
  symbol: string,      // display, e.g. "BTC"
  name: string,
  log: SignalLogContext = {},
): Promise<SignalWithMeta> {
  const cached = await queryOne<CacheRow>(`select * from signal_cache where ticker = $1`, [cacheTicker]);
  if (cached && Date.now() - new Date(cached.computed_at).getTime() < CACHE_TTL_MS) {
    return {
      verdict: cached.verdict as SignalWithMeta['verdict'], confidence: cached.confidence as SignalWithMeta['confidence'],
      rationale: cached.rationale, targetPrice: cached.target_price, stopLoss: cached.stop_loss, provider: cached.provider,
      analyzedAt: cached.computed_at, cached: true, aboveSma200: cached.above_sma200 ?? null,
    };
  }

  const data = await getCryptoData(coinId, symbol, name);
  const result = await analyzeStock(data);

  const t = data.technicals;
  const aboveSma200 = t && t.sma200 > 0 ? t.currentPrice > t.sma200 : null;

  await query(
    `insert into signal_cache (ticker, verdict, confidence, rationale, target_price, stop_loss, provider, above_sma200, computed_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8, now())
     on conflict (ticker) do update set
       verdict = excluded.verdict, confidence = excluded.confidence, rationale = excluded.rationale,
       target_price = excluded.target_price, stop_loss = excluded.stop_loss, provider = excluded.provider,
       above_sma200 = excluded.above_sma200, computed_at = now()`,
    [cacheTicker, result.verdict, result.confidence, result.rationale, result.targetPrice, result.stopLoss, result.provider, aboveSma200]
  );

  const priceNow = data.technicals?.currentPrice;
  if (priceNow) {
    // turnover20d stays null for crypto — the CoinGecko universe is already
    // liquidity-floored upstream (CRYPTO_MIN_VOLUME), so no floor gating here.
    query(
      `insert into signal_history (ticker, verdict, confidence, price, source, arm)
         values ($1,$2,$3,$4,$5,$6)`,
      [cacheTicker, result.verdict, result.confidence, priceNow, log.source ?? 'user', log.arm ?? null]
    ).catch((err) => console.warn('crypto signal_history insert failed:', err instanceof Error ? err.message : err));
  }

  return { ...result, cached: false, aboveSma200 };
}
