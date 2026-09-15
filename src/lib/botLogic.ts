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

// ── Liquidity + scan-allocation (2026-07-04 panel: floor money decisions on
// liquidity, spend the scan budget on active names, keep a random control arm) ──

/**
 * Typical daily peso turnover: median of the positive values in the last
 * `window` sessions. Median, not mean or single-day — one block trade shouldn't
 * qualify a dead stock, and a halt day (0) shouldn't disqualify a liquid one.
 * Null when there's no usable data (never traded / no history).
 */
export function medianTurnover(dayValues: number[], window = 20): number | null {
  const recent = dayValues.slice(-window).filter((v) => v > 0);
  if (recent.length === 0) return null;
  const sorted = [...recent].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Does a ticker clear the liquidity floor for MONEY decisions (bot buys,
 * advisor suggestions)? Strict like the SMA filter: unknown turnover = no.
 * A floor of 0 disables the check (crypto — CoinGecko universe is pre-floored).
 */
export function aboveTurnoverFloor(turnover: number | null | undefined, floor: number): boolean {
  if (floor <= 0) return true;
  return turnover != null && turnover >= floor;
}

/**
 * Sample `k` items without replacement, probability proportional to weight.
 * Zero/negative-weight items are never picked. `rand` injectable for tests.
 */
export function weightedSample<T>(
  items: T[], weightOf: (t: T) => number, k: number, rand: () => number = Math.random,
): T[] {
  const pool = items.filter((t) => weightOf(t) > 0);
  const picked: T[] = [];
  while (picked.length < k && pool.length > 0) {
    let total = 0;
    for (const t of pool) total += weightOf(t);
    let roll = rand() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      roll -= weightOf(pool[i]);
      if (roll <= 0) { idx = i; break; }
    }
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked;
}

/**
 * Split a discovery batch into two measurable arms:
 *  - CONTROL: uniform-random from the WHOLE pool (including below-floor names) —
 *    the unbiased sample the accuracy tracker needs, and the audit that keeps
 *    "thin names have bad signals" a tested claim instead of a self-sealing one.
 *  - WEIGHTED: probability ∝ day turnover, above-floor names only — the scan
 *    budget goes where the market is actually trading.
 * Below-floor names can be SCANNED (control) but the buy gate still blocks them.
 */
export function pickDiscoveryBatch<T>(
  pool: T[], turnoverOf: (t: T) => number, batchSize: number, floor: number,
  controlFraction = 0.2, rand: () => number = Math.random,
): { weighted: T[]; control: T[] } {
  if (batchSize <= 0 || pool.length === 0) return { weighted: [], control: [] };
  const controlK = Math.max(1, Math.round(batchSize * controlFraction));
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) { // Fisher–Yates
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const control = shuffled.slice(0, Math.min(controlK, batchSize));
  const controlSet = new Set(control);
  const eligible = pool.filter((t) => !controlSet.has(t) && (floor <= 0 || turnoverOf(t) >= floor));
  const weighted = weightedSample(eligible, turnoverOf, batchSize - control.length, rand);
  // Top up uniformly when weights can't fill the batch (no turnover data — e.g.
  // the crypto universe, or a holiday snapshot where every volume reads 0).
  // Still floor-respecting: the top-up draws from the same eligible list.
  if (weighted.length + control.length < batchSize) {
    const taken = new Set([...control, ...weighted]);
    for (const t of shuffled) {
      if (weighted.length + control.length >= batchSize) break;
      if (!taken.has(t) && (floor <= 0 || turnoverOf(t) >= floor)) { weighted.push(t); taken.add(t); }
    }
  }
  return { weighted, control };
}
