// Paper-trading position math, extracted pure so it can be unit-tested.
// Derives net open positions (qty + weighted-average cost) from a trade log.

export interface PaperTrade {
  ticker: string;
  action: 'BUY' | 'SELL';
  qty: number;
  price: number;
}

export interface PaperPosition {
  ticker: string;
  qty: number;
  avgCost: number;
}

// `trades` must be in chronological (oldest-first) order. SELLs reduce quantity
// at the running average cost, leaving avg cost of the remaining lot unchanged.
export function derivePositions(trades: PaperTrade[]): PaperPosition[] {
  const byTicker: Record<string, { qty: number; cost: number }> = {};
  for (const t of trades) {
    const p = (byTicker[t.ticker] ??= { qty: 0, cost: 0 });
    const qty = Number(t.qty);
    const price = Number(t.price);
    if (t.action === 'BUY') {
      p.cost += qty * price;
      p.qty += qty;
    } else {
      const avg = p.qty > 0 ? p.cost / p.qty : 0;
      p.qty -= qty;
      p.cost -= avg * qty;
    }
  }
  return Object.entries(byTicker)
    .filter(([, p]) => p.qty > 0.0001)
    .map(([ticker, p]) => ({ ticker, qty: p.qty, avgCost: p.cost / p.qty }));
}
