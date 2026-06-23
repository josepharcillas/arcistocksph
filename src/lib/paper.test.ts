import { describe, it, expect } from 'vitest';
import { derivePositions, type PaperTrade } from './paper';

const t = (ticker: string, action: 'BUY' | 'SELL', qty: number, price: number): PaperTrade => ({ ticker, action, qty, price });

describe('derivePositions', () => {
  it('averages cost across multiple buys', () => {
    const p = derivePositions([t('SM', 'BUY', 100, 10), t('SM', 'BUY', 100, 20)]);
    expect(p).toEqual([{ ticker: 'SM', qty: 200, avgCost: 15 }]);
  });

  it('a partial sell keeps the average cost and reduces quantity', () => {
    const p = derivePositions([t('SM', 'BUY', 100, 10), t('SM', 'BUY', 100, 20), t('SM', 'SELL', 50, 30)]);
    expect(p[0].qty).toBe(150);
    expect(p[0].avgCost).toBeCloseTo(15, 6);
  });

  it('drops a fully closed position', () => {
    const p = derivePositions([t('SM', 'BUY', 100, 10), t('SM', 'SELL', 100, 12)]);
    expect(p).toEqual([]);
  });

  it('tracks multiple tickers independently', () => {
    const p = derivePositions([t('SM', 'BUY', 10, 100), t('BDO', 'BUY', 5, 50)]);
    expect(p.find((x) => x.ticker === 'SM')?.qty).toBe(10);
    expect(p.find((x) => x.ticker === 'BDO')?.avgCost).toBe(50);
  });

  it('returns nothing for an empty log', () => {
    expect(derivePositions([])).toEqual([]);
  });
});
