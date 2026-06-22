import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { SkeletonCard } from '../ui/Skeleton';
import { computeAdvice, DEFAULT_ADVISOR_CONFIG, type AdvisorPosition, type Advice } from '../../lib/advisor';

interface Holding { ticker: string; qty: number; buy_price: number }

const peso = (n: number) => `₱${n.toLocaleString('en-PH', { maximumFractionDigits: 0 })}`;

export default function Advisor() {
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [cash, setCash] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError('Sign in to see your advisor.'); setLoading(false); return; }

      const [{ data: holdings }, { data: cashRow }, quoteRes] = await Promise.all([
        supabase.from('holdings').select('ticker, qty, buy_price'),
        supabase.from('portfolio_cash').select('cash').eq('user_id', user.id).maybeSingle(),
        fetch('/api/stocks').then((r) => r.json()).catch(() => []),
      ]);

      const cashVal = cashRow ? Number(cashRow.cash) : 0;
      setCash(cashVal);

      const priceMap: Record<string, number> = {};
      if (Array.isArray(quoteRes)) for (const q of quoteRes) priceMap[q.symbol] = q.price;

      // Per-holding signal (cached server-side; degrade gracefully on failure/limit).
      const hs = (holdings ?? []) as Holding[];
      const positions: AdvisorPosition[] = await Promise.all(hs.map(async (h) => {
        let verdict = null, confidence = null;
        try {
          const sig = await fetch('/api/analyze', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker: h.ticker }),
          }).then((r) => (r.ok ? r.json() : null));
          if (sig && !sig.error) { verdict = sig.verdict; confidence = sig.confidence; }
        } catch { /* leave null */ }
        return {
          ticker: h.ticker,
          shares: Number(h.qty),
          avgCost: Number(h.buy_price),
          price: priceMap[h.ticker] ?? Number(h.buy_price),
          verdict, confidence,
        };
      }));

      setAdvice(computeAdvice(positions, cashVal, DEFAULT_ADVISOR_CONFIG));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build your advice.');
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="space-y-3">{[1, 2].map((i) => <SkeletonCard key={i} />)}</div>;
  if (error) return <div className="bg-red-400/10 border border-red-400/30 rounded-xl p-4 text-red-300 text-sm">{error}</div>;
  if (!advice) return null;

  if (advice.positions.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
        <p className="text-slate-400 mb-1">No holdings yet.</p>
        <p className="text-slate-500 text-sm">Add holdings and set your cash on the Portfolio page, then come back for advice.</p>
      </div>
    );
  }

  const actionStyle: Record<string, string> = {
    EXIT: 'border-red-500/40 bg-red-500/5',
    TRIM: 'border-amber-500/40 bg-amber-500/5',
    BUY: 'border-green-500/40 bg-green-500/5',
    HOLD_CASH: 'border-slate-700 bg-slate-800/40',
  };
  const actionLabel: Record<string, string> = { EXIT: 'EXIT', TRIM: 'TRIM', BUY: 'BUY', HOLD_CASH: 'HOLD CASH' };
  const actionColor: Record<string, string> = {
    EXIT: 'text-red-400', TRIM: 'text-amber-400', BUY: 'text-green-400', HOLD_CASH: 'text-slate-400',
  };

  return (
    <div className="space-y-6">
      {/* Snapshot */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-slate-400 text-xs">Account equity</p>
          <p className="text-white text-lg font-bold">{peso(advice.equity)}</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-slate-400 text-xs">Cash to deploy</p>
          <p className="text-white text-lg font-bold">{peso(advice.cash)}</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-slate-400 text-xs">Concentration cap</p>
          <p className="text-white text-lg font-bold">{DEFAULT_ADVISOR_CONFIG.maxWeightPct}%</p>
        </div>
      </div>

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

      {/* Current positions */}
      <div>
        <h2 className="text-sm font-semibold text-slate-300 mb-2">Your positions</h2>
        <div className="space-y-1.5">
          {advice.positions.map((p) => (
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

      <p className="text-slate-600 text-xs text-center">
        Risk-managed guidance from your holdings, cash, and AI signals — not a prediction and not financial advice.
        Signal accuracy is still being measured; treat this as a coach, not a guarantee. You place any trades yourself.
      </p>
    </div>
  );
}
