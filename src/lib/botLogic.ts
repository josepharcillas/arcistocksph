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

// ── Anti-churn discipline (research-backed; see docs/brainstorms + memory) ──
// The documented #1 retail-bot killer is reacting to every signal flip. These
// helpers implement: signal confirmation, minimum hold, re-entry cooldown, and
// a trailing stop that lets winners run instead of a fixed take-profit.

export interface SignalRecord { verdict: string; created_at: string }

/**
 * A verdict is "confirmed" when the newest history records form an UNBROKEN
 * streak of that verdict, at least `minCount` long, whose oldest record is at
 * least `minSpanMs` old — i.e. the view persisted across recomputes for a day+,
 * so it's signal, not noise. `history` must be newest-first.
 */
export function isConfirmed(
  history: SignalRecord[], verdict: string, minCount = 2, minSpanMs = 24 * 60 * 60 * 1000, now = Date.now(),
): boolean {
  let streak = 0;
  let oldestInStreak: number | null = null;
  for (const h of history) {
    if (h.verdict !== verdict) break;
    streak++;
    oldestInStreak = new Date(h.created_at).getTime();
  }
  if (streak < minCount || oldestInStreak == null) return false;
  return now - oldestInStreak >= minSpanMs;
}

/** Minimum hold: signal-based exits are blocked for `minHoldDays` after entry. */
export function holdElapsed(buyDate: string | null | undefined, minHoldDays: number, now = Date.now()): boolean {
  if (!buyDate) return true; // unknown entry date — don't trap the position forever
  return now - new Date(buyDate).getTime() >= minHoldDays * 86400000;
}

/** Re-entry cooldown: no re-buying a ticker within `cooldownDays` of last selling it. */
export function inCooldown(lastSellAt: string | null | undefined, cooldownDays: number, now = Date.now()): boolean {
  if (!lastSellAt) return false;
  return now - new Date(lastSellAt).getTime() < cooldownDays * 86400000;
}

/**
 * Trailing stop: exit when price falls `trailPct` (positive, e.g. 10) below the
 * highest price seen since entry. Replaces a fixed take-profit — winners run
 * until they actually roll over. Returns the exit reason or null.
 */
export function trailingStopHit(price: number, peak: number, trailPct: number): string | null {
  if (!(peak > 0) || !(price > 0)) return null;
  const stop = peak * (1 - trailPct / 100);
  return price <= stop ? `trailing stop (-${trailPct}% off peak ₱${peak.toFixed(2)})` : null;
}

/** Drawdown circuit breaker: halt new buys when equity is `haltPct` below its peak. */
export function drawdownHalted(equity: number, peakEquity: number, haltPct: number): boolean {
  if (!(peakEquity > 0)) return false;
  return equity <= peakEquity * (1 - haltPct / 100);
}
