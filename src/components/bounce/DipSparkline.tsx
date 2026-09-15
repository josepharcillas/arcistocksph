import { useEffect, useRef, useState } from 'react';

/**
 * A lazy price sparkline for a Dip Radar row. It lives inside a collapsed
 * <details> and only fetches history the first time that row is expanded, so
 * opening the page never fires ~40 history requests at once. Line is green when
 * the window ends higher than it started (turning up), red when still falling.
 */
export default function DipSparkline({ ticker, days = 60 }: { ticker: string; days?: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [closes, setCloses] = useState<number[]>([]);

  useEffect(() => {
    const details = hostRef.current?.closest('details');
    if (!details) return;

    let cancelled = false;
    let started = false;

    const load = () => {
      if (started) return;
      started = true;
      setState('loading');
      fetch(`/api/stock/${ticker}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((data: { priceHistory?: { close: number }[] }) => {
          if (cancelled) return;
          const series = (data?.priceHistory ?? [])
            .map((d) => d.close)
            .filter((n) => typeof n === 'number' && n > 0)
            .slice(-days);
          setCloses(series);
          setState(series.length >= 2 ? 'ready' : 'error');
        })
        .catch(() => {
          if (!cancelled) setState('error');
        });
    };

    if (details.open) load();
    const onToggle = () => {
      if (details.open) load();
    };
    details.addEventListener('toggle', onToggle);
    return () => {
      cancelled = true;
      details.removeEventListener('toggle', onToggle);
    };
  }, [ticker, days]);

  return (
    <div ref={hostRef} className="mt-1">
      {state === 'loading' && <div className="h-14 w-full animate-pulse rounded bg-slate-800/40" />}
      {state === 'error' && <p className="text-[11px] text-slate-600">Price history unavailable.</p>}
      {state === 'ready' && (
        <>
          <Line closes={closes} />
          <p className="mt-0.5 text-[11px] text-slate-600">{closes.length} trading days</p>
        </>
      )}
    </div>
  );
}

function Line({ closes }: { closes: number[] }) {
  const w = 100;
  const h = 32;
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const pts = closes
    .map((c, i) => {
      const x = (i / (closes.length - 1)) * w;
      const y = h - ((c - min) / span) * h;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
  const up = closes[closes.length - 1] >= closes[0];
  const stroke = up ? '#4ade80' : '#f87171';
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-14 w-full" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
