import { useEffect, useState } from 'react';

// Market movers: top gainers + most actively traded PSE stocks (above the
// liquidity floor), with a signal badge when a FRESH cached signal exists.
// Read-only market coverage — rendering this costs zero AI calls.

interface Mover {
  ticker: string; name: string; price: number; changePct: number; turnover: number;
  verdict: string | null; confidence: string | null;
}
interface MoversPayload {
  asOf: string; minTurnover: number;
  gainers: Mover[]; mostActive: Mover[];
  crypto?: { gainers: Mover[]; mostActive: Mover[] };
}

const pesoM = (n: number) =>
  n >= 1_000_000_000 ? `₱${(n / 1_000_000_000).toFixed(1)}B` : `₱${(n / 1_000_000).toFixed(1)}M`;

function SignalBadge({ verdict, confidence }: { verdict: string | null; confidence: string | null }) {
  if (!verdict) return <span className="text-[10px] text-slate-600">—</span>;
  const color = verdict === 'BUY' ? 'text-green-400 bg-green-500/10' : verdict === 'SELL' ? 'text-red-400 bg-red-500/10' : 'text-slate-400 bg-slate-500/10';
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${color}`}>
      {verdict}{confidence ? `/${confidence[0]}` : ''}
    </span>
  );
}

function MoverList({ title, movers, metric, linkable = true }: { title: string; movers: Mover[]; metric: 'change' | 'turnover'; linkable?: boolean }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-slate-300 mb-2">{title}</h3>
      <div className="space-y-1">
        {movers.map((m) => (
          <div key={m.ticker} className="flex items-center justify-between py-1 border-b border-slate-800/60 last:border-0">
            <div className="flex items-center gap-2 min-w-0">
              {linkable
                ? <a href={`/stock/${m.ticker}`} className="font-bold text-white hover:text-green-400 text-sm">{m.ticker}</a>
                : <span className="font-bold text-white text-sm">{m.ticker}</span>}
              <SignalBadge verdict={m.verdict} confidence={m.confidence} />
            </div>
            <div className="text-right text-xs shrink-0">
              <span className="text-slate-300">₱{m.price.toLocaleString('en-PH', { maximumFractionDigits: 2 })}</span>
              {metric === 'change' ? (
                <span className={`ml-2 font-semibold ${m.changePct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {m.changePct >= 0 ? '+' : ''}{m.changePct.toFixed(1)}%
                </span>
              ) : (
                <span className="ml-2 text-slate-400">{pesoM(m.turnover)}</span>
              )}
            </div>
          </div>
        ))}
        {movers.length === 0 && <p className="text-slate-500 text-xs">No data right now — try again when the market is open.</p>}
      </div>
    </div>
  );
}

export default function MarketMovers() {
  const [data, setData] = useState<MoversPayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch('/api/market/movers')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => (d.error ? setFailed(true) : setData(d)))
      .catch(() => setFailed(true));
  }, []);

  if (failed) return null; // movers are a bonus — never block the page on them
  if (!data) {
    return <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 h-24 animate-pulse" />;
  }

  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold mb-2">Market movers — PSE</h2>
      <div className="grid md:grid-cols-2 gap-3">
        <MoverList title="Top gainers today" movers={data.gainers} metric="change" />
        <MoverList title="Most actively traded" movers={data.mostActive} metric="turnover" />
      </div>
      {data.crypto && (data.crypto.gainers.length > 0 || data.crypto.mostActive.length > 0) && (
        <>
          <h2 className="text-lg font-semibold mb-2 mt-5">Market movers — Crypto</h2>
          <div className="grid md:grid-cols-2 gap-3">
            <MoverList title="Top gainers (24h)" movers={data.crypto.gainers} metric="change" linkable={false} />
            <MoverList title="Most actively traded" movers={data.crypto.mostActive} metric="turnover" linkable={false} />
          </div>
        </>
      )}
      <p className="text-slate-600 text-[11px] mt-1.5">
        Liquid assets only (stocks {pesoM(data.minTurnover)}+ typical daily turnover; coins volume-floored). Badges show fresh AI signals where available — H/M/L = confidence.
      </p>
    </div>
  );
}
