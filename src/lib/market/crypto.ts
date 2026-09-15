// Crypto market data via the free CoinGecko API (no key), priced in PHP so it
// lines up with the ₱ paper account. One call returns the top coins by market
// cap; per-coin market_chart gives daily closes for the indicators.
import type { StockAnalysisInput } from '../ai/types';
import { computeTechnicals } from './indicators';
import { fetchHeadlines } from './news';

const BASE = 'https://api.coingecko.com/api/v3';
const UA = { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' };

// CoinGecko's free tier is rate-limited (429s under bursts). Retry with backoff
// so a scheduled run rides out a transient limit instead of failing outright.
async function cgFetch(url: string, tries = 3): Promise<Response> {
  let last: Response | null = null;
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: UA });
    if (res.ok) return res;
    last = res;
    if (res.status !== 429 && res.status < 500) break; // non-retryable
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  return last!;
}

// Stablecoins (and wrapped/pegged) — no point trading things that don't move.
const STABLE = new Set(['USDT', 'USDC', 'DAI', 'FDUSD', 'USDE', 'TUSD', 'USDS', 'PYUSD', 'USDD', 'BUSD', 'GUSD', 'USDP', 'EURT', 'WBTC', 'WETH', 'WEETH', 'WSTETH', 'STETH']);

export interface CryptoQuote {
  ticker: string;  // namespaced DB id, e.g. "X:BTC" (avoids any PSE-symbol clash)
  symbol: string;  // display symbol, e.g. "BTC"
  name: string;    // e.g. "Bitcoin"
  id: string;      // CoinGecko id, e.g. "bitcoin" (needed for history)
  price: number;   // PHP
  change1d: number; // percent
  volume: number;  // 24h turnover in PHP (already above the liquidity floor)
}

export const CRYPTO_PREFIX = 'X:';

// "Active" = big enough daily turnover to actually trade. Coins below this 24h
// volume (in PHP) are illiquid junk where a paper fill at the quote is fiction.
const MIN_VOLUME_PHP = Number(process.env.CRYPTO_MIN_VOLUME ?? 50_000_000); // ≈ $0.9M/day

/** Active non-stablecoin coins by market cap, keyed by namespaced ticker ("X:BTC").
 *  Pages through CoinGecko (250/page) up to `limit` coins. */
export async function fetchTopCryptoQuotes(limit = 250): Promise<Map<string, CryptoQuote>> {
  const map = new Map<string, CryptoQuote>();
  const maxPages = Math.min(4, Math.ceil((limit + 50) / 250)); // small over-fetch for filtered rows
  for (let page = 1; page <= maxPages && map.size < limit; page++) {
    const url = `${BASE}/coins/markets?vs_currency=php&order=market_cap_desc&per_page=250&page=${page}&price_change_percentage=24h`;
    const res = await cgFetch(url);
    if (!res.ok) {
      if (map.size > 0) break; // keep what we have on a late-page failure
      throw new Error(`CoinGecko markets error: ${res.status}`);
    }
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const r of rows) {
      const symbol = String(r.symbol ?? '').toUpperCase();
      if (!symbol || STABLE.has(symbol)) continue;
      if (!(r.current_price > 0)) continue;
      if (!(Number(r.total_volume ?? 0) >= MIN_VOLUME_PHP)) continue; // liquidity floor
      const ticker = CRYPTO_PREFIX + symbol;
      if (map.has(ticker)) continue; // duplicate symbols across coins — first (bigger cap) wins
      map.set(ticker, {
        ticker, symbol, name: r.name ?? symbol, id: r.id,
        price: r.current_price, change1d: r.price_change_percentage_24h ?? 0,
        volume: Number(r.total_volume ?? 0),
      });
      if (map.size >= limit) break;
    }
  }
  return map;
}

/** Daily closing prices (PHP) for a coin, oldest-first. ~365 points for SMA200. */
export async function fetchCryptoHistory(coinId: string, days = 365): Promise<number[]> {
  const url = `${BASE}/coins/${coinId}/market_chart?vs_currency=php&days=${days}`;
  const res = await cgFetch(url);
  if (!res.ok) throw new Error(`CoinGecko history error for ${coinId}: ${res.status}`);
  const json = await res.json();
  const prices: [number, number][] = json?.prices ?? [];
  return prices.map((p) => p[1]).filter((n) => Number.isFinite(n) && n > 0);
}

/** Assemble the AI analysis input for a coin (same shape as a stock, crypto-framed). */
export async function getCryptoData(coinId: string, symbol: string, name: string): Promise<StockAnalysisInput> {
  const [closesR, newsR] = await Promise.allSettled([
    fetchCryptoHistory(coinId),
    fetchHeadlines(symbol, name).catch(() => [] as string[]),
  ]);
  const closes = closesR.status === 'fulfilled' ? closesR.value : [];

  const base = closes.length > 0
    ? computeTechnicals(closes)
    : { rsi14: 50, macd: { macd: 0, signal: 0, histogram: 0 }, sma20: 0, sma50: 0, sma200: 0 };

  const currentPrice = closes[closes.length - 1] ?? 0;
  const prev1d = closes[closes.length - 2] ?? currentPrice;
  const prev1w = closes[closes.length - 8] ?? currentPrice;

  return {
    ticker: symbol,
    companyName: name,
    assetClass: 'crypto',
    priceHistory: closes.map((c) => ({ date: '', open: c, high: c, low: c, close: c, volume: 0 })),
    technicals: {
      ...base,
      currentPrice,
      priceChange1d: prev1d > 0 ? ((currentPrice - prev1d) / prev1d) * 100 : 0,
      priceChange1w: prev1w > 0 ? ((currentPrice - prev1w) / prev1w) * 100 : 0,
    },
    fundamentals: { pe: null, eps: null, revenue: null, bookValue: null, dividendYield: null, marketCap: null, outstandingShares: null },
    headlines: newsR.status === 'fulfilled' ? newsR.value : [],
  };
}
