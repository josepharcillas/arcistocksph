import { useEffect, useState } from 'react';

// The single highest-conviction answer: stocks where EVERYTHING agrees — a fresh
// AI BUY (already gated to MEDIUM+, above the 200-day trend, liquid) AND a solid
// recurring dividend (GOOD/STRONG entry). This is the intersection the app's own
// data supports most; it also resolves the "Signals says X, Dividends says Y"
// confusion by giving one ranked answer.

interface Opp { ticker: string; confidence: string | null }
interface DivEntry { rating: string; reasons: string[] }
interface DivRow { ticker: string; companyName: string | null; price: number; regularYieldPct: number; entry: DivEntry }
interface Pick {
  ticker: string; companyName: string | null; price: number; yieldPct: number;
  confidence: string | null; rating: string;
}

const peso = (n: number) => `₱${n.toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;

export default function ConsensusPicks() {
  const [picks, setPicks] = useState<Pick[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const [opp, div] = await Promise.all([
        fetch('/api/advisor/opportunities').then((r) => (r.ok ? r.json() : { candidates: [] })).catch(() => ({ candidates: [] })),
        fetch('/api/dividends?limit=200').then((r) => (r.ok ? r.json() : { rows: [] })).catch(() => ({ rows: [] })),
      ]);
      const oppMap = new Map<string, Opp>(((opp?.candidates ?? []) as Opp[]).map((c) => [c.ticker, c]));
      const consensus: Pick[] = ((div?.rows ?? []) as DivRow[])
        .filter((r) => oppMap.has(r.ticker) && (r.entry.rating === 'GOOD ENTRY' || r.entry.rating === 'STRONG ENTRY'))
        .map((r) => ({
          ticker: r.ticker, companyName: r.companyName, price: r.price,
          yieldPct: r.regularYieldPct, confidence: oppMap.get(r.ticker)!.confidence, rating: r.entry.rating,
        }))
        .sort((a, b) => b.yieldPct - a.yieldPct);
      setPicks(consensus);
    } catch { /* leave empty */ }
    finally { setLoading(false); }
  }

  if (loading) return null; // stays quiet until it has an answer

  if (picks.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-6">
        <h2 className="text-lg font-semibold">🎯 Top conviction</h2>
        <p className="text-slate-400 text-sm mt-1">
          No stock has full agreement right now — a fresh AI BUY <em>and</em> a solid recurring dividend <em>and</em> liquid.
          The best available buys are in <span className="text-slate-300">"What to buy now"</span> below; the safest income
          picks are on the <a href="/dividends" className="text-green-400 hover:underline">Dividends</a> page.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-green-500/5 border border-green-500/40 rounded-xl p-4 mb-6">
      <h2 className="text-lg font-semibold">🎯 Top conviction — everything agrees</h2>
      <p className="text-slate-400 text-xs mt-0.5 mb-3">
        {picks.length === 1 ? 'This stock is' : 'These stocks are'} an AI BUY, a solid recurring dividend payer, and liquid enough to trade — the one place the app's signals all line up.
      </p>
      <div className="space-y-2">
        {picks.map((p) => (
          <div key={p.ticker} className="flex items-center gap-3 flex-wrap bg-slate-900/40 rounded-lg px-3 py-2.5">
            <a href={`/stock/${p.ticker}`} className="text-white font-bold hover:text-green-400">{p.ticker}</a>
            {p.companyName && <span className="text-slate-500 text-xs truncate max-w-[160px]">{p.companyName}</span>}
            <span className="text-slate-300 text-sm tabular-nums">{peso(p.price)}</span>
            <span className="ml-auto flex items-center gap-2 text-xs">
              <span className="text-green-400 font-medium">AI BUY{p.confidence ? ` · ${p.confidence}` : ''}</span>
              <span className="text-slate-600">·</span>
              <span className="text-green-400 font-medium tabular-nums">{p.yieldPct.toFixed(1)}% dividend</span>
              <span className="text-slate-600">·</span>
              <span className="text-emerald-400">{p.rating}</span>
            </span>
          </div>
        ))}
      </div>
      <p className="text-slate-600 text-[11px] mt-3">
        Cross-confirmed = a trend/liquidity signal plus an income floor. Still not a guarantee — you place any trades yourself.
      </p>
    </div>
  );
}
