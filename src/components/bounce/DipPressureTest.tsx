import { useState } from 'react';

interface BounceTickerResult {
  ok: boolean;
  ticker: string;
  error?: string;
  companyName?: string;
  price?: number;
  rsi14?: number | null;
  pctFromLow?: number | null;
  aboveSma200?: boolean | null;
  verdict?: string | null;
  rating?: 'SETUP' | 'WAIT' | 'AVOID';
  reasons?: string[];
}

const ratingStyle: Record<string, string> = {
  SETUP: 'bg-green-500/20 text-green-300',
  WAIT: 'bg-amber-500/15 text-amber-400',
  AVOID: 'bg-red-500/15 text-red-400',
};
const ratingBlurb: Record<string, string> = {
  SETUP: 'Oversold and starting to turn — the disciplined "buy the dip".',
  WAIT: 'Still falling — a knife. No bottom confirmed yet.',
  AVOID: "Don't catch this one — the signal says it's a trap / real downtrend.",
};
const peso = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function DipPressureTest() {
  const [ticker, setTicker] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BounceTickerResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    const sym = ticker.trim().toUpperCase();
    if (!sym) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/dip-radar/${encodeURIComponent(sym)}`);
      const data: BounceTickerResult = await res.json();
      if (!data.ok) setError(data.error ?? 'Could not rate this ticker');
      else setResult(data);
    } catch {
      setError('Network error — try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <h2 className="font-semibold text-white">Pressure-test a dip</h2>
      <p className="text-slate-400 text-xs mt-0.5 mb-3">
        Got a hunch a stock is washed out? Type its ticker and see if it's a real bounce setup or a falling knife.
      </p>
      <form onSubmit={check} className="flex gap-2">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="e.g. NIKL"
          className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-slate-500 uppercase"
          maxLength={10}
          autoCapitalize="characters"
        />
        <button
          type="submit"
          disabled={loading || !ticker.trim()}
          className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
        >
          {loading ? 'Checking…' : 'Check'}
        </button>
      </form>

      {error && <p className="text-red-400 text-sm mt-3">{error}</p>}

      {result?.ok && result.rating && (
        <div className="mt-4 border-t border-slate-800 pt-4">
          <div className="flex items-baseline justify-between gap-2">
            <span>
              <span className="font-semibold text-white">{result.ticker}</span>
              {result.companyName && <span className="block text-xs text-slate-500 truncate">{result.companyName}</span>}
            </span>
            <span className={`inline-block px-2.5 py-1 rounded-full text-sm font-semibold ${ratingStyle[result.rating]}`}>
              {result.rating}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-2">{ratingBlurb[result.rating]}</p>

          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-400 mt-3">
            {result.price != null && <span>Price <span className="text-slate-200 tabular-nums">{peso(result.price)}</span></span>}
            {result.rsi14 != null && <span>RSI <span className="text-slate-200 tabular-nums">{result.rsi14.toFixed(0)}</span></span>}
            {result.pctFromLow != null && <span>Above low <span className="text-slate-200 tabular-nums">{result.pctFromLow.toFixed(0)}%</span></span>}
            {result.verdict && <span>AI <span className={result.verdict === 'SELL' ? 'text-red-400' : result.verdict === 'BUY' ? 'text-green-400' : 'text-slate-300'}>{result.verdict}</span></span>}
          </div>

          {result.reasons && result.reasons.length > 0 && (
            <ul className="mt-3 space-y-1">
              {result.reasons.map((r, i) => (
                <li key={i} className="text-xs text-slate-400 flex gap-1.5"><span className="text-slate-600">•</span>{r}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
