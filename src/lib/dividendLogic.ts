// Pure dividend-tracker logic (no IO) — unit-tested in dividendLogic.test.ts.
//
// Entry philosophy (2026-07-02 research): dividend investors win by buying
// solid payers when the yield is fat and the price is washed out — NOT by
// chasing the single highest yield (often a value trap about to cut). The
// rating rewards high-but-sane yield, oversold RSI, a non-SELL AI verdict,
// and a soon upcoming record date; a SELL verdict is an automatic AVOID.

export interface DividendRow {
  amount: number;              // per share, PHP
  divType?: string | null;     // Regular | Special
  recordDate?: string | null;  // YYYY-MM-DD
  paymentDate?: string | null; // YYYY-MM-DD
  securityType?: string | null;
  announcedAt?: string | null; // disclosure announce time (dedup tiebreak)
  edgeNo?: string;             // PSE Edge id (carried through for the DCA bot)
}

// A re-filing of the same dividend usually moves the record date by a day or
// two, so exact-date matching misses it. Cluster same-amount+security filings
// whose record dates fall within this window; anchoring each cluster to its
// first date keeps genuinely separate payouts (e.g. a REIT's monthly ₱0.62,
// ~30 days apart) from being merged.
const DEDUP_WINDOW_DAYS = 5;

const asMs = (d: string) => Date.parse(d + 'T00:00:00+08:00');

/** Collapse disclosures describing the SAME dividend event — a company sometimes
 *  files the same dividend more than once (a re-file, or one not tagged [Amend]),
 *  which would otherwise double-count the yield. A single event = the same amount
 *  + security class with record dates within a few days. The most complete filing
 *  wins (a typed div_type over an untyped re-file, then the newest announcement).
 *  Rows without a record date can't be matched safely, so each is kept as-is. */
export function dedupeDividendEvents<T extends DividendRow>(rows: T[]): T[] {
  const kept: T[] = [];
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    if (!r.recordDate) { kept.push(r); continue; }
    const key = `${r.amount}|${r.securityType ?? ''}`;
    const g = groups.get(key);
    if (g) g.push(r); else groups.set(key, [r]);
  }

  // Within a cluster, prefer the typed filing, then the most recently announced.
  const better = (a: T, b: T): T => {
    const at = a.divType ? 1 : 0, bt = b.divType ? 1 : 0;
    if (at !== bt) return at > bt ? a : b;
    return (a.announcedAt ? Date.parse(a.announcedAt) : 0) >= (b.announcedAt ? Date.parse(b.announcedAt) : 0) ? a : b;
  };

  for (const group of groups.values()) {
    group.sort((x, y) => x.recordDate!.localeCompare(y.recordDate!));
    let rep = group[0];
    let anchorMs = asMs(group[0].recordDate!);
    for (let i = 1; i < group.length; i++) {
      const r = group[i];
      if (asMs(r.recordDate!) - anchorMs <= DEDUP_WINDOW_DAYS * 86400_000) {
        rep = better(rep, r);
      } else {
        kept.push(rep);
        rep = r;
        anchorMs = asMs(r.recordDate!);
      }
    }
    kept.push(rep);
  }
  return kept;
}

/** Sum of per-share dividends whose record date falls in the trailing 12 months.
 *  Rows without a record date fall back to payment date; neither -> excluded. */
export function ttmDividendPerShare(rows: DividendRow[], now = new Date()): number {
  const end = now.getTime();
  const start = end - 365 * 86400_000;
  let sum = 0;
  for (const r of rows) {
    const anchor = r.recordDate ?? r.paymentDate;
    if (!anchor || !(r.amount > 0)) continue;
    const t = new Date(anchor + 'T00:00:00+08:00').getTime();
    if (t > start && t <= end) sum += r.amount;
  }
  return sum;
}

/** The next dividend whose record date is still in the future (buy before the
 *  ex-date to receive it). Returns the soonest one. */
export function nextUpcomingDividend(rows: DividendRow[], now = new Date()): DividendRow | null {
  const today = now.getTime();
  const upcoming = rows
    .filter((r) => r.recordDate && new Date(r.recordDate + 'T00:00:00+08:00').getTime() > today && r.amount > 0)
    .sort((a, b) => a.recordDate!.localeCompare(b.recordDate!));
  return upcoming[0] ?? null;
}

export type EntryRating = 'STRONG ENTRY' | 'GOOD ENTRY' | 'WAIT' | 'AVOID';

export interface EntryInput {
  yieldPct: number;                 // TTM yield at current price, %
  verdict?: string | null;          // cached AI verdict, if any
  aboveSma200?: boolean | null;
  rsi14?: number | null;
  nextRecordDate?: string | null;   // YYYY-MM-DD
  minYieldPct?: number;             // floor to be considered at all (default 4)
  now?: Date;
}

export interface EntryResult {
  rating: EntryRating;
  score: number;
  reasons: string[];
}

/** Score how attractive an entry looks RIGHT NOW for a dividend stock. */
export function entryRating(inp: EntryInput): EntryResult {
  const minYield = inp.minYieldPct ?? 4;
  const reasons: string[] = [];

  if (inp.verdict === 'SELL') {
    return { rating: 'AVOID', score: 0, reasons: ['AI signal is SELL — high yield may be a value trap (falling price inflates yield)'] };
  }
  if (!(inp.yieldPct >= minYield)) {
    return { rating: 'WAIT', score: 0, reasons: [`Yield ${inp.yieldPct.toFixed(1)}% is below the ${minYield}% threshold`] };
  }

  let score = 0;
  if (inp.yieldPct >= 6) { score += 2; reasons.push(`Fat yield ${inp.yieldPct.toFixed(1)}%`); }
  else { score += 1; reasons.push(`Solid yield ${inp.yieldPct.toFixed(1)}%`); }

  if (inp.rsi14 != null) {
    if (inp.rsi14 <= 40) { score += 2; reasons.push(`Oversold (RSI ${inp.rsi14.toFixed(0)}) — cheaper entry`); }
    else if (inp.rsi14 <= 50) { score += 1; reasons.push(`Not overbought (RSI ${inp.rsi14.toFixed(0)})`); }
    else if (inp.rsi14 >= 70) { score -= 1; reasons.push(`Overbought (RSI ${inp.rsi14.toFixed(0)}) — entry is expensive`); }
  }

  if (inp.verdict === 'BUY') { score += 1; reasons.push('AI signal is BUY'); }
  if (inp.aboveSma200 === true) { score += 1; reasons.push('Price above 200-day average (uptrend intact)'); }
  else if (inp.aboveSma200 === false) reasons.push('Below 200-day average — downtrend, average down carefully');

  if (inp.nextRecordDate) {
    const days = (new Date(inp.nextRecordDate + 'T00:00:00+08:00').getTime() - (inp.now ?? new Date()).getTime()) / 86400_000;
    if (days > 1 && days <= 30) { score += 1; reasons.push(`Record date ${inp.nextRecordDate} is near — buy before the ex-date to catch this payout`); }
  }

  const rating: EntryRating = score >= 5 ? 'STRONG ENTRY' : score >= 3 ? 'GOOD ENTRY' : 'WAIT';
  return { rating, score, reasons };
}
