import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { SkeletonCard } from '../ui/Skeleton';
import { computeAdvice, DEFAULT_ADVISOR_CONFIG, type AdvisorPosition } from '../../lib/advisor';
import { actionStyle, actionColor, actionLabel } from './actionStyles';

interface Holding { ticker: string; qty: number; buy_price: number }

const peso = (n: number) => `₱${n.toLocaleString('en-PH', { maximumFractionDigits: 0 })}`;

export default function Advisor() {
  const [positions, setPositions] = useState<AdvisorPosition[]>([]);
  const [realCash, setRealCash] = useState(0);      // actual portfolio cash
  const [budget, setBudget] = useState(10000);      // cash used for sizing (planning budget when you have none set)
  const [hasHoldings, setHasHoldings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError('Sign in to see your advisor.'); setLoading(false); return; }

      const [{ data: holdings }, { data: cashRow }, { data: watch }, quoteRes, oppRes] = await Promise.all([
        supabase.from('holdings').select('ticker, qty, buy_price'),
        supabase.from('portfolio_cash').select('cash').eq('user_id', user.id).maybeSingle(),
        supabase.from('watchlist').select('ticker'),
        fetch('/api/stocks').then((r) => r.json()).catch(() => []),
        fetch('/api/advisor/opportunities').then((r) => (r.ok ? r.json() : { candidates: [] })).catch(() => ({ candidates: [] })),
      ]);

      const cashVal = cashRow ? Number(cashRow.cash) : 0;
      setRealCash(cashVal);

      const priceMap: Record<string, number> = {};
      if (Array.isArray(quoteRes)) for (const q of quoteRes) priceMap[q.symbol] = q.price;

      const hs = (holdings ?? []) as Holding[];
      setHasHoldings(hs.length > 0);
      const held = new Set(hs.map((h) => h.ticker));
      // Watchlist tickers not already held become zero-share buy candidates.
      const watchTickers = [...new Set(((watch ?? []) as { ticker: string }[]).map((w) => w.ticker))].filter((t) => !held.has(t));

      // Fetch the signal (verdict + confidence + stop-loss) for each ticker; cached
      // server-side, and degrades gracefully on failure/rate-limit.
      const signalFor = async (ticker: string) => {
        try {
          const sig = await fetch('/api/analyze', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker }),
          }).then((r) => (r.ok ? r.json() : null));
          if (sig && !sig.error) return { verdict: sig.verdict, confidence: sig.confidence, stopLoss: sig.stopLoss ?? null };
        } catch { /* fall through */ }
        return { verdict: null, confidence: null, stopLoss: null };
      };

      const heldPositions: AdvisorPosition[] = await Promise.all(hs.map(async (h) => ({
        ticker: h.ticker, shares: Number(h.qty), avgCost: Number(h.buy_price),
        price: priceMap[h.ticker] ?? Number(h.buy_price), ...(await signalFor(h.ticker)),
      })));
      const watchPositions: AdvisorPosition[] = await Promise.all(watchTickers.map(async (t) => ({
        ticker: t, shares: 0, avgCost: 0, price: priceMap[t] ?? 0, ...(await signalFor(t)),
      }))).then((ps) => ps.filter((p) => p.price > 0)); // skip unknown-price candidates

      // Market-scan opportunities: fresh cached BUYs from the whole liquid market,
      // quality-gated server-side. Cache-only (no extra AI calls). With an empty
      // portfolio, show a fuller buy list (matches the Signals "What to buy now"
      // panel); with real holdings, stay focused on the top 2 new entries.
      const watchSet = new Set(watchTickers);
      const oppLimit = held.size === 0 ? 8 : 2;
      const oppPositions: AdvisorPosition[] = ((oppRes?.candidates ?? []) as any[])
        .filter((c) => !held.has(c.ticker) && !watchSet.has(c.ticker) && (priceMap[c.ticker] ?? 0) > 0)
        .slice(0, oppLimit)
        .map((c) => ({
          ticker: c.ticker, shares: 0, avgCost: 0, price: priceMap[c.ticker],
          verdict: c.verdict, confidence: c.confidence, stopLoss: c.stopLoss ?? null, isNew: true,
        }));

      setPositions([...heldPositions, ...watchPositions, ...oppPositions]);
      // Size against real cash when you have it; otherwise a ₱10k planning budget
      // you can edit — so the advisor still tells you what to buy from zero.
      setBudget(cashVal > 0 ? cashVal : 10000);
      setLoadedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build your advice.');
    } finally {
      setLoading(false);
    }
  }

  const advice = useMemo(
    () => computeAdvice(positions, budget || 0, { ...DEFAULT_ADVISOR_CONFIG, sizing: 'risk' }),
    [positions, budget],
  );
  const planning = !hasHoldings && realCash <= 0; // no real portfolio → budget is hypothetical

  if (loading) return <div className="space-y-3">{[1, 2].map((i) => <SkeletonCard key={i} />)}</div>;
  if (error) return <div className="bg-red-400/10 border border-red-400/30 rounded-xl p-4 text-red-300 text-sm">{error}</div>;

  if (positions.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
        <p className="text-slate-400 mb-1">Nothing to advise on right now.</p>
        <p className="text-slate-500 text-sm">No holdings, and no stock currently has a fresh BUY signal that clears the quality gates. Add holdings on the Portfolio page, or check back after the next signal refresh.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {planning && (
        <p className="text-xs text-slate-400 bg-slate-800/40 border border-slate-700 rounded-lg px-3 py-2">
          You have no holdings or cash set yet, so this is a <strong className="text-slate-200">planning budget</strong> —
          adjust it to see what to buy and how much. Set your real cash on the Portfolio page for portfolio-aware advice.
        </p>
      )}

      {/* Snapshot */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-slate-400 text-xs">Account equity</p>
          <p className="text-white text-lg font-bold">{peso(advice.equity)}</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-slate-400 text-xs">{planning ? 'Planning budget' : 'Cash to deploy'}</p>
          {planning ? (
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-slate-500">₱</span>
              <input
                type="number" min="0" step="1000" value={budget}
                onChange={(e) => setBudget(Math.max(0, Number(e.target.value)))}
                className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-white text-lg font-bold tabular-nums"
              />
            </div>
          ) : (
            <p className="text-white text-lg font-bold">{peso(advice.cash)}</p>
          )}
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-slate-400 text-xs">Concentration cap</p>
          <p className="text-white text-lg font-bold">{DEFAULT_ADVISOR_CONFIG.maxWeightPct}%</p>
        </div>
      </div>

      {loadedAt && (
        <p className="text-slate-600 text-[11px] -mt-2">Data as of {loadedAt.toLocaleTimeString()} · prices may be delayed/EOD</p>
      )}

      {/* Recommended actions */}
      <div>
        <h2 className="text-lg font-semibold mb-2">Recommended actions</h2>
        <div className="space-y-2">
          {advice.actions.map((a, i) => (
            <div key={i} className={`border rounded-xl p-4 ${actionStyle[a.kind]}`}>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold ${actionColor[a.kind]}`}>{actionLabel[a.kind]}</span>
                {a.ticker && <span className="text-white font-bold">{a.ticker}</span>}
                {a.shares != null && <span className="text-slate-400 text-xs">{a.shares} sh</span>}
                {a.pesos != null && a.kind !== 'HOLD_CASH' && <span className="text-slate-400 text-xs">· {peso(a.pesos)}</span>}
              </div>
              <p className="text-slate-300 text-sm mt-1">{a.reason}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Current positions (held only; watchlist candidates appear as BUY actions above) */}
      {advice.positions.some((p) => p.isHolding) && (
      <div>
        <h2 className="text-sm font-semibold text-slate-300 mb-2">Your positions</h2>
        <div className="space-y-1.5">
          {advice.positions.filter((p) => p.isHolding).map((p) => (
            <div key={p.ticker} className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <a href={`/stock/${p.ticker}`} className="font-bold text-white hover:text-green-400">{p.ticker}</a>
                {p.verdict && (
                  <span className={`text-[11px] ${p.verdict === 'BUY' ? 'text-green-400' : p.verdict === 'SELL' ? 'text-red-400' : 'text-slate-500'}`}>{p.verdict}</span>
                )}
              </div>
              <div className="text-right text-xs">
                <span className="text-slate-300">{p.weightPct.toFixed(0)}% of book</span>
                <span className={`ml-3 ${p.pnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>{p.pnlPct >= 0 ? '+' : ''}{p.pnlPct.toFixed(1)}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      )}

      <p className="text-slate-600 text-xs text-center">
        Risk-managed guidance from your holdings, cash, and AI signals — not a prediction and not financial advice.
        Signal accuracy is still being measured; treat this as a coach, not a guarantee. You place any trades yourself.
      </p>
    </div>
  );
}
