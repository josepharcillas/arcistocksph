import { describe, it, expect } from 'vitest';
import {
  confValue, meetsMinConfidence, pnlPct, exitReason, addToPosition,
  isConfirmed, holdElapsed, inCooldown, trailingStopHit, drawdownHalted,
} from './botLogic';

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

// ── Anti-churn discipline helpers ──

const HOUR = 3600_000;
const NOW = Date.parse('2026-07-02T12:00:00Z');
const rec = (verdict, hoursAgo) => ({ verdict, created_at: new Date(NOW - hoursAgo * HOUR).toISOString() });

describe('isConfirmed (signal must persist ≥24h unbroken)', () => {
  it('confirms a BUY streak spanning more than a day', () => {
    expect(isConfirmed([rec('BUY', 2), rec('BUY', 26)], 'BUY', 2, 24 * HOUR, NOW)).toBe(true);
  });
  it('rejects a single fresh flip (the churn killer)', () => {
    expect(isConfirmed([rec('BUY', 1)], 'BUY', 2, 24 * HOUR, NOW)).toBe(false);
  });
  it('rejects a streak that is long enough in count but too young in span', () => {
    expect(isConfirmed([rec('BUY', 2), rec('BUY', 6)], 'BUY', 2, 24 * HOUR, NOW)).toBe(false);
  });
  it('a contrary verdict breaks the streak even with older agreement', () => {
    // BUY now, but a SELL happened in between — recent history is not an unbroken BUY view
    expect(isConfirmed([rec('BUY', 2), rec('SELL', 12), rec('BUY', 30)], 'BUY', 2, 24 * HOUR, NOW)).toBe(false);
  });
  it('frequent recomputes confirm once the streak reaches back 24h', () => {
    const hist = [rec('BUY', 4), rec('BUY', 8), rec('BUY', 12), rec('BUY', 16), rec('BUY', 20), rec('BUY', 25)];
    expect(isConfirmed(hist, 'BUY', 2, 24 * HOUR, NOW)).toBe(true);
  });
});

describe('holdElapsed / inCooldown', () => {
  it('blocks signal exits inside the minimum hold', () => {
    const boughtYesterday = new Date(NOW - 24 * HOUR).toISOString().slice(0, 10);
    expect(holdElapsed(boughtYesterday, 5, NOW)).toBe(false);
  });
  it('allows exits after the hold', () => {
    const boughtLastWeek = new Date(NOW - 7 * 24 * HOUR).toISOString().slice(0, 10);
    expect(holdElapsed(boughtLastWeek, 5, NOW)).toBe(true);
  });
  it('unknown buy date does not trap the position', () => {
    expect(holdElapsed(null, 5, NOW)).toBe(true);
  });
  it('cooldown blocks re-buying soon after a sell, then releases', () => {
    expect(inCooldown(new Date(NOW - 2 * 24 * HOUR).toISOString(), 5, NOW)).toBe(true);
    expect(inCooldown(new Date(NOW - 6 * 24 * HOUR).toISOString(), 5, NOW)).toBe(false);
    expect(inCooldown(null, 5, NOW)).toBe(false);
  });
});

describe('trailingStopHit (let winners run, exit on rollover)', () => {
  it('no exit while price rides near the peak', () => {
    expect(trailingStopHit(95, 100, 10)).toBeNull();
  });
  it('exits when price falls the trail % off the peak', () => {
    expect(trailingStopHit(90, 100, 10)).toMatch(/trailing stop/);
    expect(trailingStopHit(89, 100, 10)).toMatch(/trailing stop/);
  });
  it('a big winner keeps most of its gain: +50% then -10% trail still locks ~+35%', () => {
    // entry 100 → peak 150 → trail exit at 135 = +35% kept
    expect(trailingStopHit(136, 150, 10)).toBeNull();
    expect(trailingStopHit(135, 150, 10)).toMatch(/trailing stop/);
  });
  it('ignores nonsense inputs', () => {
    expect(trailingStopHit(0, 100, 10)).toBeNull();
    expect(trailingStopHit(100, 0, 10)).toBeNull();
  });
});

describe('drawdownHalted (circuit breaker)', () => {
  it('halts at or beyond the drawdown threshold', () => {
    expect(drawdownHalted(9000, 10000, 10)).toBe(true);
    expect(drawdownHalted(8500, 10000, 10)).toBe(true);
  });
  it('does not halt above the threshold', () => {
    expect(drawdownHalted(9500, 10000, 10)).toBe(false);
    expect(drawdownHalted(10000, 10000, 10)).toBe(false);
  });
  it('no peak recorded → never halts', () => {
    expect(drawdownHalted(9000, 0, 10)).toBe(false);
  });
});
