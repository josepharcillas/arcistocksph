import type { Technicals } from '../ai/types';

export function computeSMA(closes: number[], period: number): number {
  const slice = closes.slice(-period);
  if (slice.length < period) return closes[closes.length - 1] ?? 0;
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function computeRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;

  const changes = closes.slice(-period - 1).map((c, i, arr) =>
    i === 0 ? 0 : c - arr[i - 1]
  ).slice(1);

  const gains = changes.map(c => (c > 0 ? c : 0));
  const losses = changes.map(c => (c < 0 ? Math.abs(c) : 0));

  const avgGain = gains.reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.reduce((a, b) => a + b, 0) / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  values.forEach((v, i) => {
    if (i === 0) result.push(v);
    else result.push(v * k + result[i - 1] * (1 - k));
  });
  return result;
}

export function computeMACD(closes: number[]): { macd: number; signal: number; histogram: number } {
  if (closes.length < 26) return { macd: 0, signal: 0, histogram: 0 };

  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = ema(macdLine.slice(-9), 9);

  const macd = macdLine[macdLine.length - 1];
  const signal = signalLine[signalLine.length - 1];
  return { macd, signal, histogram: macd - signal };
}

export function computeTechnicals(closes: number[]): Omit<Technicals, 'currentPrice' | 'priceChange1d' | 'priceChange1w'> {
  return {
    rsi14: computeRSI(closes),
    macd: computeMACD(closes),
    sma20: computeSMA(closes, 20),
    sma50: computeSMA(closes, 50),
    sma200: computeSMA(closes, 200),
  };
}
