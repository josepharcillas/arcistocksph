import { describe, it, expect } from 'vitest';
import { computeSMA, computeRSI, computeMACD, computeTechnicals } from './indicators';

describe('computeSMA', () => {
  it('averages the last N closes', () => {
    expect(computeSMA([1, 2, 3, 4, 5], 5)).toBe(3);
    expect(computeSMA([10, 20, 30, 40], 2)).toBe(35);
  });

  it('averages the available data when there is less than `period`', () => {
    // Better than returning the latest price for young listings (SMA50/200).
    expect(computeSMA([7, 8], 50)).toBe(7.5);
    expect(computeSMA([], 20)).toBe(0);
  });
});

describe('computeRSI', () => {
  it('returns 100 when there are no losses', () => {
    const rising = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(computeRSI(rising)).toBe(100);
  });

  it('returns the neutral 50 when there is not enough data', () => {
    expect(computeRSI([1, 2, 3])).toBe(50);
  });

  it('stays within 0..100', () => {
    const closes = [44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
    const rsi = computeRSI(closes);
    expect(rsi).toBeGreaterThan(0);
    expect(rsi).toBeLessThan(100);
  });

  it("matches Wilder's textbook value on the canonical series", () => {
    // Wilder's "New Concepts in Technical Trading Systems" example data.
    // First 14-period RSI ≈ 70.46.
    const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
    expect(computeRSI(closes)).toBeCloseTo(70.46, 1);
  });

  it("applies Wilder's smoothing as the series extends", () => {
    // Adding the next close (46.00, a down move) smooths the RSI to ≈ 66.25.
    const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00];
    expect(computeRSI(closes)).toBeCloseTo(66.25, 1);
  });
});

describe('computeMACD', () => {
  it('returns zeros when there are fewer than 26 points', () => {
    expect(computeMACD([1, 2, 3])).toEqual({ macd: 0, signal: 0, histogram: 0 });
  });

  it('histogram equals macd minus signal', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5);
    const { macd, signal, histogram } = computeMACD(closes);
    expect(histogram).toBeCloseTo(macd - signal, 6);
  });
});

describe('computeTechnicals', () => {
  it('produces all indicator fields', () => {
    const closes = Array.from({ length: 200 }, (_, i) => 50 + i * 0.1);
    const t = computeTechnicals(closes);
    expect(t).toHaveProperty('rsi14');
    expect(t).toHaveProperty('macd.histogram');
    expect(t.sma20).toBeGreaterThan(0);
    expect(t.sma200).toBeGreaterThan(0);
  });
});
