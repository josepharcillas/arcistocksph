import { useState } from 'react';
import { supabase } from '../../lib/supabase';

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
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('You must be signed in to add a holding.'); setSaving(false); return; }

    const sym = ticker.toUpperCase().replace('.PS', '');
    const addQty = parseFloat(qty);
    const addPrice = parseFloat(buyPrice);

    // If this ticker is already held, average into one consolidated position
    // (weighted average cost) rather than creating a duplicate row.
    const { data: existing } = await supabase.from('holdings').select('id, qty, buy_price').eq('user_id', user.id).eq('ticker', sym);

    let err;
    if (existing && existing.length > 0) {
      let totQty = addQty;
      let totCost = addQty * addPrice;
      for (const e of existing) { totQty += Number(e.qty); totCost += Number(e.qty) * Number(e.buy_price); }
      const [first, ...rest] = existing;
      ({ error: err } = await supabase.from('holdings').update({ qty: totQty, buy_price: totCost / totQty, buy_date: buyDate }).eq('id', first.id));
      if (!err && rest.length) await supabase.from('holdings').delete().in('id', rest.map((r) => r.id));
    } else {
      ({ error: err } = await supabase.from('holdings').insert({
        user_id: user.id, ticker: sym, qty: addQty, buy_price: addPrice, buy_date: buyDate,
      }));
    }

    setSaving(false);
    if (err) { setError(err.message); return; }
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
