import { describe, it, expect } from 'vitest';
import { aggregateStandings, START_BALANCE, type LbProfile, type LbBalance, type LbTrade } from './leaderboard';

const quotes = new Map<string, { price: number }>([['SM', { price: 600 }], ['BDO', { price: 130 }]]);

describe('aggregateStandings', () => {
  it('totals cash plus live value of open positions', () => {
    const profiles: LbProfile[] = [{ id: 'u1', display_name: 'Alice' }];
    const balances: LbBalance[] = [{ user_id: 'u1', balance: 50000 }];
    const trades: LbTrade[] = [{ user_id: 'u1', ticker: 'SM', action: 'BUY', qty: 100, price: 500 }];
    const [s] = aggregateStandings(profiles, balances, trades, quotes);
    expect(s.total).toBe(50000 + 100 * 600); // cash + 100 SM @ ₱600
    expect(s.name).toBe('Alice');
  });

  it('nets BUY and SELL, ignoring closed/short positions', () => {
    const profiles: LbProfile[] = [{ id: 'u1', display_name: null }];
    const balances: LbBalance[] = [{ user_id: 'u1', balance: 0 }];
    const trades: LbTrade[] = [
      { user_id: 'u1', ticker: 'SM', action: 'BUY', qty: 100, price: 500 },
      { user_id: 'u1', ticker: 'SM', action: 'SELL', qty: 100, price: 550 },
    ];
    const [s] = aggregateStandings(profiles, balances, trades, quotes);
    expect(s.total).toBe(0); // no open position, no cash
    expect(s.name).toBe('Anonymous'); // null display_name fallback
  });

  it('defaults to the ₱100k starting balance when no balance row exists', () => {
    const [s] = aggregateStandings([{ id: 'u1', display_name: 'X' }], [], [], quotes);
    expect(s.total).toBe(START_BALANCE);
  });

  it('values an unknown-price ticker at zero', () => {
    const trades: LbTrade[] = [{ user_id: 'u1', ticker: 'ZZZ', action: 'BUY', qty: 10, price: 5 }];
    const [s] = aggregateStandings([{ id: 'u1', display_name: 'X' }], [{ user_id: 'u1', balance: 1000 }], trades, quotes);
    expect(s.total).toBe(1000); // ZZZ not in quotes → 0 position value
  });
});
