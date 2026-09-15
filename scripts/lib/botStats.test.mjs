import { describe, it, expect } from 'vitest';
import { winRateReplay, alpha, basketReturn } from './botStats.mjs';

describe('winRateReplay', () => {
  it('counts a profitable round trip as one win', () => {
    const r = winRateReplay([
      { ticker: 'SM', action: 'BUY', qty: 10, price: 100 },
      { ticker: 'SM', action: 'SELL', qty: 10, price: 120 },
    ]);
    expect(r.closed).toBe(1);
    expect(r.wins).toBe(1);
    expect(r.realized).toBeCloseTo(200);
    expect(r.winRate).toBe(100);
  });

  it('closes against average cost after averaging up, and counts a loss', () => {
    const r = winRateReplay([
      { ticker: 'SM', action: 'BUY', qty: 10, price: 100 },
      { ticker: 'SM', action: 'BUY', qty: 10, price: 200 }, // avg 150
      { ticker: 'SM', action: 'SELL', qty: 10, price: 120 },
    ]);
    expect(r.realized).toBeCloseTo(-300); // (120-150)*10
    expect(r.wins).toBe(0);
    expect(r.winRate).toBe(0);
  });

  it('returns null win-rate when nothing has closed', () => {
    const r = winRateReplay([{ ticker: 'SM', action: 'BUY', qty: 10, price: 100 }]);
    expect(r.closed).toBe(0);
    expect(r.winRate).toBeNull();
  });

  it('handles empty / missing input', () => {
    expect(winRateReplay([]).winRate).toBeNull();
    expect(winRateReplay(undefined).closed).toBe(0);
  });
});

describe('alpha', () => {
  it('subtracts benchmark from bot return', () => {
    expect(alpha(5, 2)).toBe(3);
    expect(alpha(-1, 4)).toBe(-5);
  });
  it('is null when either side is null', () => {
    expect(alpha(null, 2)).toBeNull();
    expect(alpha(5, null)).toBeNull();
  });
});

describe('basketReturn', () => {
  it('averages per-name returns, accepting a Map or object of current prices', () => {
    const baseline = { A: 100, B: 100 };
    expect(basketReturn(baseline, { A: 110, B: 90 })).toBeCloseTo(0);
    expect(basketReturn(baseline, new Map([['A', 120], ['B', 120]]))).toBeCloseTo(20);
  });
  it('skips names with no valid current price', () => {
    expect(basketReturn({ A: 100, B: 100 }, { A: 110 })).toBeCloseTo(10);
  });
  it('is null when nothing is priced', () => {
    expect(basketReturn({}, {})).toBeNull();
    expect(basketReturn({ A: 100 }, { A: 0 })).toBeNull();
  });
});
