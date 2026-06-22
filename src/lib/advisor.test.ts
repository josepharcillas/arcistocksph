import { describe, it, expect } from 'vitest';
import { computeAdvice, headlineSignature, DEFAULT_ADVISOR_CONFIG, type AdvisorPosition } from './advisor';

const RISK = { ...DEFAULT_ADVISOR_CONFIG, sizing: 'risk' as const, riskPerTradePct: 2 };

const pos = (o: Partial<AdvisorPosition> & { ticker: string }): AdvisorPosition => ({
  shares: 100, avgCost: 10, price: 10, verdict: null, confidence: null, ...o,
});

describe('computeAdvice', () => {
  it('EXITs a deep loser that has a SELL signal', () => {
    const advice = computeAdvice([pos({ ticker: 'DITO', shares: 300, avgCost: 7.56, price: 0.72, verdict: 'SELL', confidence: 'MEDIUM' })], 0);
    const exit = advice.actions.find((a) => a.kind === 'EXIT');
    expect(exit?.ticker).toBe('DITO');
    expect(exit?.shares).toBe(300);
  });

  it('does NOT exit a SELL that is not a deep loss', () => {
    const advice = computeAdvice([pos({ ticker: 'NIKL', shares: 2500, avgCost: 5.99, price: 4.33, verdict: 'SELL' })], 0);
    expect(advice.actions.some((a) => a.kind === 'EXIT')).toBe(false);
  });

  it('TRIMs an over-concentrated position down toward the cap', () => {
    // single position = 100% of equity, cap 30%
    const advice = computeAdvice([pos({ ticker: 'DMC', shares: 1000, avgCost: 8, price: 10 })], 0);
    const trim = advice.actions.find((a) => a.kind === 'TRIM');
    expect(trim?.ticker).toBe('DMC');
    expect(trim?.shares).toBeGreaterThan(0);
    // after trimming, remaining weight should be ~<= cap
    expect(trim!.shares!).toBeLessThan(1000);
  });

  it('BUYs the highest-confidence under-cap candidate with available cash', () => {
    const advice = computeAdvice(
      [
        pos({ ticker: 'LTG', shares: 10, avgCost: 10, price: 10, verdict: 'BUY', confidence: 'MEDIUM' }),
        pos({ ticker: 'AC', shares: 10, avgCost: 10, price: 10, verdict: 'BUY', confidence: 'HIGH' }),
      ],
      1000
    );
    const buy = advice.actions.find((a) => a.kind === 'BUY');
    expect(buy?.ticker).toBe('AC'); // HIGH beats MEDIUM
    expect(buy?.shares).toBeGreaterThan(0);
  });

  it('never recommends adding to a position already above the cap', () => {
    const advice = computeAdvice(
      [pos({ ticker: 'BIG', shares: 100, avgCost: 10, price: 10, verdict: 'BUY', confidence: 'HIGH' })],
      50 // tiny cash; BIG is 100% weight already
    );
    expect(advice.actions.some((a) => a.kind === 'BUY' && a.ticker === 'BIG')).toBe(false);
  });

  it('falls back to HOLD_CASH when no BUY candidate clears the bar', () => {
    const advice = computeAdvice([pos({ ticker: 'X', verdict: 'HOLD' })], 5000);
    const hold = advice.actions.find((a) => a.kind === 'HOLD_CASH');
    expect(hold).toBeTruthy();
    expect(hold?.pesos).toBe(5000);
  });

  it('frees cash via exit, then can deploy it into a buy', () => {
    const advice = computeAdvice(
      [
        pos({ ticker: 'DEAD', shares: 100, avgCost: 100, price: 10, verdict: 'SELL', confidence: 'LOW' }), // -90%, exits → frees 1000
        pos({ ticker: 'GOOD', shares: 1, avgCost: 10, price: 10, verdict: 'BUY', confidence: 'HIGH' }),     // tiny weight
      ],
      0
    );
    expect(advice.actions.some((a) => a.kind === 'EXIT' && a.ticker === 'DEAD')).toBe(true);
    expect(advice.actions.some((a) => a.kind === 'BUY' && a.ticker === 'GOOD')).toBe(true);
  });

  it('computes equity, weights, and P/L', () => {
    const advice = computeAdvice([pos({ ticker: 'A', shares: 10, avgCost: 8, price: 10 })], 100);
    expect(advice.equity).toBe(200); // 100 cash + 100 holdings
    expect(advice.holdingsValue).toBe(100);
    expect(advice.positions[0].weightPct).toBeCloseTo(50, 5);
    expect(advice.positions[0].pnlPct).toBeCloseTo(25, 5);
  });

  it('uses the configured cap', () => {
    const advice = computeAdvice([pos({ ticker: 'A', shares: 100, avgCost: 10, price: 10 })], 0, { ...DEFAULT_ADVISOR_CONFIG, maxWeightPct: 50 });
    // 100% weight, cap 50 → should trim
    expect(advice.actions.some((a) => a.kind === 'TRIM')).toBe(true);
  });
});

describe('risk-based sizing (U1)', () => {
  it('sizes a buy by equity-at-risk to the stop-loss', () => {
    // equity = 10000 cash; risk 2% = ₱200; stop ₱1 below ₱10 → 200 shares
    const advice = computeAdvice(
      [pos({ ticker: 'GOOD', shares: 0, avgCost: 0, price: 10, stopLoss: 9, verdict: 'BUY', confidence: 'HIGH' })],
      10000, RISK
    );
    const buy = advice.actions.find((a) => a.kind === 'BUY');
    expect(buy?.shares).toBe(200);
  });

  it('falls back to cap/cash sizing when no usable stop-loss', () => {
    const advice = computeAdvice(
      [pos({ ticker: 'GOOD', shares: 0, avgCost: 0, price: 10, stopLoss: null, verdict: 'BUY', confidence: 'HIGH' })],
      1000, RISK
    );
    const buy = advice.actions.find((a) => a.kind === 'BUY');
    // cap room = 30% of 1000 = 300 → 30 shares; cash allows 100; cap binds
    expect(buy?.shares).toBe(30);
  });

  it('never lets risk sizing exceed the cap', () => {
    // huge risk budget but cap still binds
    const advice = computeAdvice(
      [pos({ ticker: 'GOOD', shares: 0, avgCost: 0, price: 10, stopLoss: 9.99, verdict: 'BUY', confidence: 'HIGH' })],
      1000, { ...RISK, riskPerTradePct: 90 }
    );
    const buy = advice.actions.find((a) => a.kind === 'BUY');
    expect(buy!.shares!).toBeLessThanOrEqual(30); // 30% of ₱1000 / ₱10
  });
});

describe('watchlist candidates (U2)', () => {
  it('treats a zero-share watchlist BUY as a buy candidate and marks it not-held', () => {
    const advice = computeAdvice(
      [pos({ ticker: 'WL', shares: 0, avgCost: 0, price: 10, verdict: 'BUY', confidence: 'HIGH' })],
      1000
    );
    expect(advice.actions.some((a) => a.kind === 'BUY' && a.ticker === 'WL')).toBe(true);
    expect(advice.positions.find((p) => p.ticker === 'WL')?.isHolding).toBe(false);
  });

  it('marks held positions as holdings', () => {
    const advice = computeAdvice([pos({ ticker: 'H', shares: 10, avgCost: 10, price: 10 })], 0);
    expect(advice.positions.find((p) => p.ticker === 'H')?.isHolding).toBe(true);
  });
});

describe('headlineSignature (U3)', () => {
  it('returns null when the only advice is to hold cash', () => {
    const advice = computeAdvice([pos({ ticker: 'X', verdict: 'HOLD' })], 5000);
    expect(headlineSignature(advice)).toBeNull();
  });

  it('returns a stable signature for the top actionable recommendation', () => {
    const advice = computeAdvice([pos({ ticker: 'DEAD', shares: 100, avgCost: 100, price: 10, verdict: 'SELL', confidence: 'LOW' })], 0);
    expect(headlineSignature(advice)).toBe('EXIT:DEAD:100');
  });
});
