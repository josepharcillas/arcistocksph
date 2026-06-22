import { useEffect, useState } from 'react';

interface VerdictStat { n: number; accuracyPct: number | null }
interface Accuracy {
  horizonDays: number;
  evaluated: number;
  accuracyPct: number | null;
  byVerdict: { BUY: VerdictStat; SELL: VerdictStat; HOLD: VerdictStat };
}

export default function SignalAccuracy() {
  const [data, setData] = useState<Accuracy | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/signals/accuracy')
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded || !data) return null;

  const color = (p: number | null) =>
    p == null ? 'text-slate-500' : p >= 55 ? 'text-green-400' : p >= 45 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-300">Signal accuracy</h2>
        <span className="text-slate-500 text-xs">signals aged ≥{data.horizonDays}d, measured to today</span>
      </div>

      {data.evaluated === 0 ? (
        <p className="text-slate-500 text-xs mt-2">
          Not enough history yet — accuracy appears once signals are at least {data.horizonDays} days old.
          Keep viewing stocks to build the track record.
        </p>
      ) : (
        <>
          <div className="flex items-end gap-2 mt-2">
            <span className={`text-3xl font-bold ${color(data.accuracyPct)}`}>
              {data.accuracyPct}%
            </span>
            <span className="text-slate-500 text-xs mb-1.5">directional hit-rate · {data.evaluated} signals</span>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3">
            {(['BUY', 'SELL', 'HOLD'] as const).map((v) => (
              <div key={v} className="bg-slate-800/60 rounded-lg px-3 py-2 text-center">
                <p className="text-slate-400 text-xs">{v}</p>
                <p className={`font-semibold ${color(data.byVerdict[v].accuracyPct)}`}>
                  {data.byVerdict[v].accuracyPct ?? '—'}{data.byVerdict[v].accuracyPct != null ? '%' : ''}
                </p>
                <p className="text-slate-600 text-[10px]">{data.byVerdict[v].n} signals</p>
              </div>
            ))}
          </div>
          <p className="text-slate-600 text-[11px] mt-3 leading-relaxed">
            A directional sanity check, not a guarantee. ~50% is no better than a coin flip — only
            trust signals if this stays meaningfully above 50% over many samples. Not financial advice.
          </p>
        </>
      )}
    </div>
  );
}
