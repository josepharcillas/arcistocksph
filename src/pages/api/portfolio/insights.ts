import type { APIRoute } from 'astro';
import { createSupabaseAdmin } from '../../../lib/supabase-admin';
import { fetchAllQuotes } from '../../../lib/market';
import { computeAdvice, DEFAULT_ADVISOR_CONFIG, type AdvisorPosition } from '../../../lib/advisor';
import { ttmDividendPerShare, nextUpcomingDividend, dedupeDividendEvents, type DividendRow } from '../../../lib/dividendLogic';
import { analyzePortfolio, type NarrativePosition } from '../../../lib/ai/portfolioNarrative';

// Portfolio-level AI analysis for the Portfolio page: runs the existing risk model
// (computeAdvice — unchanged, so the advisor-alerts cron/bots are untouched) over
// the user's real holdings + cash, enriches each position with dividend context,
// and generates a plain-English narrative. Held positions only — this is a read of
// YOUR book, not the market-scan opportunity list on /dashboard/advisor.

interface Body { holdings?: { ticker: string; qty: number; buy_price: number }[]; cash?: number }

// The narrative is the only expensive part (an AI call). Cache it briefly, keyed
// by the exact book + cash, so re-renders and quick revisits don't re-bill.
const narrativeCache = new Map<string, { summary: string; provider: string; at: number }>();
const NARRATIVE_TTL_MS = 10 * 60 * 1000;
const NARRATIVE_CACHE_MAX = 500;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as Body;
    const holdings = Array.isArray(body.holdings) ? body.holdings : [];
    const cash = Number.isFinite(Number(body.cash)) ? Math.max(0, Number(body.cash)) : 0;

    if (holdings.length === 0) {
      return json({ ok: true, empty: true, narrative: null, actions: [], positions: [], equity: cash, cash });
    }

    const tickers = [...new Set(holdings.map((h) => h.ticker))];
    const admin = createSupabaseAdmin();

    const [quotes, { data: sigRows }, { data: divRows }] = await Promise.all([
      fetchAllQuotes(),
      admin.from('signal_cache').select('ticker, verdict, confidence, stop_loss, rsi14, above_sma200').in('ticker', tickers),
      admin.from('dividends')
        .select('ticker, amount, div_type, security_type, record_date, payment_date, announced_at')
        .eq('security_type', 'COMMON').in('ticker', tickers),
    ]);

    const signals = new Map((sigRows ?? []).map((s: any) => [s.ticker as string, s]));

    // Recurring dividend yield + next record date per held ticker.
    const divByTicker = new Map<string, DividendRow[]>();
    for (const r of (divRows ?? []) as any[]) {
      const arr = divByTicker.get(r.ticker) ?? [];
      arr.push({ amount: Number(r.amount), divType: r.div_type, securityType: r.security_type,
        recordDate: r.record_date, paymentDate: r.payment_date, announcedAt: r.announced_at });
      divByTicker.set(r.ticker, arr);
    }
    const now = new Date();
    const divContext = new Map<string, { yieldPct: number | null; nextRecordDate: string | null }>();
    for (const t of tickers) {
      const rows = divByTicker.get(t);
      const price = quotes.get(t)?.price ?? 0;
      if (!rows || !(price > 0)) { divContext.set(t, { yieldPct: null, nextRecordDate: null }); continue; }
      const deduped = dedupeDividendEvents(rows);
      // Recurring (non-Special) yield — a one-off special shouldn't inflate income.
      const regularTtm = ttmDividendPerShare(deduped.filter((r) => r.divType !== 'Special'), now);
      const next = nextUpcomingDividend(deduped, now);
      divContext.set(t, {
        yieldPct: regularTtm > 0 ? (regularTtm / price) * 100 : null,
        nextRecordDate: next?.recordDate ?? null,
      });
    }

    // Build advisor positions from real holdings (consolidate duplicate tickers).
    const byTicker = new Map<string, { qty: number; cost: number }>();
    for (const h of holdings) {
      const e = byTicker.get(h.ticker) ?? { qty: 0, cost: 0 };
      e.qty += Number(h.qty); e.cost += Number(h.qty) * Number(h.buy_price);
      byTicker.set(h.ticker, e);
    }
    const positions: AdvisorPosition[] = [...byTicker.entries()].map(([ticker, agg]) => {
      const sig = signals.get(ticker);
      const avgCost = agg.qty > 0 ? agg.cost / agg.qty : 0;
      return {
        ticker, shares: agg.qty, avgCost,
        price: quotes.get(ticker)?.price ?? avgCost,
        verdict: sig?.verdict ?? null, confidence: sig?.confidence ?? null,
        stopLoss: sig?.stop_loss != null ? Number(sig.stop_loss) : null,
      };
    });

    const advice = computeAdvice(positions, cash, { ...DEFAULT_ADVISOR_CONFIG, sizing: 'risk' });

    // Merge dividend context into the position views for the narrative + UI.
    const narrativePositions: NarrativePosition[] = advice.positions
      .filter((p) => p.isHolding)
      .map((p) => ({
        ticker: p.ticker, weightPct: p.weightPct, pnlPct: p.pnlPct, verdict: p.verdict,
        yieldPct: divContext.get(p.ticker)?.yieldPct ?? null,
        nextRecordDate: divContext.get(p.ticker)?.nextRecordDate ?? null,
      }));

    // Narrative (cached by exact book + cash).
    const key = JSON.stringify({ p: narrativePositions.map((p) => [p.ticker, p.weightPct.toFixed(1), p.pnlPct.toFixed(1), p.verdict]), c: Math.round(cash) });
    let narrative = narrativeCache.get(key);
    if (!narrative || Date.now() - narrative.at > NARRATIVE_TTL_MS) {
      const result = await analyzePortfolio({ equity: advice.equity, cash: advice.cash, positions: narrativePositions, actions: advice.actions });
      narrative = { summary: result.summary, provider: result.provider, at: Date.now() };
      // Bound the cache so a long-running server can't grow it without limit
      // (each distinct book+cash makes a new key). Drop the oldest insert.
      if (narrativeCache.size >= NARRATIVE_CACHE_MAX) narrativeCache.delete(narrativeCache.keys().next().value!);
      narrativeCache.set(key, narrative);
    }

    return json({
      ok: true,
      empty: false,
      narrative: narrative.summary,
      provider: narrative.provider,
      equity: advice.equity,
      cash: advice.cash,
      actions: advice.actions,
      positions: narrativePositions,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
