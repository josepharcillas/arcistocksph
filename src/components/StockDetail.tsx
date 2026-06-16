import { useState, useEffect } from 'react';
import SignalCard from './signals/SignalCard';
import { SkeletonCard } from './ui/Skeleton';
import type { StockAnalysisResult, StockAnalysisInput } from '../lib/ai/types';

function Sparkline({ closes }: { closes: number[] }) {
  const data = closes.slice(-60);
  if (data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const w = 280, h = 56;
  const pts = data
    .map((c, i) => `${(i / (data.length - 1)) * w},${h - ((c - min) / range) * h}`)
    .join(' ');
  const up = data[data.length - 1] >= data[0];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-14" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={up ? '#4ade80' : '#f87171'} strokeWidth="1.5" />
    </svg>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
      <p className="text-slate-500 text-xs">{label}</p>
      <p className="text-white text-sm font-medium mt-0.5">{value}</p>
      {hint && <p className="text-slate-600 text-[10px]">{hint}</p>}
    </div>
  );
}

export default function StockDetail({ ticker }: { ticker: string }) {
  const [data, setData] = useState<StockAnalysisInput | null>(null);
  const [signal, setSignal] = useState<StockAnalysisResult | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [dataErr, setDataErr] = useState('');
  const [loadingSignal, setLoadingSignal] = useState(true);
  const [signalErr, setSignalErr] = useState('');

  useEffect(() => {
    fetch(`/api/stock/${ticker}`)
      .then((r) => r.json())
      .then((d) => { if (d.error) throw new Error(d.error); setData(d); })
      .catch((e) => setDataErr(e.message || 'Could not load stock data'))
      .finally(() => setLoadingData(false));

    fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker }),
    })
      .then(async (r) => {
        // protected route: when logged out the middleware redirects to /login (HTML)
        if (r.redirected || !r.headers.get('content-type')?.includes('json')) {
          throw new Error('Sign in to generate an AI signal for this stock.');
        }
        const j = await r.json();
        if (j.error) throw new Error(j.error);
        return j;
      })
      .then(setSignal)
      .catch((e) => setSignalErr(e.message))
      .finally(() => setLoadingSignal(false));
  }, [ticker]);

  const t = data?.technicals;
  const f = data?.fundamentals;
  const change = t?.priceChange1d ?? 0;

  return (
    <div className="mt-4 space-y-5">
      {/* Price header */}
      {loadingData ? (
        <SkeletonCard />
      ) : dataErr ? (
        <div className="bg-red-400/10 border border-red-400/30 rounded-xl p-4 text-red-300 text-sm">{dataErr}</div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-2xl font-bold">{ticker}</h1>
              <p className="text-slate-500 text-sm">{data?.companyName}</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold">₱{(t?.currentPrice ?? 0).toFixed(2)}</p>
              <p className={`text-sm ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {change >= 0 ? '+' : ''}{change.toFixed(2)}% today
              </p>
            </div>
          </div>
          <div className="mt-3"><Sparkline closes={(data?.priceHistory ?? []).map((d) => d.close)} /></div>
          <p className="text-slate-600 text-xs">{data?.priceHistory?.length ?? 0} trading days</p>
        </div>
      )}

      {/* Technicals */}
      {t && (
        <div>
          <h2 className="text-sm font-semibold text-slate-300 mb-2">Technicals</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Stat label="RSI (14)" value={t.rsi14.toFixed(1)} hint={t.rsi14 > 70 ? 'overbought' : t.rsi14 < 30 ? 'oversold' : 'neutral'} />
            <Stat label="MACD hist" value={t.macd.histogram.toFixed(3)} hint={t.macd.histogram >= 0 ? 'bullish' : 'bearish'} />
            <Stat label="1-week" value={`${t.priceChange1w >= 0 ? '+' : ''}${t.priceChange1w.toFixed(2)}%`} />
            <Stat label="SMA 20" value={`₱${t.sma20.toFixed(2)}`} />
            <Stat label="SMA 50" value={`₱${t.sma50.toFixed(2)}`} />
            <Stat label="SMA 200" value={`₱${t.sma200.toFixed(2)}`} />
          </div>
        </div>
      )}

      {/* Fundamentals */}
      {f && (
        <div>
          <h2 className="text-sm font-semibold text-slate-300 mb-2">Fundamentals</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="P/E" value={f.pe != null ? f.pe.toFixed(2) : 'N/A'} />
            <Stat label="EPS" value={f.eps != null ? `₱${f.eps.toFixed(2)}` : 'N/A'} />
            <Stat label="Book Value" value={f.bookValue != null ? `₱${f.bookValue.toFixed(2)}` : 'N/A'} />
            <Stat label="Div Yield" value={f.dividendYield != null ? `${f.dividendYield.toFixed(2)}%` : 'N/A'} />
          </div>
        </div>
      )}

      {/* AI signal */}
      <div>
        <h2 className="text-sm font-semibold text-slate-300 mb-2">AI Signal</h2>
        {loadingSignal ? (
          <SkeletonCard />
        ) : signal ? (
          <SignalCard ticker={ticker} result={signal} />
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-slate-400 text-sm">
            {signalErr || 'Signal unavailable.'}
            {signalErr.includes('Sign in') && (
              <a href="/login" className="text-green-400 hover:underline ml-1">Sign in →</a>
            )}
          </div>
        )}
      </div>

      {/* News */}
      {data?.headlines && data.headlines.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-300 mb-2">Recent News</h2>
          <ul className="space-y-1.5">
            {data.headlines.slice(0, 6).map((h, i) => (
              <li key={i} className="text-slate-400 text-sm flex gap-2">
                <span className="text-slate-600">•</span>{h}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
