import { describe, it, expect } from 'vitest';
import { mergeTransactions } from './botScoreboard';

describe('mergeTransactions', () => {
  it('sorts trades and dividends into one newest-first timeline', () => {
    const out = mergeTransactions(
      [
        { ticker: 'TEL', action: 'BUY', qty: 5, price: 1300, reason: 'DCA', traded_at: '2026-06-01T02:00:00Z' },
        { ticker: 'TEL', action: 'BUY', qty: 5, price: 1350, reason: 'DCA', traded_at: '2026-07-01T02:00:00Z' },
      ],
      [{ ticker: 'TEL', pesos: 60, amount: 6, payment_date: '2026-06-20', credited_at: '2026-06-20T00:00:00Z' }],
    );
    expect(out.map((t) => t.date.slice(0, 10))).toEqual(['2026-07-01', '2026-06-20', '2026-06-01']);
  });

  it('maps a dividend credit to qty = pesos / amount and value = pesos', () => {
    const [d] = mergeTransactions([], [{ ticker: 'TEL', pesos: 60, amount: 6, payment_date: '2026-06-20' }]);
    expect(d.action).toBe('DIVIDEND');
    expect(d.qty).toBe(10);
    expect(d.price).toBe(6);
    expect(d.value).toBe(60);
    expect(d.reason).toContain('dividend');
  });

  it('strips the X: crypto prefix for display', () => {
    const [t] = mergeTransactions([{ ticker: 'X:BTC', action: 'BUY', qty: 0.001, price: 6000000, traded_at: '2026-07-01T00:00:00Z' }]);
    expect(t.ticker).toBe('BTC');
    expect(t.value).toBeCloseTo(6000);
  });

  it('carries a null reason through (pre-persistence trades)', () => {
    const [t] = mergeTransactions([{ ticker: 'SM', action: 'BUY', qty: 1, price: 900, reason: null, traded_at: '2026-07-01T00:00:00Z' }]);
    expect(t.reason).toBeNull();
  });

  it('returns an empty array for empty input', () => {
    expect(mergeTransactions([], [])).toEqual([]);
    expect(mergeTransactions()).toEqual([]);
  });
});
