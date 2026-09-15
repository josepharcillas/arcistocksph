// Dividend tracker: rank PSE stocks by trailing-12-month cash-dividend yield
// (from the scraped `dividends` table) and rate whether NOW looks like a good
// entry (yield + RSI + AI verdict + trend + upcoming record date).
import { query } from './db';
import { fetchAllQuotes } from './market';
import { ttmDividendPerShare, nextUpcomingDividend, entryRating, dedupeDividendEvents, type EntryResult, type DividendRow } from './dividendLogic';

export interface DividendEvent {
  amount: number;            // ₱ per share
  divType: string | null;    // Regular | Special | null
  recordDate: string | null;
  paymentDate: string | null;
  isUpcoming: boolean;       // record date still in the future
}

export interface DividendYieldRow {
  ticker: string;
  companyName: string | null;
  price: number;
  ttmDps: number;            // ₱ per share over trailing 12 months (common shares, all types)
  yieldPct: number;          // total TTM yield
  regularTtmDps: number;     // ₱/share from Regular dividends only (recurring)
  regularYieldPct: number;   // recurring yield — the sustainable number to rank on
  specialYieldPct: number;   // yield from one-off Special dividends
  volume: number;            // shares traded today (0 = no trades today — inactive)
  turnover: number;          // ₱ value traded today (price × volume)
  turnover20d: number | null;// median daily ₱ turnover over ~20 sessions (stable liquidity)
  payments: number;          // count of dividend events in the TTM window
  totalEvents: number;       // count of all known events (incl. upcoming)
  lastAmount: number | null;
  nextRecordDate: string | null;
  nextPaymentDate: string | null;
  nextAmount: number | null;
  history: DividendEvent[];  // all events, newest-first, for the expandable detail
  verdict: string | null;
  confidence: string | null;
  rsi14: number | null;
  aboveSma200: boolean | null;
  entry: EntryResult;
}

export interface DividendBoard {
  ok: true;
  asOf: string;
  coveredTickers: number;
  rows: DividendYieldRow[];
}

const MIN_YIELD = Number(process.env.DIVIDEND_MIN_YIELD ?? 4); // % — entry threshold
const STOCK_MIN_TURNOVER = Number(process.env.STOCK_MIN_TURNOVER ?? 5_000_000); // ₱/day liquidity floor

export async function getDividendBoard(limit = 50): Promise<DividendBoard> {
  const since = new Date(Date.now() - 400 * 86400_000).toISOString().slice(0, 10);

  // COMMON-share dividends only (a preferred payout per preferred share must not
  // be divided by the COMMON price). Rows with an unparsed security type are
  // rare and skipped rather than guessed.
  const [divRows, quotes] = await Promise.all([
    query<any>(
      `select ticker, company_name, amount, div_type, security_type, record_date, payment_date, announced_at
         from dividends where security_type = 'COMMON' and record_date >= $1`,
      [since]
    ),
    fetchAllQuotes(),
  ]);

  const byTicker = new Map<string, { name: string | null; rows: DividendRow[] }>();
  for (const r of divRows) {
    const t = r.ticker as string;
    const e = byTicker.get(t) ?? { name: r.company_name ?? null, rows: [] as DividendRow[] };
    e.rows.push({
      amount: Number(r.amount), divType: r.div_type, securityType: r.security_type,
      recordDate: r.record_date, paymentDate: r.payment_date, announcedAt: r.announced_at,
    });
    byTicker.set(t, e);
  }
  // Collapse duplicate filings of the same dividend so yields aren't doubled.
  for (const e of byTicker.values()) e.rows = dedupeDividendEvents(e.rows);

  // One query for all cached signals on dividend payers.
  const tickers = [...byTicker.keys()];
  const sigRows = tickers.length
    ? await query<any>(`select ticker, verdict, confidence, rsi14, above_sma200, turnover20d from signal_cache where ticker = any($1::text[])`, [tickers])
    : [];
  const signals = new Map(sigRows.map((s: any) => [s.ticker as string, s]));

  const now = new Date();
  const rows: DividendYieldRow[] = [];
  for (const [ticker, e] of byTicker) {
    const quote = quotes.get(ticker);
    const price = quote?.price ?? 0;
    if (!(price > 0)) continue; // suspended / not quoted today

    const ttmDps = ttmDividendPerShare(e.rows, now);
    if (!(ttmDps > 0)) continue;
    const yieldPct = (ttmDps / price) * 100;

    // Recurring vs one-off: only Regular payouts are the sustainable yield.
    // Anything not explicitly Special counts as regular (most disclosures are).
    const regularRows = e.rows.filter((r) => r.divType !== 'Special');
    const regularTtmDps = ttmDividendPerShare(regularRows, now);
    const regularYieldPct = (regularTtmDps / price) * 100;
    const specialYieldPct = Math.max(0, yieldPct - regularYieldPct);

    const next = nextUpcomingDividend(e.rows, now);
    const sig = signals.get(ticker) as any;
    const past = e.rows
      .filter((r) => r.recordDate && new Date(r.recordDate) <= now)
      .sort((a, b) => b.recordDate!.localeCompare(a.recordDate!));

    // Full event history, newest-first, for the expandable detail.
    const history: DividendEvent[] = e.rows
      .map((r) => ({
        amount: r.amount, divType: r.divType ?? null,
        recordDate: r.recordDate ?? null, paymentDate: r.paymentDate ?? null,
        isUpcoming: !!r.recordDate && new Date(r.recordDate + 'T00:00:00+08:00') > now,
      }))
      .sort((a, b) => (b.recordDate ?? b.paymentDate ?? '').localeCompare(a.recordDate ?? a.paymentDate ?? ''));

    rows.push({
      ticker,
      companyName: e.name ?? quote?.name ?? null,
      price,
      ttmDps,
      yieldPct,
      regularTtmDps,
      regularYieldPct,
      specialYieldPct,
      volume: quote?.volume ?? 0,
      turnover: price * (quote?.volume ?? 0),
      turnover20d: sig?.turnover20d != null ? Number(sig.turnover20d) : null,
      payments: e.rows.filter((r) => {
        const anchor = r.recordDate ?? r.paymentDate;
        return anchor && new Date(anchor) <= now && Date.now() - new Date(anchor).getTime() < 365 * 86400_000;
      }).length,
      totalEvents: e.rows.length,
      lastAmount: past[0]?.amount ?? null,
      nextRecordDate: next?.recordDate ?? null,
      nextPaymentDate: next?.paymentDate ?? null,
      nextAmount: next?.amount ?? null,
      history,
      verdict: sig?.verdict ?? null,
      confidence: sig?.confidence ?? null,
      rsi14: sig?.rsi14 != null ? Number(sig.rsi14) : null,
      aboveSma200: sig?.above_sma200 ?? null,
      // Entry rating uses the RECURRING yield so a fat one-off special can't
      // dress up a value trap as a strong entry.
      entry: entryRating({
        yieldPct: regularYieldPct,
        verdict: sig?.verdict ?? null,
        aboveSma200: sig?.above_sma200 ?? null,
        rsi14: sig?.rsi14 != null ? Number(sig.rsi14) : null,
        nextRecordDate: next?.recordDate ?? null,
        minYieldPct: MIN_YIELD,
        now,
      }),
    });
  }

  // Rank by liquidity TIER first, then recurring yield. A 14% yield you can't
  // trade (₱0 volume) is worthless to a real investor, so liquid names surface
  // above thin ones instead of raw yield dangling untradeable junk at the top.
  //   3 = liquid (≥ floor) · 2 = thin · 1 = very thin · 0 = no trades today
  const liqTier = (r: DividendYieldRow): number => {
    if (!(r.volume > 0)) return 0;
    const m = r.turnover20d ?? r.turnover;
    return m >= STOCK_MIN_TURNOVER ? 3 : m >= 1_000_000 ? 2 : 1;
  };
  rows.sort((a, b) =>
    liqTier(b) - liqTier(a) || b.regularYieldPct - a.regularYieldPct || b.yieldPct - a.yieldPct);
  return { ok: true, asOf: now.toISOString(), coveredTickers: rows.length, rows: rows.slice(0, limit) };
}
