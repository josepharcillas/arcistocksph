// Pure money-logic helpers for the auto-trade bots, extracted so they can be
// unit-tested without touching Supabase or the network. runAutoTrade composes
// these; the tests in botLogic.test.ts pin their behaviour.

export const confValue = (c?: string | null): number =>
  c === 'HIGH' ? 3 : c === 'MEDIUM' ? 2 : c === 'LOW' ? 1 : 0;

/** Does a signal's confidence clear the buy floor (e.g. only buy MEDIUM+)? */
export const meetsMinConfidence = (c: string | null | undefined, floor: string): boolean =>
  confValue(c) >= confValue(floor);

/** Profit/loss percent of a position vs its average cost. */
export const pnlPct = (price: number, avgCost: number): number =>
  avgCost > 0 ? ((price - avgCost) / avgCost) * 100 : 0;

/**
 * Why a holding should be FULLY exited this run, or null to keep it.
 * Priority: an explicit SELL signal first, then the stop-loss, then take-profit.
 * stopLossPct is negative (e.g. -8), takeProfitPct positive (e.g. +20).
 */
export function exitReason(
  verdict: string | null | undefined,
  plPct: number,
  cfg: { stopLossPct: number; takeProfitPct: number },
): string | null {
  if (verdict === 'SELL') return 'SELL signal';
  if (plPct <= cfg.stopLossPct) return `stop-loss (${cfg.stopLossPct}%)`;
  if (plPct >= cfg.takeProfitPct) return `take-profit (+${cfg.takeProfitPct}%)`;
  return null;
}

/** Weighted-average cost after adding to a position. */
export function addToPosition(
  qty0: number, avgCost0: number, addQty: number, addPrice: number,
): { qty: number; avgCost: number } {
  const qty = qty0 + addQty;
  const avgCost = qty > 0 ? (qty0 * avgCost0 + addQty * addPrice) / qty : 0;
  return { qty, avgCost };
}
