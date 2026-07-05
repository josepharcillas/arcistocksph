import { describe, it, expect } from 'vitest';
import { bounceRating, pctFromLow, type BounceInput } from './bounceLogic';

// A washed-out-but-turning base case: near the low, oversold, MACD turned up.
const setup: BounceInput = { rsi14: 29, pctFromLow: 4, macdHist: 0.02, aboveSma200: true };

describe('pctFromLow', () => {
  it('measures how far above the lowest close the price sits', () => {
    expect(pctFromLow([10, 12, 8, 9], 9)).toBeCloseTo(12.5, 5); // low 8 -> (9-8)/8
  });
  it('is 0 when sitting on the low', () => {
    expect(pctFromLow([10, 8, 9], 8)).toBe(0);
  });
  it('returns null with no usable data', () => {
    expect(pctFromLow([], 9)).toBeNull();
    expect(pctFromLow([10, 12], 0)).toBeNull();
  });
});

describe('bounceRating', () => {
  it('SETUP: oversold + near low + a turn (MACD >= 0)', () => {
    const r = bounceRating(setup);
    expect(r.rating).toBe('SETUP');
    expect(r.score).toBeGreaterThanOrEqual(5); // very oversold(2) + right at low(2) + turn(2) + >SMA200(1)
    expect(r.reasons.join(' ')).toMatch(/turned up/i);
  });

  it('WAIT: washed out and oversold but MACD still falling (a knife)', () => {
    const r = bounceRating({ ...setup, macdHist: -0.03 });
    expect(r.rating).toBe('WAIT');
    expect(r.reasons.join(' ')).toMatch(/no turn yet|wait for a green day/i);
  });

  it('WAIT: MACD unknown counts as no confirmed turn', () => {
    expect(bounceRating({ ...setup, macdHist: null }).rating).toBe('WAIT');
  });

  it('AVOID: AI verdict SELL is an automatic trap guard, even if it looks washed out', () => {
    const r = bounceRating({ ...setup, verdict: 'SELL' });
    expect(r.rating).toBe('AVOID');
    expect(r.score).toBe(0);
    expect(r.reasons.join(' ')).toMatch(/SELL/);
  });

  it('WAIT (not a dip): neither oversold nor near its low', () => {
    const r = bounceRating({ rsi14: 60, pctFromLow: 40, macdHist: 0.1, aboveSma200: true });
    expect(r.rating).toBe('WAIT');
    expect(r.reasons.join(' ')).toMatch(/not a dip setup/i);
  });

  it('WAIT (no data): all inputs null', () => {
    const r = bounceRating({ rsi14: null, pctFromLow: null, macdHist: null, aboveSma200: null });
    expect(r.rating).toBe('WAIT');
    expect(r.reasons.join(' ')).toMatch(/not enough data/i);
  });

  it('respects custom thresholds (stricter RSI / near-low gates)', () => {
    // rsi 34 passes default 35 but fails a stricter 30 gate; pctFromLow 8 fails an 8%... use 7 to exclude
    const r = bounceRating({ rsi14: 34, pctFromLow: 8, macdHist: 0.1, aboveSma200: true, rsiMax: 30, nearLowPct: 7 });
    expect(r.rating).toBe('WAIT'); // neither gate met under stricter thresholds
    expect(r.reasons.join(' ')).toMatch(/not a dip setup/i);
  });

  it('handles a fresh low (negative pctFromLow) without odd wording', () => {
    const r = bounceRating({ rsi14: 28, pctFromLow: -3, macdHist: 0.02, aboveSma200: false });
    expect(r.rating).toBe('SETUP');
    expect(r.reasons.join(' ')).toMatch(/fresh low/i);
    expect(r.reasons.join(' ')).not.toMatch(/-3%/); // no "-3% above"
  });

  it('qualifies on oversold alone even when not near the low', () => {
    const r = bounceRating({ rsi14: 28, pctFromLow: 25, macdHist: 0.05, aboveSma200: false });
    expect(r.rating).toBe('SETUP'); // oversold + turn is enough, though score is lower
  });
});
