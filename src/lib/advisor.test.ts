import { describe, it, expect } from 'vitest';
import { computeAdvice, headlineSignature, DEFAULT_ADVISOR_CONFIG, boardLot, computeDeployPlan, type AdvisorPosition, type DeployCandidate } from './advisor';

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

describe('maxPositions cap + market-scan opportunities', () => {
  const heldBook = (n: number): AdvisorPosition[] =>
    Array.from({ length: n }, (_, i) => pos({ ticker: `H${i}`, shares: 10, avgCost: 10, price: 10 }));

  it('blocks NEW entries once the book is maxPositions wide', () => {
    const positions = [
      ...heldBook(10), // at the default cap of 10
      pos({ ticker: 'NEWCO', shares: 0, avgCost: 0, price: 10, verdict: 'BUY', confidence: 'HIGH', isNew: true }),
    ];
    const advice = computeAdvice(positions, 5000);
    expect(advice.actions.some((a) => a.kind === 'BUY' && a.ticker === 'NEWCO')).toBe(false);
  });

  it('still allows ADDING to an existing holding at the cap', () => {
    const book = heldBook(10);
    book[0] = { ...book[0], verdict: 'BUY', confidence: 'HIGH' };
    const advice = computeAdvice(book, 5000);
    expect(advice.actions.some((a) => a.kind === 'BUY' && a.ticker === 'H0')).toBe(true);
  });

  it('allows a new entry under the cap and labels market-scan finds', () => {
    const positions = [
      ...heldBook(2),
      pos({ ticker: 'NEWCO', shares: 0, avgCost: 0, price: 10, verdict: 'BUY', confidence: 'HIGH', isNew: true }),
    ];
    const advice = computeAdvice(positions, 5000);
    const buy = advice.actions.find((a) => a.kind === 'BUY' && a.ticker === 'NEWCO');
    expect(buy).toBeDefined();
    expect(buy!.reason).toMatch(/New opportunity from the market scan/);
  });

  it('counts multiple new entries against the cap within one run', () => {
    const positions = [
      ...heldBook(9), // one slot left
      pos({ ticker: 'NEW1', shares: 0, avgCost: 0, price: 10, verdict: 'BUY', confidence: 'HIGH', isNew: true }),
      pos({ ticker: 'NEW2', shares: 0, avgCost: 0, price: 10, verdict: 'BUY', confidence: 'HIGH', isNew: true }),
    ];
    const advice = computeAdvice(positions, 5000);
    const newBuys = advice.actions.filter((a) => a.kind === 'BUY' && a.ticker?.startsWith('NEW'));
    expect(newBuys).toHaveLength(1); // only the one free slot gets filled
  });
});

describe('boardLot', () => {
  it('returns the PSE lot size for each price band', () => {
    expect(boardLot(0.005)).toBe(1_000_000);
    expect(boardLot(0.03)).toBe(100_000);
    expect(boardLot(0.4)).toBe(10_000);
    expect(boardLot(4.2)).toBe(1_000);
    expect(boardLot(33)).toBe(100);
    expect(boardLot(120)).toBe(10);
    expect(boardLot(1250)).toBe(5);
  });
});

describe('computeDeployPlan', () => {
  const cand = (o: Partial<DeployCandidate> & { ticker: string }): DeployCandidate => ({
    price: 10, heldValue: 0, source: 'signal', ...o,
  });

  it('spreads a deposit across multiple names instead of lumping into one', () => {
    const plan = computeDeployPlan(
      [cand({ ticker: 'A', price: 4 }), cand({ ticker: 'B', price: 5 }), cand({ ticker: 'C', price: 8 })],
      10000, 10000,
    );
    expect(plan.buys.length).toBeGreaterThanOrEqual(2);
    // no single buy should swallow the whole deposit
    expect(Math.max(...plan.buys.map((b) => b.pesos))).toBeLessThan(10000);
  });

  it('rounds every buy to a valid board lot', () => {
    const plan = computeDeployPlan([cand({ ticker: 'X', price: 4.2 })], 10000, 100000);
    const buy = plan.buys.find((b) => b.ticker === 'X')!;
    expect(buy.shares % boardLot(4.2)).toBe(0); // whole board lots only
  });

  it('falls back to dividend blue chips when there are no signal BUYs', () => {
    const plan = computeDeployPlan(
      [cand({ ticker: 'TEL', price: 12, source: 'dividend' }), cand({ ticker: 'BDO', price: 15, source: 'dividend' })],
      10000, 10000,
    );
    expect(plan.buys.length).toBeGreaterThan(0);
    expect(plan.buys.every((b) => b.source === 'dividend')).toBe(true);
  });

  it('prioritises signal BUYs ahead of dividend fillers', () => {
    const plan = computeDeployPlan(
      [cand({ ticker: 'SIG', price: 10, source: 'signal' }), cand({ ticker: 'DIV', price: 10, source: 'dividend' })],
      2000, 100000, { targetNames: 1 }, // big equity so the cap never binds
    );
    expect(plan.buys.map((b) => b.ticker)).toEqual(['SIG']);
  });

  it('respects the concentration cap against equity', () => {
    // cap 30% of ₱1,000 equity = ₱300; deposit is larger but cap should bind
    const plan = computeDeployPlan([cand({ ticker: 'A', price: 5 })], 10000, 1000, { targetNames: 1 });
    const buy = plan.buys.find((b) => b.ticker === 'A');
    expect((buy?.pesos ?? 0)).toBeLessThanOrEqual(300);
  });

  it('holds cash when nothing is affordable within the deposit', () => {
    const plan = computeDeployPlan([cand({ ticker: 'PRICEY', price: 5000 })], 1000, 1000);
    expect(plan.buys).toHaveLength(0);
    expect(plan.leftover).toBe(1000);
  });

  it('never deploys more than the deposit', () => {
    const plan = computeDeployPlan(
      [cand({ ticker: 'A', price: 4 }), cand({ ticker: 'B', price: 5 }), cand({ ticker: 'C', price: 8 }), cand({ ticker: 'D', price: 3 })],
      10000, 1e9, // huge equity so the cap never binds
    );
    expect(plan.deployed).toBeLessThanOrEqual(10000);
    expect(plan.deployed + plan.leftover).toBeCloseTo(10000, 5);
  });
});
