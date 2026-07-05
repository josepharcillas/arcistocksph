import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { computeAdvice, DEFAULT_ADVISOR_CONFIG, type AdvisorPosition, type Confidence, type Verdict } from '../../lib/advisor';
import { SkeletonCard } from '../ui/Skeleton';

// "What to buy now" — turns the raw BUY signals into concrete, sized actions:
// which stocks, how many shares, for how much. Uses the same risk-managed
// computeAdvice() as the Advisor, but works standalone (no holdings needed):
// the whole liquid market's fresh BUY candidates sized to a budget you set.

const peso = (n: number) => `₱${n.toLocaleString('en-PH', { maximumFractionDigits: 0 })}`;

interface Candidate { ticker: string; verdict: string; confidence: string | null; stopLoss: number | null }
interface Quote { symbol: string; name?: string; price: number }

export default function BuyIdeas() {
  const [candidates, setCandidates] = useState<AdvisorPosition[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [budget, setBudget] = useState(10000);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true); setError('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const [oppRes, quotes, cashRow] = await Promise.all([
        fetch('/api/advisor/opportunities').then((r) => (r.ok ? r.json() : { candidates: [] })).catch(() => ({ candidates: [] })),
        fetch('/api/stocks').then((r) => (r.ok ? r.json() : [])).catch(() => []),
        user ? supabase.from('portfolio_cash').select('cash').eq('user_id', user.id).maybeSingle() : Promise.resolve({ data: null }),
      ]);

      const priceMap: Record<string, number> = {};
      const nameMap: Record<string, string> = {};
      if (Array.isArray(quotes)) for (const q of quotes as Quote[]) { priceMap[q.symbol] = q.price; if (q.name) nameMap[q.symbol] = q.name; }
      setNames(nameMap);

      const cands: AdvisorPosition[] = ((oppRes?.candidates ?? []) as Candidate[])
        .map((c) => ({
          ticker: c.ticker, shares: 0, avgCost: 0, price: priceMap[c.ticker] ?? 0,
          verdict: c.verdict as Verdict, confidence: c.confidence as Confidence, stopLoss: c.stopLoss, isNew: true,
        }))
        .filter((c) => c.price > 0);
      setCandidates(cands);

      const cash = (cashRow as any)?.data ? Number((cashRow as any).data.cash) : 0;
      if (cash > 0) setBudget(cash);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load buy ideas.');
    } finally {
      setLoading(false);
    }
  }

  const advice = useMemo(
    () => computeAdvice(candidates, budget || 0, { ...DEFAULT_ADVISOR_CONFIG, sizing: 'risk' }),
    [candidates, budget],
  );
  const buys = advice.actions.filter((a) => a.kind === 'BUY');
  const deployed = buys.reduce((s, a) => s + (a.pesos ?? 0), 0);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-6">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-lg font-semibold">💡 What to buy now</h2>
          <p className="text-slate-400 text-xs mt-0.5">
            Concrete, sized picks from the whole liquid market — fresh BUY signal, MEDIUM+ confidence, uptrend, liquid.
          </p>
        </div>
        <label className="text-xs text-slate-400 shrink-0 text-right">
          Budget
          <div className="flex items-center gap-1 mt-1">
            <span className="text-slate-500">₱</span>
            <input
              type="number" min="0" step="1000" value={budget}
              onChange={(e) => setBudget(Math.max(0, Number(e.target.value)))}
              className="w-28 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-right text-white tabular-nums"
            />
          </div>
        </label>
      </div>

      {loading && <SkeletonCard />}
      {error && <p className="text-red-400 text-sm">{error}</p>}

      {!loading && !error && candidates.length === 0 && (
        <p className="text-slate-400 text-sm">
          No stock currently clears the buy filters (a fresh BUY signal that's MEDIUM+ confidence, above its 200-day
          trend, and liquid enough to trade). Nothing to buy right now is a valid answer — check back after the next
          signal refresh.
        </p>
      )}

      {!loading && !error && candidates.length > 0 && (
        <>
          <div className="space-y-2">
            {buys.map((a, i) => (
              <div key={i} className="border border-green-500/40 bg-green-500/5 rounded-lg p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-green-400">BUY</span>
                  <a href={`/stock/${a.ticker}`} className="text-white font-bold hover:text-green-400">{a.ticker}</a>
                  {a.ticker && names[a.ticker] && <span className="text-slate-500 text-xs truncate max-w-[160px]">{names[a.ticker]}</span>}
                  <span className="ml-auto text-white font-semibold text-sm tabular-nums">{a.shares} sh · {peso(a.pesos ?? 0)}</span>
                </div>
                <p className="text-slate-300 text-xs mt-1">{a.reason}</p>
              </div>
            ))}
          </div>

          {buys.length > 0 ? (
            <p className="text-slate-500 text-xs mt-3">
              Deploys <span className="text-slate-300">{peso(deployed)}</span> of your {peso(budget)} across {buys.length} name{buys.length === 1 ? '' : 's'};
              keeps <span className="text-slate-300">{peso(Math.max(0, budget - deployed))}</span> in cash. Each sized to risk ~2% of the budget to its stop, capped at {DEFAULT_ADVISOR_CONFIG.maxWeightPct}% per name.
            </p>
          ) : (
            <p className="text-slate-400 text-sm">
              {candidates.length} stock{candidates.length === 1 ? '' : 's'} have a BUY signal, but your ₱{budget.toLocaleString('en-PH')} budget can't size a full position in any of them. Increase the budget above.
            </p>
          )}
        </>
      )}

      <p className="text-slate-600 text-[11px] mt-3">
        Sizing is risk-managed, not a prediction — you place any trades yourself. Prices may be delayed/EOD. Not financial advice.
      </p>
    </div>
  );
}
