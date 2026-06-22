import type { Technicals } from '../ai/types';

export function computeSMA(closes: number[], period: number): number {
  if (closes.length === 0) return 0;
  const slice = closes.slice(-period);
  // When there's less than `period` of data, average what we have rather than
  // returning the latest price (which made SMA50/200 misleading for new listings).
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

export function computeRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;

  const changes: number[] = [];
  for (let i = 1; i < closes.length; i++) changes.push(closes[i] - closes[i - 1]);

  // Seed with a simple average of the first `period` changes...
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    const c = changes[i];
    if (c > 0) avgGain += c;
    else avgLoss += -c;
  }
  avgGain /= period;
  avgLoss /= period;

  // ...then apply Wilder's smoothing over the rest of the series.
  for (let i = period; i < changes.length; i++) {
    const c = changes[i];
    const gain = c > 0 ? c : 0;
    const loss = c < 0 ? -c : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

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
  // Signal line is the 9-period EMA over the full MACD line (not just the last 9).
  const signalLine = ema(macdLine, 9);

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
