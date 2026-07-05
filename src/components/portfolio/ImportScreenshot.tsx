import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';

// Import real holdings from a COL Financial portfolio screenshot.
// Flow: pick image -> server vision parse -> reviewable diff vs current holdings
// (inline-editable, unknown tickers flagged) -> confirm -> sync holdings + cash.
//
// Sync semantics = "replace to match the screenshot": parsed positions are the
// source of truth. Positions no longer shown are removed, UNLESS the user marks
// them "Keep" — a guard against a missed row in the screenshot.

interface ExistingHolding {
  ticker: string;
  qty: number;
  buy_price: number;
  buy_date: string | null;
}

interface Props {
  userId: string | null;
  currentHoldings: ExistingHolding[];
  onImported: () => void;
  onCancel: () => void;
}

interface Row {
  ticker: string;
  shares: string;   // kept as strings so inline edits don't fight the input
  avgPrice: string;
}

type Status = 'idle' | 'parsing' | 'review' | 'saving';

const today = () => new Date().toISOString().split('T')[0];

export default function ImportScreenshot({ userId, currentHoldings, onImported, onCancel }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [parsedCash, setParsedCash] = useState<number | null>(null);
  const [includeCash, setIncludeCash] = useState(true);
  const [keepTickers, setKeepTickers] = useState<Set<string>>(new Set());
  const [validTickers, setValidTickers] = useState<Set<string> | null>(null);
  const [format, setFormat] = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Load the PSE universe once so we can flag a misread ticker in review.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/stocks');
        const list = await res.json();
        if (Array.isArray(list)) {
          setValidTickers(new Set(list.map((s: { symbol?: string }) => (s.symbol ?? '').toUpperCase())));
        }
      } catch { /* validation is best-effort; leave null = no flags */ }
    })();
  }, []);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setStatus('parsing');
    try {
      const { base64, mimeType } = await readAsBase64(file);
      const res = await fetch('/api/portfolio/import-screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mimeType }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Could not read that screenshot.'); setStatus('idle'); return; }

      setRows(data.positions.map((p: { ticker: string; shares: number; avgPrice: number }) => ({
        ticker: p.ticker, shares: String(p.shares), avgPrice: String(p.avgPrice),
      })));
      setParsedCash(typeof data.cash === 'number' ? data.cash : null);
      setIncludeCash(typeof data.cash === 'number');
      setFormat(data.format ?? '');
      setKeepTickers(new Set());
      setStatus('review');
    } catch {
      setError('Could not process that image. Please try another screenshot.');
      setStatus('idle');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function updateRow(i: number, field: keyof Row, value: string) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: field === 'ticker' ? value.toUpperCase() : value } : r));
  }
  function dropRow(i: number) { setRows(prev => prev.filter((_, idx) => idx !== i)); }

  // Diff bookkeeping for the review UI.
  const targetTickers = new Set(rows.map(r => r.ticker.trim()).filter(Boolean));
  const currentByTicker = new Map(currentHoldings.map(h => [h.ticker, h]));
  const removed = currentHoldings.filter(h => !targetTickers.has(h.ticker));

  const isNewTicker = (ticker: string) => !currentByTicker.has(ticker);

  async function confirmSync() {
    if (!userId) { setError('You must be signed in.'); return; }

    // Validate edits before touching the DB.
    const clean: { ticker: string; shares: number; avgPrice: number }[] = [];
    for (const r of rows) {
      const ticker = r.ticker.trim().toUpperCase();
      const shares = Math.round(Number(r.shares));
      const avgPrice = Number(r.avgPrice);
      if (!ticker) continue;
      if (!Number.isFinite(shares) || shares <= 0) { setError(`Invalid share count for ${ticker || 'a row'}.`); return; }
      if (!Number.isFinite(avgPrice) || avgPrice <= 0) { setError(`Invalid average price for ${ticker || 'a row'}.`); return; }
      clean.push({ ticker, shares, avgPrice });
    }
    if (clean.length === 0) { setError('Nothing to import.'); return; }

    // Two rows resolving to the same ticker is ambiguous — one would silently
    // overwrite the other during the sync. Surface it instead of guessing.
    const seen = new Set<string>();
    for (const p of clean) {
      if (seen.has(p.ticker)) { setError(`${p.ticker} appears twice — merge or remove the duplicate row before syncing.`); return; }
      seen.add(p.ticker);
    }

    setStatus('saving');
    setError('');
    try {
      // Re-read existing rows fresh so we sync against current DB state.
      const { data: existing, error: readErr } = await supabase
        .from('holdings').select('id, ticker, qty, buy_price, buy_date').eq('user_id', userId);
      if (readErr) throw readErr;

      const rowsByTicker = new Map<string, { id: string; buy_date: string | null }[]>();
      for (const h of existing ?? []) {
        const arr = rowsByTicker.get(h.ticker) ?? [];
        arr.push({ id: h.id, buy_date: h.buy_date });
        rowsByTicker.set(h.ticker, arr);
      }

      // Upsert each target position, consolidated to a single row per ticker.
      for (const pos of clean) {
        const existingRows = rowsByTicker.get(pos.ticker) ?? [];
        const buyDate = existingRows[0]?.buy_date ?? today(); // preserve original entry date
        if (existingRows.length > 0) {
          const [first, ...rest] = existingRows;
          const { error: upErr } = await supabase.from('holdings')
            .update({ qty: pos.shares, buy_price: pos.avgPrice, buy_date: buyDate }).eq('id', first.id);
          if (upErr) throw upErr;
          if (rest.length) await supabase.from('holdings').delete().in('id', rest.map(r => r.id));
        } else {
          const { error: insErr } = await supabase.from('holdings')
            .insert({ user_id: userId, ticker: pos.ticker, qty: pos.shares, buy_price: pos.avgPrice, buy_date: today() });
          if (insErr) throw insErr;
        }
      }

      // Remove positions no longer in the screenshot, unless the user kept them.
      const targetSet = new Set(clean.map(p => p.ticker));
      const toDelete = (existing ?? []).filter(h => !targetSet.has(h.ticker) && !keepTickers.has(h.ticker));
      if (toDelete.length) {
        const { error: delErr } = await supabase.from('holdings').delete().in('id', toDelete.map(h => h.id));
        if (delErr) throw delErr;
      }

      // Sync cash if the screenshot showed it and the user left it checked.
      if (includeCash && parsedCash !== null) {
        await supabase.from('portfolio_cash').upsert(
          { user_id: userId, cash: parsedCash, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        );
      }

      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed. Please try again.');
      setStatus('review');
    }
  }

  function toggleKeep(ticker: string) {
    setKeepTickers(prev => {
      const next = new Set(prev);
      next.has(ticker) ? next.delete(ticker) : next.add(ticker);
      return next;
    });
  }

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 mb-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300">Import from COL screenshot</h3>
        <button onClick={onCancel} className="text-slate-500 hover:text-slate-300 text-xs">Cancel</button>
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}

      {(status === 'idle' || status === 'parsing') && (
        <div>
          <p className="text-slate-400 text-xs mb-3">
            Upload a screenshot of your COL Financial portfolio (web account summary or the mobile Portfolio widget).
            We'll read your positions so you can review them before saving. The image isn't stored.
          </p>
          <input
            ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp"
            onChange={onFile} disabled={status === 'parsing'}
            className="block w-full text-xs text-slate-400 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-green-500 file:text-slate-950 hover:file:bg-green-400 disabled:opacity-50"
          />
          {status === 'parsing' && <p className="text-slate-400 text-xs mt-3">Reading your screenshot…</p>}
        </div>
      )}

      {(status === 'review' || status === 'saving') && (
        <div className="space-y-3">
          <p className="text-slate-500 text-[11px]">
            {format === 'mobile' ? 'Mobile widget detected — average cost was derived from market value and gain/loss. ' : format === 'web' ? 'Web account summary detected. ' : ''}
            Review and fix anything misread, then confirm. This replaces your holdings to match.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 text-left">
                  <th className="py-1 pr-2 font-medium">Ticker</th>
                  <th className="py-1 pr-2 font-medium">Shares</th>
                  <th className="py-1 pr-2 font-medium">Avg ₱</th>
                  <th className="py-1 pr-2 font-medium">Change</th>
                  <th className="py-1"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const t = r.ticker.trim().toUpperCase();
                  const isNew = isNewTicker(t);
                  const cur = currentByTicker.get(t);
                  const unknown = validTickers && t.length > 0 && !validTickers.has(t);
                  return (
                    <tr key={i} className="border-t border-slate-800">
                      <td className="py-1 pr-2">
                        <input value={r.ticker} onChange={e => updateRow(i, 'ticker', e.target.value)}
                          className={`w-20 bg-slate-800 border rounded px-2 py-1 text-white ${unknown ? 'border-amber-500' : 'border-slate-700'}`} />
                        {unknown && <span className="block text-amber-500 text-[10px] mt-0.5">unknown ticker</span>}
                      </td>
                      <td className="py-1 pr-2">
                        <input type="number" value={r.shares} onChange={e => updateRow(i, 'shares', e.target.value)}
                          className="w-20 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-white" />
                      </td>
                      <td className="py-1 pr-2">
                        <input type="number" step="0.0001" value={r.avgPrice} onChange={e => updateRow(i, 'avgPrice', e.target.value)}
                          className="w-24 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-white" />
                      </td>
                      <td className="py-1 pr-2 whitespace-nowrap">
                        {isNew
                          ? <span className="text-green-400">new</span>
                          : cur && (Number(r.shares) !== cur.qty || Number(r.avgPrice) !== cur.buy_price)
                            ? <span className="text-amber-400">was {cur.qty}@₱{cur.buy_price.toFixed(2)}</span>
                            : <span className="text-slate-600">unchanged</span>}
                      </td>
                      <td className="py-1 text-right">
                        <button onClick={() => dropRow(i)} className="text-slate-600 hover:text-red-400">✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {removed.length > 0 && (
            <div className="bg-red-400/5 border border-red-400/20 rounded-lg p-2">
              <p className="text-red-300 text-[11px] mb-1">
                Not in the screenshot — will be removed. Tap Keep to protect a position.
              </p>
              {removed.map(h => (
                <div key={h.ticker} className="flex items-center justify-between text-xs py-0.5">
                  <span className={keepTickers.has(h.ticker) ? 'text-slate-300' : 'text-red-300 line-through'}>
                    {h.ticker} · {h.qty} sh @ ₱{h.buy_price.toFixed(2)}
                  </span>
                  <button onClick={() => toggleKeep(h.ticker)}
                    className={`text-[11px] px-2 py-0.5 rounded ${keepTickers.has(h.ticker) ? 'bg-slate-700 text-slate-200' : 'text-slate-400 hover:text-slate-200'}`}>
                    {keepTickers.has(h.ticker) ? 'Kept' : 'Keep'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {parsedCash !== null && (
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input type="checkbox" checked={includeCash} onChange={e => setIncludeCash(e.target.checked)} />
              Set cash to ₱{parsedCash.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </label>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <button onClick={onCancel} disabled={status === 'saving'}
              className="text-slate-400 hover:text-slate-200 text-sm px-3 py-2 disabled:opacity-50">Cancel</button>
            <button onClick={confirmSync} disabled={status === 'saving' || rows.length === 0}
              className="bg-green-500 hover:bg-green-400 disabled:opacity-50 text-slate-950 font-semibold text-sm px-4 py-2 rounded-lg transition-colors">
              {status === 'saving' ? 'Syncing…' : 'Confirm & Sync'}
            </button>
          </div>
        </div>
      )}

      <p className="text-slate-600 text-[10px]">This is not financial advice.</p>
    </div>
  );
}

function readAsBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] ?? '';
      resolve({ base64, mimeType: file.type });
    };
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(file);
  });
}
