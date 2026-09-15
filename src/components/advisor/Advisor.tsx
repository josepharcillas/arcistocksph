import { useEffect, useMemo, useState } from 'react';
import { SkeletonCard } from '../ui/Skeleton';
import {
  computeAdvice, computeDeployPlan, DEFAULT_ADVISOR_CONFIG, DIVIDEND_BLUE_CHIPS,
  type AdvisorPosition, type DeployCandidate,
} from '../../lib/advisor';
import { actionStyle, actionColor, actionLabel } from './actionStyles';

interface Holding { ticker: string; qty: number; buy_price: number }

const peso = (n: number) => `₱${n.toLocaleString('en-PH', { maximumFractionDigits: 0 })}`;
const RISK = { ...DEFAULT_ADVISOR_CONFIG, sizing: 'risk' as const };

export default function Advisor() {
  const [positions, setPositions] = useState<AdvisorPosition[]>([]);
  const [priceMap, setPriceMap] = useState<Record<string, number>>({});
  const [realCash, setRealCash] = useState(0);       // actual portfolio cash
  const [deposit, setDeposit] = useState(10000);     // NEW cash to deploy today (editable, always)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const portfolioRes = await fetch('/api/portfolio');
      if (!portfolioRes.ok) { setError('Sign in to see your advisor.'); setLoading(false); return; }
      const { holdings, cash: cashVal } = await portfolioRes.json() as { holdings: Holding[]; cash: number };

      const [watchRows, quoteRes, oppRes] = await Promise.all([
        fetch('/api/watchlist').then((r) => (r.ok ? r.json() : [])).catch(() => []),
        fetch('/api/stocks').then((r) => r.json()).catch(() => []),
        fetch('/api/advisor/opportunities').then((r) => (r.ok ? r.json() : { candidates: [] })).catch(() => ({ candidates: [] })),
      ]);

      setRealCash(cashVal);

      const pm: Record<string, number> = {};
      if (Array.isArray(quoteRes)) for (const q of quoteRes) pm[q.symbol] = q.price;
      setPriceMap(pm);

      const hs = holdings ?? [];
      const held = new Set(hs.map((h) => h.ticker));
      // Watchlist tickers not already held become zero-share buy candidates.
      const watchTickers = [...new Set(((watchRows ?? []) as { ticker: string }[]).map((w) => w.ticker))].filter((t) => !held.has(t));

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
        price: pm[h.ticker] ?? Number(h.buy_price), ...(await signalFor(h.ticker)),
      })));
      const watchPositions: AdvisorPosition[] = await Promise.all(watchTickers.map(async (t) => ({
        ticker: t, shares: 0, avgCost: 0, price: pm[t] ?? 0, ...(await signalFor(t)),
      }))).then((ps) => ps.filter((p) => p.price > 0)); // skip unknown-price candidates

      // Market-scan opportunities: fresh cached BUYs from the whole liquid market,
      // quality-gated server-side. Cache-only (no extra AI calls).
      const watchSet = new Set(watchTickers);
      const oppPositions: AdvisorPosition[] = ((oppRes?.candidates ?? []) as any[])
        .filter((c) => !held.has(c.ticker) && !watchSet.has(c.ticker) && (pm[c.ticker] ?? 0) > 0)
        .slice(0, 8)
        .map((c) => ({
          ticker: c.ticker, shares: 0, avgCost: 0, price: pm[c.ticker],
          verdict: c.verdict, confidence: c.confidence, stopLoss: c.stopLoss ?? null, isNew: true,
        }));

      setPositions([...heldPositions, ...watchPositions, ...oppPositions]);
      // Seed the deploy field to real cash when set, else the routine ₱10k. Always
      // editable — you tell it how much NEW cash you're putting in today.
      setDeposit(cashVal > 0 ? Math.round(cashVal) : 10000);
      setLoadedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build your advice.');
    } finally {
      setLoading(false);
    }
  }

  // Portfolio-aware advice (equity, positions, and the sell/trim housekeeping)
  // reflects your REAL cash; the deploy plan below uses the editable deposit.
  const advice = useMemo(() => computeAdvice(positions, realCash, RISK), [positions, realCash]);
  const housekeeping = advice.actions.filter((a) => a.kind === 'EXIT' || a.kind === 'TRIM');

  // Candidates for deploying today's cash: your BUY-signalled names first, then
  // dividend blue chips to fill out a diversified spread (the DCA fallback).
  const deployCandidates = useMemo<DeployCandidate[]>(() => {
    const signal: DeployCandidate[] = positions
      .filter((p) => p.verdict === 'BUY' && p.price > 0)
      .map((p) => ({
        ticker: p.ticker, price: p.price, heldValue: p.shares * p.price,
        source: 'signal', verdict: p.verdict, confidence: p.confidence,
      }));
    const seen = new Set(signal.map((s) => s.ticker));
    const heldValue = new Map(positions.map((p) => [p.ticker, p.shares * p.price]));
    const dividend: DeployCandidate[] = DIVIDEND_BLUE_CHIPS
      .filter((t) => (priceMap[t] ?? 0) > 0 && !seen.has(t))
      .map((t) => ({ ticker: t, price: priceMap[t], heldValue: heldValue.get(t) ?? 0, source: 'dividend' }));
    return [...signal, ...dividend];
  }, [positions, priceMap]);

  // Cap the spread against holdings + today's deposit (the money actually going
  // to work), so a small existing book doesn't block deploying a larger deposit.
  const deployPlan = useMemo(
    () => computeDeployPlan(deployCandidates, deposit || 0, advice.holdingsValue + (deposit || 0)),
    [deployCandidates, deposit, advice.holdingsValue],
  );

  if (loading) return <div className="space-y-3">{[1, 2].map((i) => <SkeletonCard key={i} />)}</div>;
  if (error) return <div className="bg-red-400/10 border border-red-400/30 rounded-xl p-4 text-red-300 text-sm">{error}</div>;

  return (
    <div className="space-y-6">
      {/* Snapshot */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-slate-400 text-xs">Account equity</p>
          <p className="text-white text-lg font-bold">{peso(advice.equity)}</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-slate-400 text-xs">New cash to deploy today</p>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-slate-500">₱</span>
            <input
              type="number" min="0" step="1000" inputMode="numeric" aria-label="New cash to deploy today"
              value={deposit}
              onChange={(e) => setDeposit(Math.max(0, Number(e.target.value)))}
              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-white text-lg font-bold tabular-nums"
            />
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-slate-400 text-xs">Concentration cap</p>
          <p className="text-white text-lg font-bold">{DEFAULT_ADVISOR_CONFIG.maxWeightPct}%</p>
        </div>
      </div>

      {loadedAt && (
        <p className="text-slate-600 text-[11px] -mt-2">Data as of {loadedAt.toLocaleTimeString()} · prices may be delayed/EOD</p>
      )}

      {/* Deploy today's cash — the payday allocation plan */}
      <div>
        <h2 className="text-lg font-semibold mb-1">Deploy your {peso(deposit || 0)}</h2>
        <p className="text-slate-500 text-xs mb-2">{deployPlan.note}</p>
        {deployPlan.buys.length > 0 ? (
          <div className="space-y-2">
            {deployPlan.buys.map((b) => (
              <div key={b.ticker} className={`border rounded-xl p-4 ${actionStyle.BUY}`}>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold ${actionColor.BUY}`}>BUY</span>
                  <a href={`/stock/${b.ticker}`} className="text-white font-bold hover:text-green-400">{b.ticker}</a>
                  <span className="text-slate-400 text-xs">{b.shares.toLocaleString('en-PH')} sh</span>
                  <span className="text-slate-400 text-xs">· {peso(b.pesos)}</span>
                  {b.source === 'dividend' && <span className="text-[10px] text-amber-400/80 border border-amber-400/30 rounded px-1.5">dividend</span>}
                </div>
                <p className="text-slate-300 text-sm mt-1">{b.reason}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-slate-400 text-sm">
            {deployCandidates.length === 0
              ? 'No market prices loaded yet — check back after the next signal refresh.'
              : 'Increase the amount above to at least one board lot of a candidate to see a plan.'}
          </div>
        )}
      </div>

      {/* Housekeeping — sell/trim actions from your real book (not the deposit) */}
      {housekeeping.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-300 mb-2">Also worth doing</h2>
          <div className="space-y-2">
            {housekeeping.map((a, i) => (
              <div key={i} className={`border rounded-xl p-4 ${actionStyle[a.kind]}`}>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold ${actionColor[a.kind]}`}>{actionLabel[a.kind]}</span>
                  {a.ticker && <span className="text-white font-bold">{a.ticker}</span>}
                  {a.shares != null && <span className="text-slate-400 text-xs">{a.shares} sh</span>}
                  {a.pesos != null && <span className="text-slate-400 text-xs">· {peso(a.pesos)}</span>}
                </div>
                <p className="text-slate-300 text-sm mt-1">{a.reason}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Current positions (held only) */}
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
