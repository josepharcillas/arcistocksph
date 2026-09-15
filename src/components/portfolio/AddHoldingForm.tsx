import { useState } from 'react';

interface Props { onAdded: () => void; }

export default function AddHoldingForm({ onAdded }: Props) {
  const [ticker, setTicker] = useState('');
  const [qty, setQty] = useState('');
  const [buyPrice, setBuyPrice] = useState('');
  const [buyDate, setBuyDate] = useState(new Date().toISOString().split('T')[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!ticker || !qty || !buyPrice) { setError('All fields are required.'); return; }

    setSaving(true);
    const sym = ticker.toUpperCase().replace('.PS', '');

    // Averaging into an existing position now happens server-side, in one
    // transaction — see addHolding() in src/lib/repo.ts. Doing it here took
    // three round trips and could duplicate a row if two submits raced.
    let res: Response;
    try {
      res = await fetch('/api/portfolio/holdings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: sym, qty: parseFloat(qty), buyPrice: parseFloat(buyPrice), buyDate }),
      });
    } catch {
      setSaving(false);
      setError('Could not reach the server. Please try again.');
      return;
    }

    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'Could not save that holding.');
      return;
    }
    onAdded();
  }

  return (
    <form onSubmit={submit} className="bg-slate-900 border border-slate-700 rounded-xl p-4 mb-4 space-y-3">
      <h3 className="text-sm font-semibold text-slate-300">Add Holding</h3>
      {error && <p className="text-red-400 text-xs">{error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-400 block mb-1">PSE Ticker</label>
          <input
            value={ticker}
            onChange={e => setTicker(e.target.value.toUpperCase())}
            placeholder="e.g. SM"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-green-500"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">Shares</label>
          <input
            type="number"
            value={qty}
            onChange={e => setQty(e.target.value)}
            placeholder="e.g. 100"
            min="1"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-green-500"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">Buy Price (₱)</label>
          <input
            type="number"
            value={buyPrice}
            onChange={e => setBuyPrice(e.target.value)}
            placeholder="e.g. 85.50"
            step="0.01"
            min="0.01"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-green-500"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">Buy Date</label>
          <input
            type="date"
            value={buyDate}
            onChange={e => setBuyDate(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-green-500"
          />
        </div>
      </div>

      <div className="flex gap-2 justify-end">
        <button type="submit" disabled={saving}
          className="bg-green-500 hover:bg-green-400 disabled:opacity-50 text-slate-950 font-semibold text-sm px-4 py-2 rounded-lg transition-colors">
          {saving ? 'Saving…' : 'Add'}
        </button>
      </div>
    </form>
  );
}
