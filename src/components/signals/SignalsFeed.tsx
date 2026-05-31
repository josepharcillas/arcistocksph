import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import SignalCard from './SignalCard';
import { SkeletonCard } from '../ui/Skeleton';
import type { StockAnalysisResult } from '../../lib/ai/types';

interface SignalEntry {
  ticker: string;
  result: StockAnalysisResult;
}

export default function SignalsFeed() {
  const [signals, setSignals] = useState<SignalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      const { data: holdings } = await supabase.from('holdings').select('ticker, company_name');
      if (!holdings || holdings.length === 0) { setLoading(false); return; }

      const unique = [...new Map(holdings.map(h => [h.ticker, h])).values()];

      const results = await Promise.allSettled(
        unique.map(async h => {
          const res = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker: h.ticker, companyName: h.company_name }),
          });
          if (!res.ok) throw new Error(`Failed for ${h.ticker}`);
          return { ticker: h.ticker, result: await res.json() };
        })
      );

      const ok = results
        .filter(r => r.status === 'fulfilled')
        .map(r => (r as PromiseFulfilledResult<SignalEntry>).value);

      setSignals(ok);
      setLoading(false);
    }

    load().catch(e => { setError(e.message); setLoading(false); });
  }, []);

  if (loading) return <div className="space-y-3">{[1, 2, 3].map(i => <SkeletonCard key={i} />)}</div>;
  if (error) return <p className="text-red-400 text-sm">{error}</p>;

  if (signals.length === 0) return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
      <p className="text-slate-400 mb-2">No signals yet.</p>
      <p className="text-slate-500 text-sm">Add stocks to your portfolio first, then come back here.</p>
      <a href="/dashboard" className="text-green-400 text-sm hover:underline mt-2 inline-block">Go to Portfolio →</a>
    </div>
  );

  const sells = signals.filter(s => s.result.verdict === 'SELL');
  const buys  = signals.filter(s => s.result.verdict === 'BUY');
  const holds = signals.filter(s => s.result.verdict === 'HOLD');
  const sorted = [...sells, ...buys, ...holds];

  return (
    <div className="space-y-3">
      {sells.length > 0 && <p className="text-red-400 text-xs font-semibold uppercase tracking-wide">⚠ Sell Alerts</p>}
      {sorted.map(s => <SignalCard key={s.ticker} ticker={s.ticker} result={s.result} />)}
    </div>
  );
}
