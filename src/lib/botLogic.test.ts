import { describe, it, expect } from 'vitest';
import { confValue, meetsMinConfidence, pnlPct, exitReason, addToPosition } from './botLogic';

describe('confidence gating', () => {
  it('ranks confidence levels', () => {
    expect(confValue('HIGH')).toBe(3);
    expect(confValue('MEDIUM')).toBe(2);
    expect(confValue('LOW')).toBe(1);
    expect(confValue(null)).toBe(0);
    expect(confValue(undefined)).toBe(0);
  });

  it('HIGH-only floor rejects MEDIUM and LOW', () => {
    expect(meetsMinConfidence('HIGH', 'HIGH')).toBe(true);
    expect(meetsMinConfidence('MEDIUM', 'HIGH')).toBe(false);
    expect(meetsMinConfidence('LOW', 'HIGH')).toBe(false);
  });

  it('MEDIUM floor accepts HIGH/MEDIUM but not LOW (the crypto fix)', () => {
    expect(meetsMinConfidence('HIGH', 'MEDIUM')).toBe(true);
    expect(meetsMinConfidence('MEDIUM', 'MEDIUM')).toBe(true);
    expect(meetsMinConfidence('LOW', 'MEDIUM')).toBe(false);
    expect(meetsMinConfidence(null, 'MEDIUM')).toBe(false);
  });
});

describe('pnlPct', () => {
  it('computes profit/loss vs cost', () => {
    expect(pnlPct(110, 100)).toBeCloseTo(10);
    expect(pnlPct(92, 100)).toBeCloseTo(-8);
  });
  it('is 0 when cost is unknown (avoids divide-by-zero)', () => {
    expect(pnlPct(50, 0)).toBe(0);
  });
});

describe('exitReason', () => {
  const cfg = { stopLossPct: -8, takeProfitPct: 20 };

  it('exits on a SELL signal regardless of P/L', () => {
    expect(exitReason('SELL', 0, cfg)).toBe('SELL signal');
    expect(exitReason('SELL', 50, cfg)).toBe('SELL signal'); // even while up big
  });

  it('SELL signal takes priority over take-profit', () => {
    expect(exitReason('SELL', 25, cfg)).toBe('SELL signal');
  });

  it('triggers stop-loss when down past the threshold', () => {
    expect(exitReason('HOLD', -8, cfg)).toBe('stop-loss (-8%)');
    expect(exitReason('HOLD', -20, cfg)).toBe('stop-loss (-8%)');
  });

  it('triggers take-profit when up past the threshold', () => {
    expect(exitReason('HOLD', 20, cfg)).toBe('take-profit (+20%)');
    expect(exitReason('BUY', 35, cfg)).toBe('take-profit (+20%)');
  });

  it('holds when between the stop and target', () => {
    expect(exitReason('HOLD', 5, cfg)).toBeNull();
    expect(exitReason('BUY', -5, cfg)).toBeNull();
    expect(exitReason(null, 19.9, cfg)).toBeNull();
  });

  it('respects wider crypto thresholds', () => {
    const crypto = { stopLossPct: -15, takeProfitPct: 35 };
    expect(exitReason('HOLD', -10, crypto)).toBeNull(); // would stop out on stocks, not crypto
    expect(exitReason('HOLD', -15, crypto)).toBe('stop-loss (-15%)');
    expect(exitReason('HOLD', 35, crypto)).toBe('take-profit (+35%)');
  });
});

describe('addToPosition (weighted average cost)', () => {
  it('opens a new position', () => {
    expect(addToPosition(0, 0, 100, 10)).toEqual({ qty: 100, avgCost: 10 });
  });

  it('averages up correctly', () => {
    // 100 @ 10 then 100 @ 20 -> 200 @ 15
    expect(addToPosition(100, 10, 100, 20)).toEqual({ qty: 200, avgCost: 15 });
  });

  it('averages down correctly', () => {
    // 100 @ 10 then 300 @ 6 -> 400 @ 7
    const r = addToPosition(100, 10, 300, 6);
    expect(r.qty).toBe(400);
    expect(r.avgCost).toBeCloseTo(7);
  });

  it('handles fractional crypto quantities', () => {
    const r = addToPosition(0.5, 4_000_000, 0.5, 3_000_000);
    expect(r.qty).toBeCloseTo(1);
    expect(r.avgCost).toBeCloseTo(3_500_000);
  });
});
