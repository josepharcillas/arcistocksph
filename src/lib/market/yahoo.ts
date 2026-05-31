import type { OHLCV } from '../ai/types';

export async function fetchPriceHistory(ticker: string, days = 90): Promise<OHLCV[]> {
  const symbol = ticker.endsWith('.PS') ? ticker : `${ticker}.PS`;
  const end = Math.floor(Date.now() / 1000);
  const start = end - days * 86400;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&period1=${start}&period2=${end}`;

  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });

  if (!response.ok) throw new Error(`Yahoo Finance error for ${symbol}: ${response.status}`);

  const json = await response.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`No data returned for ${symbol}`);

  const timestamps: number[] = result.timestamp ?? [];
  const quotes = result.indicators?.quote?.[0] ?? {};

  return timestamps.map((ts, i) => ({
    date: new Date(ts * 1000).toISOString().split('T')[0],
    open: quotes.open?.[i] ?? 0,
    high: quotes.high?.[i] ?? 0,
    low: quotes.low?.[i] ?? 0,
    close: quotes.close?.[i] ?? 0,
    volume: quotes.volume?.[i] ?? 0,
  })).filter(d => d.close > 0);
}

export async function fetchQuote(ticker: string): Promise<{ price: number; change1d: number }> {
  const symbol = ticker.endsWith('.PS') ? ticker : `${ticker}.PS`;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`;

  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });

  if (!response.ok) throw new Error(`Yahoo Finance quote error for ${symbol}: ${response.status}`);

  const json = await response.json();
  const result = json?.chart?.result?.[0];
  const closes: number[] = result?.indicators?.quote?.[0]?.close ?? [];
  const valid = closes.filter(Boolean);

  if (valid.length < 2) return { price: valid[0] ?? 0, change1d: 0 };

  const current = valid[valid.length - 1];
  const prev = valid[valid.length - 2];
  return {
    price: current,
    change1d: ((current - prev) / prev) * 100,
  };
}
