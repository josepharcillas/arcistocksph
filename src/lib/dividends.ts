// Dividend tracker: rank PSE stocks by trailing-12-month cash-dividend yield
// (from the scraped `dividends` table) and rate whether NOW looks like a good
// entry (yield + RSI + AI verdict + trend + upcoming record date).
import { createSupabaseAdmin } from './supabase-admin';
import { fetchAllQuotes } from './market';
import { ttmDividendPerShare, nextUpcomingDividend, entryRating, dedupeDividendEvents, type EntryResult, type DividendRow } from './dividendLogic';

export interface DividendYieldRow {
  ticker: string;
  companyName: string | null;
  price: number;
  ttmDps: number;        // ₱ per share over trailing 12 months (common shares)
  yieldPct: number;
  payments: number;      // count of dividend events in the TTM window
  lastAmount: number | null;
  nextRecordDate: string | null;
  nextPaymentDate: string | null;
  nextAmount: number | null;
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

export async function getDividendBoard(limit = 50): Promise<DividendBoard> {
  const admin = createSupabaseAdmin();
  const since = new Date(Date.now() - 400 * 86400_000).toISOString().slice(0, 10);

  // COMMON-share dividends only (a preferred payout per preferred share must not
  // be divided by the COMMON price). Rows with an unparsed security type are
  // rare and skipped rather than guessed.
  const [{ data: divRows }, quotes] = await Promise.all([
    admin.from('dividends')
      .select('ticker, company_name, amount, div_type, security_type, record_date, payment_date, announced_at')
      .eq('security_type', 'COMMON')
      .gte('record_date', since),
    fetchAllQuotes(),
  ]);

  const byTicker = new Map<string, { name: string | null; rows: DividendRow[] }>();
  for (const r of (divRows ?? []) as any[]) {
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
  const { data: sigRows } = tickers.length
    ? await admin.from('signal_cache').select('ticker, verdict, confidence, rsi14, above_sma200').in('ticker', tickers)
    : { data: [] as any[] };
  const signals = new Map((sigRows ?? []).map((s: any) => [s.ticker as string, s]));

  const now = new Date();
  const rows: DividendYieldRow[] = [];
  for (const [ticker, e] of byTicker) {
    const quote = quotes.get(ticker);
    const price = quote?.price ?? 0;
    if (!(price > 0)) continue; // suspended / not quoted today

    const ttmDps = ttmDividendPerShare(e.rows, now);
    if (!(ttmDps > 0)) continue;
    const yieldPct = (ttmDps / price) * 100;

    const next = nextUpcomingDividend(e.rows, now);
    const sig = signals.get(ticker);
    const past = e.rows
      .filter((r) => r.recordDate && new Date(r.recordDate) <= now)
      .sort((a, b) => b.recordDate!.localeCompare(a.recordDate!));

    rows.push({
      ticker,
      companyName: e.name ?? quote?.name ?? null,
      price,
      ttmDps,
      yieldPct,
      payments: e.rows.filter((r) => {
        const anchor = r.recordDate ?? r.paymentDate;
        return anchor && new Date(anchor) <= now && Date.now() - new Date(anchor).getTime() < 365 * 86400_000;
      }).length,
      lastAmount: past[0]?.amount ?? null,
      nextRecordDate: next?.recordDate ?? null,
      nextPaymentDate: next?.paymentDate ?? null,
      nextAmount: next?.amount ?? null,
      verdict: sig?.verdict ?? null,
      confidence: sig?.confidence ?? null,
      rsi14: sig?.rsi14 != null ? Number(sig.rsi14) : null,
      aboveSma200: sig?.above_sma200 ?? null,
      entry: entryRating({
        yieldPct,
        verdict: sig?.verdict ?? null,
        aboveSma200: sig?.above_sma200 ?? null,
        rsi14: sig?.rsi14 != null ? Number(sig.rsi14) : null,
        nextRecordDate: next?.recordDate ?? null,
        minYieldPct: MIN_YIELD,
        now,
      }),
    });
  }

  rows.sort((a, b) => b.yieldPct - a.yieldPct);
  return { ok: true, asOf: now.toISOString(), coveredTickers: rows.length, rows: rows.slice(0, limit) };
}
