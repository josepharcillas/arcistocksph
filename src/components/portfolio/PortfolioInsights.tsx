import { useState, useEffect } from 'react';
import { SkeletonCard } from '../ui/Skeleton';
import { actionStyle, actionColor, actionLabel } from '../advisor/actionStyles';

// AI Portfolio Analysis card for the Portfolio page: a plain-English read of the
// user's book plus risk-managed actions, enriched with dividend context. Loads
// the user's real holdings + cash and asks /api/portfolio/insights (which runs
// the existing advisor model + dividends + an AI narrative server-side).

interface Action { kind: string; ticker?: string; shares?: number; pesos?: number; reason: string }
interface Position { ticker: string; weightPct: number; pnlPct: number; verdict: string | null; yieldPct: number | null; nextRecordDate: string | null }

const peso = (n: number) => `₱${n.toLocaleString('en-PH', { maximumFractionDigits: 0 })}`;

export default function PortfolioInsights() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [empty, setEmpty] = useState(false);
  const [narrative, setNarrative] = useState<string | null>(null);
  const [narrativeUnavailable, setNarrativeUnavailable] = useState(false);
  const [actions, setActions] = useState<Action[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const portfolioRes = await fetch('/api/portfolio');
      if (portfolioRes.status === 401) {
        setError('Sign in to see your portfolio analysis.'); setLoading(false); return;
      }
      if (!portfolioRes.ok) throw new Error('Could not load your portfolio.');
      const portfolio = await portfolioRes.json();

      const hs = (portfolio.holdings ?? []) as { ticker: string; qty: number; buy_price: number }[];
      const cash = Number(portfolio.cash) || 0;
      if (hs.length === 0) { setEmpty(true); setLoading(false); return; }

      const res = await fetch('/api/portfolio/insights', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ holdings: hs, cash }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setError(data.error ?? 'Could not build your analysis.'); setLoading(false); return; }

      setEmpty(!!data.empty);
      setNarrative(data.narrative ?? null);
      setNarrativeUnavailable(!!data.narrativeUnavailable);
      setActions(data.actions ?? []);
      setPositions(data.positions ?? []);
      setLoadedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build your analysis.');
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="mt-8"><SkeletonCard /></div>;
  if (error) return <div className="mt-8 bg-red-400/10 border border-red-400/30 rounded-xl p-4 text-red-300 text-sm">{error}</div>;
  if (empty) return null; // no holdings — the "add your first stock" prompt already covers this

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold">AI Portfolio Analysis</h2>
        <button onClick={load} className="text-slate-500 hover:text-slate-300 text-xs">Refresh</button>
      </div>

      {narrative && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-3">
          <p className="text-slate-200 text-sm leading-relaxed">{narrative}</p>
        </div>
      )}

      {narrativeUnavailable && (
        <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-3 mb-3 flex items-center justify-between gap-3">
          <p className="text-slate-400 text-xs">AI summary is temporarily unavailable (the AI provider is rate-limited). Your recommended actions below are still up to date.</p>
          <button onClick={load} className="text-slate-300 hover:text-white text-xs font-semibold whitespace-nowrap">Try again</button>
        </div>
      )}

      {actions.length > 0 && (
        <div className="space-y-2 mb-3">
          {actions.map((a, i) => (
            <div key={i} className={`border rounded-xl p-4 ${actionStyle[a.kind] ?? actionStyle.HOLD_CASH}`}>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold ${actionColor[a.kind] ?? 'text-slate-400'}`}>{actionLabel[a.kind] ?? a.kind}</span>
                {a.ticker && <span className="text-white font-bold">{a.ticker}</span>}
                {a.shares != null && <span className="text-slate-400 text-xs">{a.shares} sh</span>}
                {a.pesos != null && a.kind !== 'HOLD_CASH' && <span className="text-slate-400 text-xs">· {peso(a.pesos)}</span>}
              </div>
              <p className="text-slate-300 text-sm mt-1">{a.reason}</p>
            </div>
          ))}
        </div>
      )}

      {positions.some((p) => p.yieldPct != null || p.nextRecordDate) && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-3">
          <p className="text-xs font-semibold text-slate-300 mb-2">Dividend income in your book</p>
          <div className="space-y-1">
            {positions.filter((p) => p.yieldPct != null || p.nextRecordDate).map((p) => (
              <div key={p.ticker} className="flex items-center justify-between text-xs">
                <a href={`/stock/${p.ticker}`} className="font-bold text-white hover:text-green-400">{p.ticker}</a>
                <span className="text-slate-400">
                  {p.yieldPct != null && <span className="text-green-400">{p.yieldPct.toFixed(1)}% yield</span>}
                  {p.nextRecordDate && <span className="ml-3">record date {p.nextRecordDate}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {loadedAt && (
        <p className="text-slate-600 text-[11px]">Analysis as of {loadedAt.toLocaleTimeString()} · not financial advice · you place any trades yourself</p>
      )}
    </div>
  );
}
